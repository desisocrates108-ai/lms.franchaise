"""V2.2 Phase 2 — Sales Tax Invoice Module (additive).

Endpoints:
  GET    /api/org/settings                              — fetch organization settings
  PUT    /api/org/settings                              — update org settings (super_admin)
  GET    /api/tax-invoices                              — list (date-filterable + status)
  POST   /api/tax-invoices                              — create draft from scratch or from challan
  GET    /api/tax-invoices/{tid}                        — get one
  PUT    /api/tax-invoices/{tid}                        — edit draft only
  POST   /api/tax-invoices/{tid}/issue                  — draft → issued (assigns invoice_number)
  POST   /api/tax-invoices/{tid}/cancel                 — mark cancelled
  POST   /api/tax-invoices/{tid}/mark-paid              — mark paid
  GET    /api/tax-invoices/{tid}/pdf                    — professional tax invoice PDF
  GET    /api/tax-invoices/{tid}/mailto                 — mailto: deeplink (subject/body prefilled)
  POST   /api/delivery-challans/{dcid}/create-tax-invoice — manual button on a delivered/invoiced DC

  Auto-hook (exposed for server.py): auto_create_tax_invoice_for_dc(dc_id, user)
"""
from __future__ import annotations

import io
import logging
import urllib.parse
from datetime import datetime, timezone
from typing import Optional, List, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from auth_utils import require_roles, get_current_user
from models import (
    OrganizationSettings, TaxInvoice, TaxInvoiceLineItem, gen_id, now_iso,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# ---- DI ----
_db = None
_log_audit = None


def init(db, log_audit_fn):
    global _db, _log_audit
    _db = db
    _log_audit = log_audit_fn


# ---------------- Helpers ----------------
async def get_org_settings_doc() -> dict:
    """Return org settings, seeding defaults if missing. Also backfills any
    newly-added fields (e.g. credit_note_prefix / debit_note_prefix) onto
    existing records so older deployments transparently get the new defaults."""
    doc = await _db.org_settings.find_one({"id": "org-settings"}, {"_id": 0})
    if not doc:
        defaults = OrganizationSettings().model_dump()
        await _db.org_settings.insert_one(defaults)
        return defaults
    defaults = OrganizationSettings().model_dump()
    missing = {k: v for k, v in defaults.items() if k not in doc}
    if missing:
        await _db.org_settings.update_one({"id": "org-settings"}, {"$set": missing})
        doc.update(missing)
    return doc


async def _next_tax_invoice_number(org: dict) -> str:
    counter = await _db.counters.find_one_and_update(
        {"_id": "tax_invoice"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    seq = (counter or {}).get("seq", 1)
    prefix = org.get("invoice_prefix") or "TI/2026-27/"
    pad = int(org.get("invoice_pad") or 4)
    return f"{prefix}{str(seq).zfill(pad)}"


def _num_to_words_inr(amount: float) -> str:
    """Convert Rupee amount to Indian-system words (e.g. 'One Lakh Twenty Three Thousand only')."""
    try:
        amt = round(float(amount), 2)
    except Exception:
        return ""
    rupees = int(amt)
    paise = int(round((amt - rupees) * 100))

    units = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
             "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
             "Seventeen", "Eighteen", "Nineteen"]
    tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

    def two_digit(n: int) -> str:
        if n < 20:
            return units[n]
        return (tens[n // 10] + (" " + units[n % 10] if n % 10 else "")).strip()

    def three_digit(n: int) -> str:
        if n == 0:
            return ""
        hundred = n // 100
        rest = n % 100
        s = ""
        if hundred:
            s += units[hundred] + " Hundred"
            if rest:
                s += " "
        if rest:
            s += two_digit(rest)
        return s

    if rupees == 0:
        words = "Zero"
    else:
        crore = rupees // 10000000
        rupees %= 10000000
        lakh = rupees // 100000
        rupees %= 100000
        thousand = rupees // 1000
        rupees %= 1000
        rest = rupees
        parts = []
        if crore:
            parts.append(two_digit(crore) + " Crore")
        if lakh:
            parts.append(two_digit(lakh) + " Lakh")
        if thousand:
            parts.append(two_digit(thousand) + " Thousand")
        if rest:
            parts.append(three_digit(rest))
        words = " ".join(parts)
    result = f"Rupees {words}"
    if paise:
        result += f" and {two_digit(paise)} Paise"
    return result + " Only"


def _recompute_totals(line_items: List[dict], is_inter_state: bool) -> dict:
    """Apply taxable + tax math to each row and return {subtotal,cgst,sgst,igst,grand_total,amount_in_words}."""
    subtotal = 0.0
    cgst_total = 0.0
    sgst_total = 0.0
    igst_total = 0.0
    cess_total = 0.0
    total_discount = 0.0
    for li in line_items:
        qty = float(li.get("qty") or 0)
        price = float(li.get("unit_price") or 0)
        disc_pct = float(li.get("discount_percent") or 0)
        gross = qty * price
        discount = round(gross * disc_pct / 100, 2)
        taxable = round(gross - discount, 2)
        gst = float(li.get("gst_percent") or 0)
        if is_inter_state:
            cgst_a = 0.0
            sgst_a = 0.0
            igst_a = round(taxable * gst / 100, 2)
        else:
            half = round(taxable * (gst / 2) / 100, 2)
            cgst_a = half
            sgst_a = half
            igst_a = 0.0
        line_total = round(taxable + cgst_a + sgst_a + igst_a, 2)
        li["taxable_value"] = taxable
        li["cgst_amount"] = cgst_a
        li["sgst_amount"] = sgst_a
        li["igst_amount"] = igst_a
        li["line_total"] = line_total
        subtotal += taxable
        cgst_total += cgst_a
        sgst_total += sgst_a
        igst_total += igst_a
        total_discount += discount
    grand = round(subtotal + cgst_total + sgst_total + igst_total + cess_total, 2)
    rounded = round(grand)
    round_off = round(rounded - grand, 2)
    grand_total = float(rounded)
    return {
        "subtotal": round(subtotal, 2),
        "total_discount": round(total_discount, 2),
        "cgst_total": round(cgst_total, 2),
        "sgst_total": round(sgst_total, 2),
        "igst_total": round(igst_total, 2),
        "cess_total": round(cess_total, 2),
        "round_off": round_off,
        "grand_total": grand_total,
        "amount_in_words": _num_to_words_inr(grand_total),
    }


def _state_code_from_gstin(gstin: str) -> str:
    g = (gstin or "").strip()
    return g[:2] if len(g) >= 2 and g[:2].isdigit() else ""


# ---------------- Org Settings ----------------
@router.get("/org/settings", tags=["org"])
async def get_org_settings(user: dict = Depends(get_current_user)):
    return await get_org_settings_doc()


class OrgSettingsIn(BaseModel):
    legal_name: Optional[str] = None
    trade_name: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    state_code: Optional[str] = None
    pincode: Optional[str] = None
    country: Optional[str] = None
    gstin: Optional[str] = None
    pan: Optional[str] = None
    cin: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    bank_ifsc: Optional[str] = None
    bank_branch: Optional[str] = None
    invoice_prefix: Optional[str] = None
    invoice_pad: Optional[int] = None
    credit_note_prefix: Optional[str] = None
    credit_note_pad: Optional[int] = None
    debit_note_prefix: Optional[str] = None
    debit_note_pad: Optional[int] = None
    default_terms: Optional[str] = None
    logo_url: Optional[str] = None
    signature_url: Optional[str] = None
    auto_create_tax_invoice_on_delivery: Optional[bool] = None


@router.put("/org/settings", tags=["org"])
async def update_org_settings(body: OrgSettingsIn, request: Request,
                               user: dict = Depends(require_roles("super_admin"))):
    await get_org_settings_doc()  # ensure exists
    patch = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not patch:
        cur = await get_org_settings_doc()
        return cur
    # Auto-derive state_code from GSTIN if not explicitly provided
    if "gstin" in patch and patch["gstin"] and "state_code" not in patch:
        sc = _state_code_from_gstin(patch["gstin"])
        if sc:
            patch["state_code"] = sc
    patch["updated_at"] = now_iso()
    await _db.org_settings.update_one({"id": "org-settings"}, {"$set": patch})
    await _log_audit(user, "org.settings.update", "org", "org-settings", after=patch, request=request)
    return await get_org_settings_doc()


# ---------------- Tax Invoices ----------------
@router.get("/tax-invoices", tags=["tax_invoices"])
async def list_tax_invoices(
    status: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    user: dict = Depends(get_current_user),
):
    q: dict = {}
    if user["role"] == "franchise_manager":
        q["franchise_id"] = user.get("franchise_id")
    if status:
        q["status"] = status
    if from_date or to_date:
        date_q: dict = {}
        if from_date:
            date_q["$gte"] = from_date
        if to_date:
            date_q["$lte"] = to_date + "T23:59:59"
        q["created_at"] = date_q
    docs = await _db.tax_invoices.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return docs


class TaxInvoiceLineItemIn(BaseModel):
    product_id: Optional[str] = None
    sku: Optional[str] = ""
    description: str
    hsn: Optional[str] = ""
    qty: float = 1.0
    unit: Optional[str] = "PCS"
    unit_price: float = 0.0
    discount_percent: Optional[float] = 0.0
    gst_percent: Optional[float] = 18.0


class TaxInvoiceCreateIn(BaseModel):
    source_type: Literal["challan", "manual"] = "manual"
    challan_id: Optional[str] = None
    invoice_date: Optional[str] = None
    due_date: Optional[str] = None
    franchise_id: Optional[str] = None
    billing_name: Optional[str] = ""
    billing_address: Optional[str] = ""
    billing_gstin: Optional[str] = ""
    billing_state: Optional[str] = ""
    billing_state_code: Optional[str] = ""
    shipping_address: Optional[str] = ""
    contact_phone: Optional[str] = ""
    contact_email: Optional[str] = ""
    place_of_supply: Optional[str] = ""
    line_items: List[TaxInvoiceLineItemIn] = []
    terms: Optional[str] = None
    notes: Optional[str] = ""
    payment_terms: Optional[str] = "Net 30"


async def _build_invoice_from_challan(dc_id: str) -> dict:
    """Pre-fill a TaxInvoice payload from a delivery challan + franchise."""
    dc = await _db.delivery_challans.find_one({"id": dc_id}, {"_id": 0})
    if not dc:
        raise HTTPException(404, f"Delivery Challan {dc_id} not found")
    franchise = await _db.franchises.find_one({"id": dc.get("franchise_id")}, {"_id": 0}) or {}
    # Translate IndentLineItem → TaxInvoiceLineItem
    lines: List[dict] = []
    for li in dc.get("line_items", []) or []:
        qty = float(li.get("allocated_qty") or li.get("requested_qty") or 0)
        price = float(li.get("unit_price") or 0)
        # Try to fetch product for HSN
        prod = None
        if li.get("product_id"):
            prod = await _db.products.find_one({"id": li["product_id"]}, {"_id": 0})
        hsn = (prod or {}).get("hsn_code", "")
        gst_pct = (prod or {}).get("gst_rate", 18.0)
        lines.append({
            "product_id": li.get("product_id"),
            "sku": li.get("sku") or (prod or {}).get("sku", ""),
            "description": li.get("product_name") or (prod or {}).get("name", ""),
            "hsn": hsn,
            "qty": qty,
            "unit": "PCS",
            "unit_price": price,
            "discount_percent": 0.0,
            "gst_percent": float(gst_pct or 18),
        })
    return {
        "dc": dc,
        "franchise": franchise,
        "lines": lines,
    }


async def _materialize_tax_invoice(body_data: dict, user: dict, source_type: str = "manual",
                                    challan_id: Optional[str] = None) -> dict:
    """Common helper to create a draft TaxInvoice given resolved inputs."""
    org = await get_org_settings_doc()
    line_items_raw = body_data.get("line_items") or []
    line_items: List[dict] = []
    for li in line_items_raw:
        line_items.append({
            "product_id": li.get("product_id"),
            "sku": li.get("sku") or "",
            "description": li.get("description") or "",
            "hsn": li.get("hsn") or "",
            "qty": float(li.get("qty") or 0),
            "unit": li.get("unit") or "PCS",
            "unit_price": float(li.get("unit_price") or 0),
            "discount_percent": float(li.get("discount_percent") or 0),
            "gst_percent": float(li.get("gst_percent") or 18.0),
            "taxable_value": 0.0, "cgst_amount": 0.0, "sgst_amount": 0.0,
            "igst_amount": 0.0, "cess_amount": 0.0, "line_total": 0.0,
        })
    billing_state_code = body_data.get("billing_state_code") or _state_code_from_gstin(body_data.get("billing_gstin") or "")
    org_state_code = org.get("state_code") or _state_code_from_gstin(org.get("gstin") or "")
    is_inter_state = bool(billing_state_code and org_state_code and billing_state_code != org_state_code)
    totals = _recompute_totals(line_items, is_inter_state)

    inv = TaxInvoice(
        source_type=source_type,
        challan_id=challan_id,
        invoice_date=body_data.get("invoice_date") or now_iso()[:10],
        due_date=body_data.get("due_date") or "",
        franchise_id=body_data.get("franchise_id"),
        franchise_code=body_data.get("franchise_code", "") or "",
        franchise_name=body_data.get("franchise_name", "") or body_data.get("billing_name", "") or "",
        billing_name=body_data.get("billing_name", "") or body_data.get("franchise_name", "") or "",
        billing_address=body_data.get("billing_address", "") or "",
        billing_gstin=body_data.get("billing_gstin", "") or "",
        billing_state=body_data.get("billing_state", "") or "",
        billing_state_code=billing_state_code,
        shipping_address=body_data.get("shipping_address", "") or body_data.get("billing_address", "") or "",
        contact_phone=body_data.get("contact_phone", "") or "",
        contact_email=body_data.get("contact_email", "") or "",
        place_of_supply=body_data.get("place_of_supply", "") or "",
        is_inter_state=is_inter_state,
        line_items=[TaxInvoiceLineItem(**li) for li in line_items],
        terms=body_data.get("terms") if body_data.get("terms") is not None else (org.get("default_terms") or ""),
        notes=body_data.get("notes", "") or "",
        payment_terms=body_data.get("payment_terms") or "Net 30",
        dc_number=body_data.get("dc_number"),
        indent_id=body_data.get("indent_id"),
        created_by=user["id"],
        **totals,
    )
    await _db.tax_invoices.insert_one(inv.model_dump())
    return inv.model_dump()


@router.post("/tax-invoices", tags=["tax_invoices"])
async def create_tax_invoice(body: TaxInvoiceCreateIn, request: Request,
                              user: dict = Depends(require_roles("super_admin", "hub_accountant"))):
    data = body.model_dump()
    if body.source_type == "challan":
        if not body.challan_id:
            raise HTTPException(400, "challan_id is required when source_type='challan'")
        built = await _build_invoice_from_challan(body.challan_id)
        dc = built["dc"]
        franchise = built["franchise"]
        # Override fields from challan unless explicitly provided (non-None)
        if not data.get("franchise_id"):
            data["franchise_id"] = dc.get("franchise_id")
        data["franchise_name"] = franchise.get("name") or dc.get("franchise_name") or ""
        data["franchise_code"] = franchise.get("code") or ""
        data["dc_number"] = dc.get("dc_number")
        data["indent_id"] = dc.get("indent_id")
        if not data.get("billing_name"):
            data["billing_name"] = franchise.get("name") or ""
        if not data.get("billing_address"):
            data["billing_address"] = franchise.get("address") or ""
        if not data.get("billing_gstin"):
            data["billing_gstin"] = franchise.get("gstin") or ""
        if not data.get("billing_state"):
            data["billing_state"] = franchise.get("state") or ""
        if not data.get("billing_state_code"):
            data["billing_state_code"] = _state_code_from_gstin(franchise.get("gstin") or "")
        if not data.get("contact_email"):
            data["contact_email"] = franchise.get("contact_email") or ""
        if not data.get("contact_phone"):
            data["contact_phone"] = franchise.get("contact_phone") or ""
        if not data.get("place_of_supply") and data.get("billing_state_code"):
            data["place_of_supply"] = f"{data['billing_state_code']}-{data.get('billing_state','')}"
        # Pre-fill lines if caller didn't supply
        if not data.get("line_items"):
            data["line_items"] = built["lines"]
    inv = await _materialize_tax_invoice(
        data, user,
        source_type=body.source_type,
        challan_id=body.challan_id,
    )
    await _log_audit(user, "tax_invoice.create", "tax_invoice", inv["id"],
                     after={"source": body.source_type, "challan_id": body.challan_id,
                            "grand_total": inv["grand_total"]}, request=request)
    return inv


@router.get("/tax-invoices/{tid}", tags=["tax_invoices"])
async def get_tax_invoice(tid: str, user: dict = Depends(get_current_user)):
    doc = await _db.tax_invoices.find_one({"id": tid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Tax invoice not found")
    if user["role"] == "franchise_manager" and doc.get("franchise_id") != user.get("franchise_id"):
        raise HTTPException(403, "Forbidden")
    return doc


class TaxInvoiceUpdateIn(BaseModel):
    invoice_number: Optional[str] = None  # super_admin override allowed (Phase 4)
    invoice_date: Optional[str] = None
    due_date: Optional[str] = None
    franchise_id: Optional[str] = None
    billing_name: Optional[str] = None
    billing_address: Optional[str] = None
    billing_gstin: Optional[str] = None
    billing_state: Optional[str] = None
    billing_state_code: Optional[str] = None
    shipping_address: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    place_of_supply: Optional[str] = None
    line_items: Optional[List[TaxInvoiceLineItemIn]] = None
    terms: Optional[str] = None
    notes: Optional[str] = None
    payment_terms: Optional[str] = None


@router.put("/tax-invoices/{tid}", tags=["tax_invoices"])
async def update_tax_invoice(tid: str, body: TaxInvoiceUpdateIn, request: Request,
                              user: dict = Depends(require_roles("super_admin", "hub_accountant"))):
    cur = await _db.tax_invoices.find_one({"id": tid}, {"_id": 0})
    if not cur:
        raise HTTPException(404, "Not found")
    if cur.get("status") == "cancelled":
        raise HTTPException(409, "Cannot edit a cancelled invoice")

    patch_in = body.model_dump(exclude_none=True)
    # Invoice number override — must be unique (Phase 4)
    if patch_in.get("invoice_number") and patch_in["invoice_number"] != cur.get("invoice_number"):
        existing = await _db.tax_invoices.find_one(
            {"invoice_number": patch_in["invoice_number"], "id": {"$ne": tid}}, {"_id": 0, "id": 1}
        )
        if existing:
            raise HTTPException(409, f"Invoice number {patch_in['invoice_number']} already in use")
    # If line_items changed → recompute totals
    if "line_items" in patch_in:
        new_lines = []
        for li in patch_in["line_items"]:
            new_lines.append({
                "product_id": li.get("product_id"),
                "sku": li.get("sku") or "",
                "description": li.get("description") or "",
                "hsn": li.get("hsn") or "",
                "qty": float(li.get("qty") or 0),
                "unit": li.get("unit") or "PCS",
                "unit_price": float(li.get("unit_price") or 0),
                "discount_percent": float(li.get("discount_percent") or 0),
                "gst_percent": float(li.get("gst_percent") or 18.0),
                "taxable_value": 0.0, "cgst_amount": 0.0, "sgst_amount": 0.0,
                "igst_amount": 0.0, "cess_amount": 0.0, "line_total": 0.0,
            })
        patch_in["line_items"] = new_lines

    merged = {**cur, **patch_in}
    org = await get_org_settings_doc()
    org_state_code = org.get("state_code") or _state_code_from_gstin(org.get("gstin") or "")
    bsc = merged.get("billing_state_code") or _state_code_from_gstin(merged.get("billing_gstin") or "")
    merged["billing_state_code"] = bsc
    merged["is_inter_state"] = bool(bsc and org_state_code and bsc != org_state_code)
    # Recompute always (since gstin/place_of_supply may have changed)
    totals = _recompute_totals(merged.get("line_items", []), merged["is_inter_state"])
    merged.update(totals)

    await _db.tax_invoices.update_one({"id": tid}, {"$set": merged})
    await _log_audit(user, "tax_invoice.update", "tax_invoice", tid,
                     after={"grand_total": merged["grand_total"]}, request=request)
    return await _db.tax_invoices.find_one({"id": tid}, {"_id": 0})


@router.post("/tax-invoices/{tid}/issue", tags=["tax_invoices"])
async def issue_tax_invoice(tid: str, request: Request,
                             user: dict = Depends(require_roles("super_admin", "hub_accountant"))):
    cur = await _db.tax_invoices.find_one({"id": tid}, {"_id": 0})
    if not cur:
        raise HTTPException(404, "Not found")
    if cur.get("status") != "draft":
        raise HTTPException(409, f"Only drafts can be issued (current: {cur.get('status')})")
    if not cur.get("line_items"):
        raise HTTPException(400, "Cannot issue an invoice with no line items")
    if not cur.get("billing_name"):
        raise HTTPException(400, "Billing name is required to issue")
    org = await get_org_settings_doc()
    inv_number = await _next_tax_invoice_number(org)
    await _db.tax_invoices.update_one(
        {"id": tid},
        {"$set": {"status": "issued", "invoice_number": inv_number, "issued_at": now_iso()}},
    )
    await _log_audit(user, "tax_invoice.issue", "tax_invoice", tid,
                     after={"invoice_number": inv_number}, request=request)
    return await _db.tax_invoices.find_one({"id": tid}, {"_id": 0})


class CancelIn(BaseModel):
    reason: str = ""


@router.post("/tax-invoices/{tid}/cancel", tags=["tax_invoices"])
async def cancel_tax_invoice(tid: str, body: CancelIn, request: Request,
                              user: dict = Depends(require_roles("super_admin", "hub_accountant"))):
    cur = await _db.tax_invoices.find_one({"id": tid}, {"_id": 0})
    if not cur:
        raise HTTPException(404, "Not found")
    if cur.get("status") == "cancelled":
        return cur
    await _db.tax_invoices.update_one(
        {"id": tid},
        {"$set": {"status": "cancelled", "cancelled_at": now_iso(),
                  "cancelled_reason": body.reason or ""}},
    )
    await _log_audit(user, "tax_invoice.cancel", "tax_invoice", tid,
                     after={"reason": body.reason}, request=request)
    return await _db.tax_invoices.find_one({"id": tid}, {"_id": 0})


@router.post("/tax-invoices/{tid}/mark-paid", tags=["tax_invoices"])
async def mark_paid(tid: str, request: Request,
                     user: dict = Depends(require_roles("super_admin", "hub_accountant"))):
    cur = await _db.tax_invoices.find_one({"id": tid}, {"_id": 0})
    if not cur:
        raise HTTPException(404, "Not found")
    if cur.get("status") != "issued":
        raise HTTPException(409, f"Only issued invoices can be marked paid (current: {cur.get('status')})")
    await _db.tax_invoices.update_one(
        {"id": tid}, {"$set": {"status": "paid", "paid_at": now_iso()}},
    )
    await _log_audit(user, "tax_invoice.paid", "tax_invoice", tid, request=request)
    return await _db.tax_invoices.find_one({"id": tid}, {"_id": 0})


# ---------------- DC ↔ Tax Invoice ----------------
@router.post("/delivery-challans/{dcid}/create-tax-invoice", tags=["tax_invoices"])
async def create_tax_invoice_from_dc(dcid: str, request: Request,
                                      user: dict = Depends(require_roles("super_admin", "hub_accountant"))):
    """Manual button: generate a draft tax invoice from a delivery challan."""
    # Refuse if a non-cancelled tax invoice already exists for this DC
    existing = await _db.tax_invoices.find_one(
        {"challan_id": dcid, "status": {"$ne": "cancelled"}}, {"_id": 0},
    )
    if existing:
        return {"ok": True, "tax_invoice": existing, "reused": True}
    inv = await auto_create_tax_invoice_for_dc(dcid, user)
    if not inv:
        raise HTTPException(404, "Delivery challan not found")
    await _log_audit(user, "tax_invoice.manual_create_from_dc", "tax_invoice", inv["id"],
                     after={"dc_id": dcid}, request=request)
    return {"ok": True, "tax_invoice": inv, "reused": False}


async def auto_create_tax_invoice_for_dc(dc_id: str, user: dict) -> Optional[dict]:
    """Used by server.py after DC delivery. Returns the new (or existing) tax invoice doc.

    Respects org_settings.auto_create_tax_invoice_on_delivery toggle when called
    from the auto-hook (server.py passes the flag check before calling this).
    Idempotent: if a non-cancelled tax invoice already exists for this DC, returns it.
    """
    existing = await _db.tax_invoices.find_one(
        {"challan_id": dc_id, "status": {"$ne": "cancelled"}}, {"_id": 0},
    )
    if existing:
        return existing
    try:
        built = await _build_invoice_from_challan(dc_id)
    except HTTPException:
        return None
    dc = built["dc"]
    franchise = built["franchise"]
    data = {
        "franchise_id": dc.get("franchise_id"),
        "franchise_name": franchise.get("name") or dc.get("franchise_name") or "",
        "franchise_code": franchise.get("code") or "",
        "billing_name": franchise.get("name") or "",
        "billing_address": franchise.get("address") or "",
        "billing_gstin": franchise.get("gstin") or "",
        "billing_state": franchise.get("state") or "",
        "billing_state_code": _state_code_from_gstin(franchise.get("gstin") or ""),
        "shipping_address": franchise.get("address") or "",
        "contact_phone": franchise.get("contact_phone") or "",
        "contact_email": franchise.get("contact_email") or "",
        "place_of_supply": (
            f"{_state_code_from_gstin(franchise.get('gstin') or '')}-{franchise.get('state') or ''}"
            if franchise.get("state") else ""
        ),
        "dc_number": dc.get("dc_number"),
        "indent_id": dc.get("indent_id"),
        "line_items": built["lines"],
    }
    return await _materialize_tax_invoice(data, user, source_type="challan", challan_id=dc_id)


# ---------------- mailto helper ----------------
@router.get("/tax-invoices/{tid}/mailto", tags=["tax_invoices"])
async def mailto_link(tid: str, user: dict = Depends(get_current_user)):
    inv = await _db.tax_invoices.find_one({"id": tid}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Not found")
    org = await get_org_settings_doc()
    to = inv.get("contact_email") or ""
    subject = f"Tax Invoice {inv.get('invoice_number') or '(draft)'} from {org.get('legal_name','')}"
    body_lines = [
        f"Dear {inv.get('billing_name') or 'Customer'},",
        "",
        f"Please find attached our Tax Invoice {inv.get('invoice_number') or '(draft)'} dated {inv.get('invoice_date','')}.",
        f"Grand Total: ₹ {inv.get('grand_total', 0):.2f} ({inv.get('amount_in_words','')}).",
        "",
        f"Payment Terms: {inv.get('payment_terms', '')}",
        "",
        "Regards,",
        org.get("legal_name", ""),
        org.get("phone", ""),
        org.get("email", ""),
    ]
    body = "\n".join(body_lines)
    url = f"mailto:{urllib.parse.quote(to)}?subject={urllib.parse.quote(subject)}&body={urllib.parse.quote(body)}"
    return {"url": url, "to": to, "subject": subject}


# ---------------- PDF ----------------
@router.get("/tax-invoices/{tid}/pdf", tags=["tax_invoices"])
async def tax_invoice_pdf(tid: str, view: str = "customer", user: dict = Depends(get_current_user)):
    """`view=customer` (default) — hides cost / margin / discount columns.
       `view=internal` — shows full pricing breakdown for super_admin / hub_accountant."""
    inv = await _db.tax_invoices.find_one({"id": tid}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Not found")
    # Only privileged roles may request the internal copy
    internal = (view == "internal") and user.get("role") in {"super_admin", "hub_accountant", "warehouse_manager"}
    org = await get_org_settings_doc()
    pdf = _render_tax_invoice_pdf(inv, org, internal=internal)
    name = (inv.get("invoice_number") or "draft").replace("/", "-")
    suffix = "-internal" if internal else ""
    return StreamingResponse(
        io.BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="tax-invoice-{name}{suffix}.pdf"'},
    )


def _render_tax_invoice_pdf(inv: dict, org: dict, internal: bool = False) -> bytes:
    """Professional GST-compliant Tax Invoice PDF via reportlab."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether,
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=12 * mm, rightMargin=12 * mm,
                            topMargin=10 * mm, bottomMargin=10 * mm)
    styles = getSampleStyleSheet()
    h_style = ParagraphStyle("hdr", parent=styles["Normal"], fontSize=8, leading=10)
    small = ParagraphStyle("sm", parent=styles["Normal"], fontSize=7, leading=9, textColor=colors.HexColor("#555"))
    label = ParagraphStyle("lb", parent=styles["Normal"], fontSize=7, leading=9, textColor=colors.HexColor("#777"))
    big = ParagraphStyle("bg", parent=styles["Normal"], fontSize=11, leading=14, textColor=colors.black, alignment=0, spaceAfter=2)
    title = ParagraphStyle("ttl", parent=styles["Normal"], fontSize=16, leading=20, alignment=1, spaceAfter=3, textColor=colors.white, backColor=colors.HexColor("#7a1f1f"), borderPadding=6)
    subtitle = ParagraphStyle("sub", parent=styles["Normal"], fontSize=9, leading=11, alignment=1, textColor=colors.HexColor("#555"))

    elements: list = []

    # ---- Title bar ----
    elements.append(Paragraph(f"<b>TAX INVOICE</b>", title))
    elements.append(Paragraph(f"Original for Recipient &nbsp;·&nbsp; {'Inter-State Supply (IGST)' if inv.get('is_inter_state') else 'Intra-State Supply (CGST + SGST)'}", subtitle))
    if internal:
        internal_banner = ParagraphStyle("ib", parent=styles["Normal"], fontSize=9, leading=11,
                                          alignment=1, textColor=colors.white,
                                          backColor=colors.HexColor("#0f172a"), borderPadding=4)
        elements.append(Spacer(0, 2))
        elements.append(Paragraph("<b>INTERNAL COPY — NOT FOR CUSTOMER</b> · shows cost / margin / discount", internal_banner))
    elements.append(Spacer(1, 4))

    # ---- Header: org info + invoice meta ----
    org_block = [
        Paragraph(f"<b>{org.get('legal_name','')}</b>", big),
        Paragraph(org.get("address_line1", ""), h_style),
        Paragraph(org.get("address_line2", ""), h_style) if org.get("address_line2") else Paragraph("", h_style),
        Paragraph(f"{org.get('city','')}, {org.get('state','')} {org.get('pincode','')}", h_style),
        Paragraph(f"GSTIN: <b>{org.get('gstin','')}</b>   PAN: {org.get('pan','')}", h_style),
        Paragraph(f"Phone: {org.get('phone','')}   Email: {org.get('email','')}", h_style),
    ]
    meta_block_rows = [
        ["Invoice No.", inv.get("invoice_number") or "DRAFT"],
        ["Invoice Date", inv.get("invoice_date") or ""],
        ["Due Date", inv.get("due_date") or ""],
        ["Place of Supply", inv.get("place_of_supply") or ""],
        ["Status", (inv.get("status") or "").upper()],
    ]
    if inv.get("dc_number"):
        meta_block_rows.insert(2, ["DC No.", inv.get("dc_number")])

    meta_tbl = Table(meta_block_rows, colWidths=[28 * mm, 50 * mm])
    meta_tbl.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#777")),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#FAFAFA")),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDDDDD")),
        ("INNERGRID", (0, 0), (-1, -1), 0.2, colors.HexColor("#EEEEEE")),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))

    hdr_tbl = Table([[org_block, meta_tbl]], colWidths=[110 * mm, 78 * mm])
    hdr_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    elements.append(hdr_tbl)
    elements.append(Spacer(1, 6))

    # ---- Bill to / Ship to ----
    bill_block = [
        Paragraph("<b>Bill To</b>", label),
        Paragraph(f"<b>{inv.get('billing_name','')}</b>", h_style),
        Paragraph(inv.get("billing_address", ""), h_style),
        Paragraph(f"State: {inv.get('billing_state','')} ({inv.get('billing_state_code','')})", h_style),
        Paragraph(f"GSTIN: <b>{inv.get('billing_gstin','—')}</b>", h_style),
        Paragraph(f"Phone: {inv.get('contact_phone','')}   Email: {inv.get('contact_email','')}", h_style),
    ]
    ship_block = [
        Paragraph("<b>Ship To</b>", label),
        Paragraph(inv.get("shipping_address", "") or inv.get("billing_address", ""), h_style),
    ]
    bt_tbl = Table([[bill_block, ship_block]], colWidths=[94 * mm, 94 * mm])
    bt_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDDDDD")),
        ("LINEAFTER", (0, 0), (0, -1), 0.4, colors.HexColor("#DDDDDD")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(bt_tbl)
    elements.append(Spacer(1, 6))

    # ---- Line items table ----
    is_inter = inv.get("is_inter_state")
    header_row = ["#", "Description", "HSN", "Qty", "Unit", "Rate", "Disc%", "Taxable"]
    if is_inter:
        header_row += ["IGST", "Total"]
    else:
        header_row += ["CGST", "SGST", "Total"]
    data = [header_row]

    for i, li in enumerate(inv.get("line_items", []) or [], 1):
        row = [
            str(i),
            Paragraph(f"<b>{li.get('description','')}</b><br/><font size=6 color='#888'>SKU: {li.get('sku','')}</font>", h_style),
            li.get("hsn", ""),
            f"{li.get('qty', 0):g}",
            li.get("unit", ""),
            f"{li.get('unit_price', 0):.2f}",
            f"{li.get('discount_percent', 0):.0f}%",
            f"{li.get('taxable_value', 0):.2f}",
        ]
        if is_inter:
            row += [
                f"{li.get('igst_amount', 0):.2f}\n({li.get('gst_percent', 0):.0f}%)",
                f"{li.get('line_total', 0):.2f}",
            ]
        else:
            row += [
                f"{li.get('cgst_amount', 0):.2f}\n({li.get('gst_percent', 0)/2:.1f}%)",
                f"{li.get('sgst_amount', 0):.2f}\n({li.get('gst_percent', 0)/2:.1f}%)",
                f"{li.get('line_total', 0):.2f}",
            ]
        data.append(row)

    if is_inter:
        col_widths = [6 * mm, 64 * mm, 14 * mm, 12 * mm, 10 * mm, 16 * mm, 12 * mm, 18 * mm, 16 * mm, 20 * mm]
    else:
        col_widths = [6 * mm, 54 * mm, 13 * mm, 11 * mm, 10 * mm, 14 * mm, 11 * mm, 17 * mm, 16 * mm, 16 * mm, 20 * mm]

    items_tbl = Table(data, colWidths=col_widths, repeatRows=1)
    items_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111111")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 7),
        ("FONTSIZE", (0, 1), (-1, -1), 7),
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
    elements.append(Spacer(1, 4))

    # ---- Totals box ----
    totals_rows = [
        ["Subtotal (Taxable)", f"₹ {inv.get('subtotal', 0):.2f}"],
    ]
    if (inv.get("total_discount") or 0) > 0:
        totals_rows.append(["Total Discount", f"₹ {inv.get('total_discount', 0):.2f}"])
    if is_inter:
        totals_rows.append(["IGST", f"₹ {inv.get('igst_total', 0):.2f}"])
    else:
        totals_rows.append(["CGST", f"₹ {inv.get('cgst_total', 0):.2f}"])
        totals_rows.append(["SGST", f"₹ {inv.get('sgst_total', 0):.2f}"])
    if (inv.get("round_off") or 0) != 0:
        totals_rows.append(["Round Off", f"₹ {inv.get('round_off', 0):.2f}"])
    totals_rows.append(["GRAND TOTAL", f"₹ {inv.get('grand_total', 0):.2f}"])

    totals_tbl = Table(totals_rows, colWidths=[50 * mm, 38 * mm])
    totals_tbl.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -2), 8),
        ("FONTSIZE", (0, -1), (-1, -1), 9.5),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#111111")),
        ("TEXTCOLOR", (0, -1), (-1, -1), colors.white),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#BBBBBB")),
        ("INNERGRID", (0, 0), (-1, -1), 0.2, colors.HexColor("#DDDDDD")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))

    # ---- Amount-in-words + totals layout side-by-side ----
    words_block = [
        Paragraph("<b>Amount in Words</b>", label),
        Paragraph(inv.get("amount_in_words", ""), h_style),
        Spacer(1, 4),
        Paragraph(f"<b>Payment Terms:</b> {inv.get('payment_terms','')}", h_style),
    ]
    bottom_tbl = Table([[words_block, totals_tbl]], colWidths=[100 * mm, 88 * mm])
    bottom_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    elements.append(bottom_tbl)
    elements.append(Spacer(1, 6))

    # ---- Bank details + terms + signature ----
    bank_lines = []
    if any([org.get("bank_name"), org.get("bank_account"), org.get("bank_ifsc")]):
        bank_lines.append(Paragraph("<b>Bank Details</b>", label))
        bank_lines.append(Paragraph(f"Bank: {org.get('bank_name','')}", h_style))
        bank_lines.append(Paragraph(f"A/C No: {org.get('bank_account','')}", h_style))
        bank_lines.append(Paragraph(f"IFSC: {org.get('bank_ifsc','')}", h_style))
        if org.get("bank_branch"):
            bank_lines.append(Paragraph(f"Branch: {org.get('bank_branch','')}", h_style))

    sig_block = [
        Spacer(1, 24),
        Paragraph(f"For <b>{org.get('legal_name','')}</b>", h_style),
        Spacer(1, 18),
        Paragraph("Authorised Signatory", small),
    ]
    bank_sig_tbl = Table([[bank_lines or [Paragraph("", h_style)], sig_block]],
                          colWidths=[110 * mm, 78 * mm])
    bank_sig_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDDDDD")),
        ("LINEAFTER", (0, 0), (0, -1), 0.4, colors.HexColor("#DDDDDD")),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
    ]))
    elements.append(bank_sig_tbl)

    # ---- Terms ----
    terms_text = inv.get("terms") or ""
    if terms_text:
        elements.append(Spacer(1, 6))
        elements.append(Paragraph("<b>Terms &amp; Conditions</b>", label))
        for line in terms_text.split("\n"):
            elements.append(Paragraph(line, small))

    if inv.get("notes"):
        elements.append(Spacer(1, 4))
        elements.append(Paragraph(f"<b>Notes:</b> {inv.get('notes','')}", small))

    # ---- Page 2: ACKNOWLEDGEMENT COPY ----
    from reportlab.platypus import PageBreak
    elements.append(PageBreak())
    ack_banner_style = ParagraphStyle("ack", parent=styles["Normal"], fontSize=18, leading=22,
                                       alignment=1, textColor=colors.white,
                                       backColor=colors.HexColor("#7a1f1f"),
                                       spaceBefore=4, spaceAfter=6)
    elements.append(Paragraph("<b>ACKNOWLEDGEMENT</b>", ack_banner_style))
    elements.append(Spacer(1, 6))

    ack_left = [
        Paragraph("<b>Invoice To</b>", label),
        Paragraph(f"<b>{inv.get('billing_name','')}</b>", h_style),
        Paragraph(inv.get("billing_address", ""), h_style),
        Paragraph(f"GSTIN: <b>{inv.get('billing_gstin','—')}</b>", h_style),
    ]
    ack_right = [
        Paragraph("<b>Invoice Details</b>", label),
        Paragraph(f"Invoice No.: <b>{inv.get('invoice_number') or 'DRAFT'}</b>", h_style),
        Paragraph(f"Invoice Date: <b>{inv.get('invoice_date','')}</b>", h_style),
        Paragraph(f"Invoice Amount: <b>₹ {inv.get('grand_total', 0):.2f}</b>", h_style),
        Spacer(1, 6),
        Paragraph("<b>Seller</b>", label),
        Paragraph(f"<b>{org.get('legal_name','')}</b>", h_style),
        Paragraph(f"GSTIN: {org.get('gstin','')}", h_style),
        Paragraph(f"State: {org.get('state','')}", h_style),
    ]
    ack_tbl = Table([[ack_left, ack_right]], colWidths=[94 * mm, 94 * mm])
    ack_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDDDDD")),
        ("LINEAFTER", (0, 0), (0, -1), 0.4, colors.HexColor("#DDDDDD")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(ack_tbl)
    elements.append(Spacer(1, 40))

    rec_block = [
        Spacer(1, 60),
        Paragraph("<para align='right'><b>Receiver's Seal &amp; Sign</b></para>", h_style),
        Paragraph("<para align='right'>____________________________</para>", small),
    ]
    elements.extend(rec_block)

    doc.build(elements)
    return buf.getvalue()
