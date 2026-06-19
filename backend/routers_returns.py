"""Phase 6/7 — Returns Engine: Credit Notes (franchise returns) & Debit Notes (vendor returns).

Shared engine handles:
- Numbering via configurable Org Settings prefix
- Tax recompute (CGST/SGST/IGST aware)
- Inventory adjustment on issue (Credit Note → hub stock +qty; Debit Note → hub stock -qty)
- Audit logs + StockMovement entries
- Idempotent issue (re-issuing keeps same number)
- PDF generation (shared layout based on uploaded RASHI sample)

Endpoints:
  GET    /api/credit-notes                       list (status + date filterable, franchise-scoped)
  POST   /api/credit-notes                       create draft (source_type='invoice' or 'manual')
  GET    /api/credit-notes/{id}                  get one
  PUT    /api/credit-notes/{id}                  edit (always editable until cancelled)
  POST   /api/credit-notes/{id}/issue            draft -> issued (assigns cn_number, restocks)
  POST   /api/credit-notes/{id}/cancel           mark cancelled (reverses stock if issued)
  GET    /api/credit-notes/{id}/pdf              PDF

  Same set under /api/debit-notes/* mirrored for vendor returns.
"""
from __future__ import annotations

import io
import logging
from datetime import datetime, timezone
from typing import Optional, List, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from auth_utils import require_roles, get_current_user
from models import CreditNote, DebitNote, ReturnLineItem, OrganizationSettings, gen_id, now_iso

logger = logging.getLogger(__name__)
router = APIRouter()

# ---- DI (wired by server.py) ----
_db = None
_log_audit = None
_adjust_stock = None  # async fn(product_id, qty_delta, location_type, location_id, ref_type, ref_id, user)


def init(db, log_audit_fn, adjust_stock_fn):
    global _db, _log_audit, _adjust_stock
    _db = db
    _log_audit = log_audit_fn
    _adjust_stock = adjust_stock_fn


# -------------------- shared helpers --------------------
async def _org() -> dict:
    doc = await _db.org_settings.find_one({"id": "org-settings"}, {"_id": 0})
    if not doc:
        doc = OrganizationSettings().model_dump()
        await _db.org_settings.insert_one(doc)
    return doc


async def _next_number(kind: str, org: dict) -> str:
    """kind = 'credit_note' or 'debit_note'."""
    counter = await _db.counters.find_one_and_update(
        {"_id": kind}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    seq = (counter or {}).get("seq", 1)
    if kind == "credit_note":
        prefix = org.get("credit_note_prefix") or "CN-2026-"
        pad = int(org.get("credit_note_pad") or 4)
    else:
        prefix = org.get("debit_note_prefix") or "DN-2026-"
        pad = int(org.get("debit_note_pad") or 4)
    return f"{prefix}{str(seq).zfill(pad)}"


def _num_to_words_inr(amount: float) -> str:
    try:
        amt = round(float(amount), 2)
    except Exception:
        return ""
    rupees = int(amt)
    units = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
             "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
             "Seventeen", "Eighteen", "Nineteen"]
    tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

    def two(n):
        return units[n] if n < 20 else (tens[n // 10] + (" " + units[n % 10] if n % 10 else "")).strip()

    def three(n):
        if n == 0:
            return ""
        h, r = n // 100, n % 100
        s = (units[h] + " Hundred") if h else ""
        if r:
            s += (" " if s else "") + two(r)
        return s

    if rupees == 0:
        words = "Zero"
    else:
        crore, rupees = rupees // 10000000, rupees % 10000000
        lakh, rupees = rupees // 100000, rupees % 100000
        thousand, rupees = rupees // 1000, rupees % 1000
        parts = []
        if crore:
            parts.append(two(crore) + " Crore")
        if lakh:
            parts.append(two(lakh) + " Lakh")
        if thousand:
            parts.append(two(thousand) + " Thousand")
        if rupees:
            parts.append(three(rupees))
        words = " ".join(parts)
    return f"Rupees {words} Only"


def _recompute(line_items: List[dict], is_inter_state: bool) -> dict:
    subtotal = cgst_t = sgst_t = igst_t = disc_t = 0.0
    for li in line_items:
        qty = float(li.get("qty") or 0)
        price = float(li.get("unit_price") or 0)
        disc_pct = float(li.get("discount_percent") or 0)
        gross = qty * price
        discount = round(gross * disc_pct / 100, 2)
        taxable = round(gross - discount, 2)
        gst = float(li.get("gst_percent") or 0)
        if is_inter_state:
            cgst_a = sgst_a = 0.0
            igst_a = round(taxable * gst / 100, 2)
        else:
            half = round(taxable * (gst / 2) / 100, 2)
            cgst_a = sgst_a = half
            igst_a = 0.0
        line_total = round(taxable + cgst_a + sgst_a + igst_a, 2)
        li["taxable_value"] = taxable
        li["cgst_amount"] = cgst_a
        li["sgst_amount"] = sgst_a
        li["igst_amount"] = igst_a
        li["line_total"] = line_total
        subtotal += taxable
        cgst_t += cgst_a
        sgst_t += sgst_a
        igst_t += igst_a
        disc_t += discount
    grand = round(subtotal + cgst_t + sgst_t + igst_t, 2)
    rounded = round(grand)
    round_off = round(rounded - grand, 2)
    grand_total = float(rounded)
    return {
        "subtotal": round(subtotal, 2),
        "total_discount": round(disc_t, 2),
        "cgst_total": round(cgst_t, 2),
        "sgst_total": round(sgst_t, 2),
        "igst_total": round(igst_t, 2),
        "round_off": round_off,
        "grand_total": grand_total,
        "amount_in_words": _num_to_words_inr(grand_total),
    }


# -------------------- DTOs --------------------
class ReturnLineIn(BaseModel):
    product_id: Optional[str] = None
    sku: Optional[str] = ""
    description: str = ""
    hsn: Optional[str] = ""
    qty: float = 1.0
    unit: Optional[str] = "PCS"
    unit_price: float = 0.0
    discount_percent: float = 0.0
    gst_percent: float = 18.0
    reason: Optional[str] = ""


class CreditNoteIn(BaseModel):
    source_type: Literal["invoice", "manual"] = "manual"
    tax_invoice_id: Optional[str] = None
    franchise_id: Optional[str] = None
    line_items: List[ReturnLineIn] = []
    reason: Optional[str] = ""
    notes: Optional[str] = ""
    cn_date: Optional[str] = None
    place_of_supply: Optional[str] = None


class DebitNoteIn(BaseModel):
    source_type: Literal["purchase_order", "manual"] = "manual"
    po_id: Optional[str] = None
    vendor_id: Optional[str] = None
    line_items: List[ReturnLineIn] = []
    reason: Optional[str] = ""
    notes: Optional[str] = ""
    dn_date: Optional[str] = None
    place_of_supply: Optional[str] = None


# -------------------- Credit Notes --------------------
@router.get("/credit-notes", tags=["returns"])
async def list_credit_notes(
    status: Optional[str] = Query(None),
    franchise_id: Optional[str] = Query(None),
    user: dict = Depends(require_roles("super_admin", "hub_accountant", "warehouse_manager", "franchise_manager")),
):
    q: dict = {}
    if user["role"] == "franchise_manager":
        q["franchise_id"] = user.get("franchise_id")
    elif franchise_id:
        q["franchise_id"] = franchise_id
    if status:
        q["status"] = status
    docs = await _db.credit_notes.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return docs


async def _prefill_from_invoice(tid: str, body: CreditNoteIn) -> dict:
    inv = await _db.tax_invoices.find_one({"id": tid}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Tax invoice not found")
    result = {
        "franchise_id": inv.get("franchise_id"),
        "franchise_code": inv.get("franchise_code", ""),
        "franchise_name": inv.get("franchise_name", ""),
        "billing_address": inv.get("billing_address", ""),
        "billing_gstin": inv.get("billing_gstin", ""),
        "billing_state": inv.get("billing_state", ""),
        "billing_state_code": inv.get("billing_state_code", ""),
        "place_of_supply": inv.get("place_of_supply", ""),
        "is_inter_state": inv.get("is_inter_state", False),
        "tax_invoice_id": tid,
        "tax_invoice_number": inv.get("invoice_number", ""),
    }
    # If the user did NOT pass any line items, prefill from invoice (qty=0 — they'll edit)
    if not body.line_items:
        result["prefill_lines"] = [
            {**li, "qty": 0.0, "taxable_value": 0.0, "line_total": 0.0,
             "cgst_amount": 0.0, "sgst_amount": 0.0, "igst_amount": 0.0,
             "reason": ""}
            for li in inv.get("line_items", []) or []
        ]
    return result


@router.post("/credit-notes", tags=["returns"])
async def create_credit_note(body: CreditNoteIn, request: Request,
                              user: dict = Depends(require_roles("super_admin", "hub_accountant", "warehouse_manager"))):
    franchise_id = body.franchise_id
    extra: dict = {}
    prefill_lines: list = []
    if body.source_type == "invoice":
        if not body.tax_invoice_id:
            raise HTTPException(400, "tax_invoice_id required for source_type='invoice'")
        prefill = await _prefill_from_invoice(body.tax_invoice_id, body)
        prefill_lines = prefill.pop("prefill_lines", [])
        franchise_id = prefill.pop("franchise_id", None)
        extra.update(prefill)
    else:
        if not franchise_id:
            raise HTTPException(400, "franchise_id required for manual credit note")
        fr = await _db.franchises.find_one({"id": franchise_id}, {"_id": 0})
        if not fr:
            raise HTTPException(404, "Franchise not found")
        extra.update({
            "franchise_code": fr.get("code", ""),
            "franchise_name": fr.get("name", ""),
            "billing_address": fr.get("address", ""),
            "billing_gstin": fr.get("gstin", ""),
            "billing_state": fr.get("state", ""),
        })

    is_inter = extra.get("is_inter_state", False)
    raw_lines = [li.model_dump() for li in body.line_items] or prefill_lines
    totals = _recompute(raw_lines, is_inter)

    cn = CreditNote(
        cn_date=body.cn_date or now_iso()[:10],
        source_type=body.source_type,
        franchise_id=franchise_id,
        line_items=[ReturnLineItem(**li) for li in raw_lines],
        reason=body.reason or "",
        notes=body.notes or "",
        created_by=user["id"],
        **extra,
        **totals,
    )
    if body.place_of_supply:
        cn.place_of_supply = body.place_of_supply

    doc = cn.model_dump()
    await _db.credit_notes.insert_one(doc)
    doc.pop("_id", None)
    await _log_audit(user, "credit_note.create", "credit_note", cn.id,
                     after={"franchise_id": franchise_id, "total": totals["grand_total"]}, request=request)
    return doc


@router.get("/credit-notes/{cnid}", tags=["returns"])
async def get_credit_note(cnid: str, user: dict = Depends(get_current_user)):
    doc = await _db.credit_notes.find_one({"id": cnid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    if user["role"] == "franchise_manager" and doc.get("franchise_id") != user.get("franchise_id"):
        raise HTTPException(403, "Forbidden")
    return doc


@router.put("/credit-notes/{cnid}", tags=["returns"])
async def update_credit_note(cnid: str, body: CreditNoteIn, request: Request,
                              user: dict = Depends(require_roles("super_admin", "hub_accountant", "warehouse_manager"))):
    doc = await _db.credit_notes.find_one({"id": cnid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["status"] == "cancelled":
        raise HTTPException(409, "Cannot edit cancelled credit note")
    lines = [li.model_dump() for li in body.line_items]
    totals = _recompute(lines, doc.get("is_inter_state", False))
    update = {
        "line_items": lines,
        "reason": body.reason or doc.get("reason", ""),
        "notes": body.notes or doc.get("notes", ""),
        **totals,
    }
    if body.cn_date:
        update["cn_date"] = body.cn_date
    if body.place_of_supply:
        update["place_of_supply"] = body.place_of_supply
    await _db.credit_notes.update_one({"id": cnid}, {"$set": update})
    await _log_audit(user, "credit_note.update", "credit_note", cnid,
                     after={"total": totals["grand_total"]}, request=request)
    return {"ok": True}


@router.post("/credit-notes/{cnid}/issue", tags=["returns"])
async def issue_credit_note(cnid: str, request: Request,
                             user: dict = Depends(require_roles("super_admin", "hub_accountant"))):
    doc = await _db.credit_notes.find_one({"id": cnid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["status"] == "issued":
        return {"ok": True, "cn_number": doc["cn_number"], "idempotent": True}
    if doc["status"] == "cancelled":
        raise HTTPException(409, "Cannot issue a cancelled credit note")
    org = await _org()
    cn_number = await _next_number("credit_note", org)
    update = {
        "status": "issued",
        "cn_number": cn_number,
        "issued_at": now_iso(),
    }
    await _db.credit_notes.update_one({"id": cnid}, {"$set": update})

    # Restock — franchise returns goods → hub stock +qty
    for li in doc.get("line_items", []) or []:
        pid = li.get("product_id")
        qty = float(li.get("qty") or 0)
        if pid and qty > 0:
            try:
                await _adjust_stock(pid, qty, "hub", "hub", "credit_note", cnid, user)
            except Exception as e:
                logger.warning(f"credit_note restock failed for {pid}: {e}")

    await _log_audit(user, "credit_note.issue", "credit_note", cnid,
                     after={"cn_number": cn_number}, request=request)
    return {"ok": True, "cn_number": cn_number}


@router.post("/credit-notes/{cnid}/cancel", tags=["returns"])
async def cancel_credit_note(cnid: str, request: Request,
                              reason: str = "",
                              user: dict = Depends(require_roles("super_admin", "hub_accountant"))):
    doc = await _db.credit_notes.find_one({"id": cnid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["status"] == "cancelled":
        return {"ok": True, "idempotent": True}
    # If it was issued, reverse the restock (decrement hub by qty)
    if doc["status"] == "issued":
        for li in doc.get("line_items", []) or []:
            pid = li.get("product_id")
            qty = float(li.get("qty") or 0)
            if pid and qty > 0:
                try:
                    await _adjust_stock(pid, -qty, "hub", "hub", "credit_note_cancel", cnid, user)
                except Exception as e:
                    logger.warning(f"credit_note cancel-reverse failed for {pid}: {e}")
    await _db.credit_notes.update_one({"id": cnid},
                                       {"$set": {"status": "cancelled",
                                                 "cancelled_at": now_iso(),
                                                 "cancelled_reason": reason}})
    await _log_audit(user, "credit_note.cancel", "credit_note", cnid,
                     after={"reason": reason}, request=request)
    return {"ok": True}


@router.get("/credit-notes/{cnid}/pdf", tags=["returns"])
async def credit_note_pdf(cnid: str, user: dict = Depends(get_current_user)):
    doc = await _db.credit_notes.find_one({"id": cnid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    if user["role"] == "franchise_manager" and doc.get("franchise_id") != user.get("franchise_id"):
        raise HTTPException(403, "Forbidden")
    org = await _org()
    pdf = _render_return_pdf(doc, org, kind="credit")
    return StreamingResponse(
        io.BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{doc.get("cn_number") or "DRAFT"}.pdf"'},
    )


# -------------------- Debit Notes --------------------
@router.get("/debit-notes", tags=["returns"])
async def list_debit_notes(
    status: Optional[str] = Query(None),
    vendor_id: Optional[str] = Query(None),
    user: dict = Depends(require_roles("super_admin", "hub_accountant", "warehouse_manager")),
):
    q: dict = {}
    if vendor_id:
        q["vendor_id"] = vendor_id
    if status:
        q["status"] = status
    docs = await _db.debit_notes.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return docs


@router.post("/debit-notes", tags=["returns"])
async def create_debit_note(body: DebitNoteIn, request: Request,
                             user: dict = Depends(require_roles("super_admin", "hub_accountant", "warehouse_manager"))):
    extra: dict = {}
    prefill_lines: list = []
    vendor_id = body.vendor_id
    if body.source_type == "purchase_order":
        if not body.po_id:
            raise HTTPException(400, "po_id required for source_type='purchase_order'")
        po = await _db.purchase_orders.find_one({"id": body.po_id}, {"_id": 0})
        if not po:
            raise HTTPException(404, "PO not found")
        vendor_id = po.get("vendor_id")
        extra["po_id"] = body.po_id
        extra["po_number"] = po.get("po_number", "")
        if not body.line_items:
            for li in po.get("line_items", []) or []:
                prefill_lines.append({
                    "product_id": li.get("product_id"),
                    "sku": li.get("sku", ""),
                    "description": li.get("product_name", ""),
                    "hsn": "",
                    "qty": 0.0,
                    "unit": "PCS",
                    "unit_price": float(li.get("unit_price", 0) or 0),
                    "discount_percent": 0.0,
                    "gst_percent": 18.0,
                    "reason": "",
                })
    if not vendor_id:
        raise HTTPException(400, "vendor_id required")
    vendor = await _db.vendors.find_one({"id": vendor_id}, {"_id": 0})
    if not vendor:
        raise HTTPException(404, "Vendor not found")
    extra.update({
        "vendor_id": vendor_id,
        "vendor_name": vendor.get("name", ""),
        "vendor_gstin": vendor.get("gstin", ""),
        "vendor_address": vendor.get("address", ""),
    })

    raw_lines = [li.model_dump() for li in body.line_items] or prefill_lines
    totals = _recompute(raw_lines, False)

    dn = DebitNote(
        dn_date=body.dn_date or now_iso()[:10],
        source_type=body.source_type,
        line_items=[ReturnLineItem(**li) for li in raw_lines],
        reason=body.reason or "",
        notes=body.notes or "",
        created_by=user["id"],
        **extra,
        **totals,
    )
    if body.place_of_supply:
        dn.place_of_supply = body.place_of_supply

    doc = dn.model_dump()
    await _db.debit_notes.insert_one(doc)
    doc.pop("_id", None)
    await _log_audit(user, "debit_note.create", "debit_note", dn.id,
                     after={"vendor_id": vendor_id, "total": totals["grand_total"]}, request=request)
    return doc


@router.get("/debit-notes/{dnid}", tags=["returns"])
async def get_debit_note(dnid: str, user: dict = Depends(require_roles("super_admin", "hub_accountant", "warehouse_manager"))):
    doc = await _db.debit_notes.find_one({"id": dnid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    return doc


@router.put("/debit-notes/{dnid}", tags=["returns"])
async def update_debit_note(dnid: str, body: DebitNoteIn, request: Request,
                             user: dict = Depends(require_roles("super_admin", "hub_accountant", "warehouse_manager"))):
    doc = await _db.debit_notes.find_one({"id": dnid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["status"] == "cancelled":
        raise HTTPException(409, "Cannot edit cancelled debit note")
    lines = [li.model_dump() for li in body.line_items]
    totals = _recompute(lines, doc.get("is_inter_state", False))
    update = {
        "line_items": lines,
        "reason": body.reason or doc.get("reason", ""),
        "notes": body.notes or doc.get("notes", ""),
        **totals,
    }
    if body.dn_date:
        update["dn_date"] = body.dn_date
    if body.place_of_supply:
        update["place_of_supply"] = body.place_of_supply
    await _db.debit_notes.update_one({"id": dnid}, {"$set": update})
    await _log_audit(user, "debit_note.update", "debit_note", dnid,
                     after={"total": totals["grand_total"]}, request=request)
    return {"ok": True}


@router.post("/debit-notes/{dnid}/issue", tags=["returns"])
async def issue_debit_note(dnid: str, request: Request,
                            user: dict = Depends(require_roles("super_admin", "hub_accountant"))):
    doc = await _db.debit_notes.find_one({"id": dnid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["status"] == "issued":
        return {"ok": True, "dn_number": doc["dn_number"], "idempotent": True}
    if doc["status"] == "cancelled":
        raise HTTPException(409, "Cannot issue a cancelled debit note")
    org = await _org()
    dn_number = await _next_number("debit_note", org)
    update = {
        "status": "issued",
        "dn_number": dn_number,
        "issued_at": now_iso(),
    }
    await _db.debit_notes.update_one({"id": dnid}, {"$set": update})

    # Goods leave hub → hub stock -qty
    for li in doc.get("line_items", []) or []:
        pid = li.get("product_id")
        qty = float(li.get("qty") or 0)
        if pid and qty > 0:
            try:
                await _adjust_stock(pid, -qty, "hub", "hub", "debit_note", dnid, user)
            except Exception as e:
                logger.warning(f"debit_note destock failed for {pid}: {e}")

    await _log_audit(user, "debit_note.issue", "debit_note", dnid,
                     after={"dn_number": dn_number}, request=request)
    return {"ok": True, "dn_number": dn_number}


@router.post("/debit-notes/{dnid}/cancel", tags=["returns"])
async def cancel_debit_note(dnid: str, request: Request,
                             reason: str = "",
                             user: dict = Depends(require_roles("super_admin", "hub_accountant"))):
    doc = await _db.debit_notes.find_one({"id": dnid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["status"] == "cancelled":
        return {"ok": True, "idempotent": True}
    if doc["status"] == "issued":
        for li in doc.get("line_items", []) or []:
            pid = li.get("product_id")
            qty = float(li.get("qty") or 0)
            if pid and qty > 0:
                try:
                    await _adjust_stock(pid, qty, "hub", "hub", "debit_note_cancel", dnid, user)
                except Exception as e:
                    logger.warning(f"debit_note cancel-reverse failed for {pid}: {e}")
    await _db.debit_notes.update_one({"id": dnid},
                                      {"$set": {"status": "cancelled",
                                                "cancelled_at": now_iso(),
                                                "cancelled_reason": reason}})
    await _log_audit(user, "debit_note.cancel", "debit_note", dnid,
                     after={"reason": reason}, request=request)
    return {"ok": True}


@router.get("/debit-notes/{dnid}/pdf", tags=["returns"])
async def debit_note_pdf(dnid: str, user: dict = Depends(require_roles("super_admin", "hub_accountant", "warehouse_manager"))):
    doc = await _db.debit_notes.find_one({"id": dnid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    org = await _org()
    pdf = _render_return_pdf(doc, org, kind="debit")
    return StreamingResponse(
        io.BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{doc.get("dn_number") or "DRAFT"}.pdf"'},
    )


# -------------------- Shared PDF renderer --------------------
def _render_return_pdf(doc: dict, org: dict, kind: str = "credit") -> bytes:
    """Shared layout for Credit / Debit notes. Modeled on RASHI sample."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm

    is_credit = kind == "credit"
    title_text = "CREDIT NOTE" if is_credit else "DEBIT NOTE"
    counter_party_label = "Return From" if is_credit else "Return To Vendor"

    buf = io.BytesIO()
    pdf = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=12 * mm, rightMargin=12 * mm,
                            topMargin=10 * mm, bottomMargin=10 * mm)
    styles = getSampleStyleSheet()
    h_style = ParagraphStyle("hdr", parent=styles["Normal"], fontSize=8, leading=10)
    small = ParagraphStyle("sm", parent=styles["Normal"], fontSize=7, leading=9, textColor=colors.HexColor("#555"))
    label = ParagraphStyle("lb", parent=styles["Normal"], fontSize=7, leading=9, textColor=colors.HexColor("#777"))
    big = ParagraphStyle("bg", parent=styles["Normal"], fontSize=11, leading=14, alignment=0)
    title = ParagraphStyle("ttl", parent=styles["Normal"], fontSize=16, leading=20, alignment=2,
                            textColor=colors.HexColor("#7a1f1f"), spaceAfter=2)

    elements: list = []

    # Header — org info (left) + Title (right)
    org_block = [
        Paragraph(f"<b>{org.get('legal_name','SERVALL')}</b>", big),
        Paragraph(org.get("address_line1", ""), h_style),
        Paragraph(f"{org.get('city','')}, {org.get('state','')} {org.get('pincode','')}", h_style),
        Paragraph(f"GSTIN: <b>{org.get('gstin','')}</b>", h_style),
        Paragraph(f"Phone: {org.get('phone','')}  Email: {org.get('email','')}", h_style),
    ]
    if is_credit:
        meta_rows = [
            ["Return No.", doc.get("cn_number") or "DRAFT"],
            ["Date", doc.get("cn_date") or ""],
            ["Source", (doc.get("source_type") or "").upper()],
            ["Invoice Ref.", doc.get("tax_invoice_number") or "—"],
            ["Status", (doc.get("status") or "").upper()],
        ]
    else:
        meta_rows = [
            ["Return No.", doc.get("dn_number") or "DRAFT"],
            ["Date", doc.get("dn_date") or ""],
            ["Source", (doc.get("source_type") or "").upper()],
            ["PO Ref.", doc.get("po_number") or "—"],
            ["Status", (doc.get("status") or "").upper()],
        ]
    title_block = [
        Paragraph(f"<b>{title_text}</b>", title),
        Table(meta_rows, colWidths=[28 * mm, 50 * mm], style=TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 7),
            ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#777")),
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#FAFAFA")),
            ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDDDDD")),
            ("INNERGRID", (0, 0), (-1, -1), 0.2, colors.HexColor("#EEEEEE")),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ])),
    ]
    hdr_tbl = Table([[org_block, title_block]], colWidths=[110 * mm, 78 * mm])
    hdr_tbl.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elements.append(hdr_tbl)
    elements.append(Spacer(1, 8))

    # Counter-party block
    if is_credit:
        cp_block = [
            Paragraph(f"<b>{counter_party_label}</b>", label),
            Paragraph(f"<b>{doc.get('franchise_name','')}</b>", h_style),
            Paragraph(doc.get("billing_address", ""), h_style),
            Paragraph(f"GSTIN: {doc.get('billing_gstin','—')}", h_style),
            Paragraph(f"State: {doc.get('billing_state','')}", h_style),
        ]
    else:
        cp_block = [
            Paragraph(f"<b>{counter_party_label}</b>", label),
            Paragraph(f"<b>{doc.get('vendor_name','')}</b>", h_style),
            Paragraph(doc.get("vendor_address", ""), h_style),
            Paragraph(f"GSTIN: {doc.get('vendor_gstin','—')}", h_style),
        ]
    reason_block = [
        Paragraph("<b>Reason / Notes</b>", label),
        Paragraph(doc.get("reason", "") or "—", h_style),
        Paragraph(doc.get("notes", "") or "", small),
    ]
    cp_tbl = Table([[cp_block, reason_block]], colWidths=[94 * mm, 94 * mm])
    cp_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDDDDD")),
        ("LINEAFTER", (0, 0), (0, -1), 0.4, colors.HexColor("#DDDDDD")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(cp_tbl)
    elements.append(Spacer(1, 6))

    # Line items table
    is_inter = doc.get("is_inter_state", False)
    head = ["#", "Item name", "Item code", "HSN/SAC", "Qty", "Unit", "Price/unit", "Taxable"]
    if is_inter:
        head += ["IGST", "Total"]
    else:
        head += ["CGST", "SGST", "Total"]
    data = [head]
    for i, li in enumerate(doc.get("line_items", []) or [], 1):
        row = [
            str(i),
            Paragraph(li.get("description", "") or "", h_style),
            li.get("sku", ""),
            li.get("hsn", ""),
            f"{li.get('qty', 0):g}",
            li.get("unit", ""),
            f"{li.get('unit_price', 0):.2f}",
            f"{li.get('taxable_value', 0):.2f}",
        ]
        if is_inter:
            row += [f"{li.get('igst_amount', 0):.2f}", f"{li.get('line_total', 0):.2f}"]
        else:
            row += [f"{li.get('cgst_amount', 0):.2f}", f"{li.get('sgst_amount', 0):.2f}", f"{li.get('line_total', 0):.2f}"]
        data.append(row)
    if is_inter:
        cw = [6 * mm, 55 * mm, 16 * mm, 14 * mm, 11 * mm, 10 * mm, 16 * mm, 17 * mm, 16 * mm, 22 * mm]
    else:
        cw = [6 * mm, 47 * mm, 16 * mm, 14 * mm, 11 * mm, 10 * mm, 15 * mm, 16 * mm, 15 * mm, 15 * mm, 20 * mm]
    items_tbl = Table(data, colWidths=cw, repeatRows=1)
    items_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#7a1f1f")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("ALIGN", (3, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#BBBBBB")),
        ("INNERGRID", (0, 0), (-1, -1), 0.2, colors.HexColor("#DDDDDD")),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    elements.append(items_tbl)
    elements.append(Spacer(1, 6))

    # Totals
    totals_rows = [["Sub Total", f"₹ {doc.get('subtotal',0):.2f}"]]
    if (doc.get("total_discount") or 0) > 0:
        totals_rows.append(["Discount", f"₹ {doc.get('total_discount',0):.2f}"])
    if is_inter:
        totals_rows.append(["IGST", f"₹ {doc.get('igst_total',0):.2f}"])
    else:
        totals_rows.append(["CGST", f"₹ {doc.get('cgst_total',0):.2f}"])
        totals_rows.append(["SGST", f"₹ {doc.get('sgst_total',0):.2f}"])
    if (doc.get("round_off") or 0) != 0:
        totals_rows.append(["Round Off", f"₹ {doc.get('round_off',0):.2f}"])
    totals_rows.append(["TOTAL", f"₹ {doc.get('grand_total',0):.2f}"])

    totals_tbl = Table(totals_rows, colWidths=[50 * mm, 38 * mm])
    totals_tbl.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -2), 8),
        ("FONTSIZE", (0, -1), (-1, -1), 10),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#7a1f1f")),
        ("TEXTCOLOR", (0, -1), (-1, -1), colors.white),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#BBBBBB")),
        ("INNERGRID", (0, 0), (-1, -1), 0.2, colors.HexColor("#DDDDDD")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))

    words_block = [
        Paragraph("<b>Amount in Words</b>", label),
        Paragraph(doc.get("amount_in_words", ""), h_style),
        Spacer(1, 6),
        Paragraph(f"For <b>{org.get('legal_name','SERVALL')}</b>", h_style),
        Spacer(1, 20),
        Paragraph("Authorised Signatory", small),
    ]
    bottom_tbl = Table([[words_block, totals_tbl]], colWidths=[100 * mm, 88 * mm])
    bottom_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    elements.append(bottom_tbl)

    pdf.build(elements)
    return buf.getvalue()
