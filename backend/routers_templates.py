"""v2.8 — Franchise Model Templates ("Starter Kits") + Auto-Discount support.

Endpoints
---------
GET    /api/franchise-model-templates                     → list all
GET    /api/franchise-model-templates/{model_name}         → fetch by model name
POST   /api/franchise-model-templates                     → upsert (super_admin only)
PUT    /api/franchise-model-templates/{model_name}         → replace items / margin / discount
DELETE /api/franchise-model-templates/{model_name}         → remove (super_admin only)

GET    /api/franchises/{fid}/has-stock-history             → bool — true if franchise
                                                              has EVER been on a fulfilled/issued
                                                              indent or delivery challan
GET    /api/franchises/{fid}/starter-kit                   → resolve template based on franchise's
                                                              startup_model and return ready-to-load
                                                              line_items array for New Order
GET    /api/reports/discount-summary?from=&to=&franchise_id= → revenue/discount/profit aggregate
"""
from __future__ import annotations
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel

from auth_utils import get_current_user, require_roles
from models import FranchiseModelTemplate, TemplateItem, now_iso

logger = logging.getLogger(__name__)
router = APIRouter()

_db = None
_log_audit = None


def init(db, log_audit_fn):
    global _db, _log_audit
    _db = db
    _log_audit = log_audit_fn


# ---------- LIST ----------
@router.get("/franchise-model-templates", tags=["templates"])
async def list_templates(_: dict = Depends(get_current_user)):
    rows = await _db.franchise_model_templates.find({}, {"_id": 0}).to_list(100)
    return rows


@router.get("/franchise-model-templates/{model_name}", tags=["templates"])
async def get_template(model_name: str, _: dict = Depends(get_current_user)):
    doc = await _db.franchise_model_templates.find_one(
        {"model_name": model_name.upper()}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(404, f"No template for model {model_name}")
    return doc


# ---------- CREATE / UPSERT ----------
class TemplateUpsertIn(BaseModel):
    model_name: str
    default_margin: float = 22.0
    default_discount: float = 0.0
    items: list[dict] = []


@router.post("/franchise-model-templates", tags=["templates"])
async def upsert_template(body: TemplateUpsertIn, request: Request,
                           actor: dict = Depends(require_roles("super_admin"))):
    name = body.model_name.strip().upper()
    if not name:
        raise HTTPException(400, "model_name is required")
    existing = await _db.franchise_model_templates.find_one({"model_name": name}, {"_id": 0})
    # enrich items with current product_name/sku where possible
    enriched: list[dict] = []
    for it in body.items:
        pid = it.get("product_id")
        if not pid:
            continue
        prod = await _db.products.find_one({"id": pid}, {"_id": 0, "name": 1, "sku": 1})
        enriched.append({
            "sku": (prod or {}).get("sku") or it.get("sku", ""),
            "product_id": pid,
            "product_name": (prod or {}).get("name") or it.get("product_name", ""),
            "recommended_qty": float(it.get("recommended_qty") or 0),
        })
    if existing:
        await _db.franchise_model_templates.update_one(
            {"model_name": name},
            {"$set": {
                "default_margin": body.default_margin,
                "default_discount": body.default_discount,
                "items": enriched,
                "updated_at": now_iso(),
                "updated_by": actor["id"],
            }},
        )
        if _log_audit:
            await _log_audit(actor, "template.update", "franchise_model_template", name, request=request)
    else:
        tpl = FranchiseModelTemplate(
            model_name=name,
            default_margin=body.default_margin,
            default_discount=body.default_discount,
            items=[TemplateItem(**i) for i in enriched],
        )
        await _db.franchise_model_templates.insert_one(tpl.model_dump())
        if _log_audit:
            await _log_audit(actor, "template.create", "franchise_model_template", name, request=request)
    return await _db.franchise_model_templates.find_one({"model_name": name}, {"_id": 0})


@router.put("/franchise-model-templates/{model_name}", tags=["templates"])
async def replace_template(model_name: str, body: TemplateUpsertIn, request: Request,
                            actor: dict = Depends(require_roles("super_admin"))):
    body.model_name = model_name  # path wins
    return await upsert_template(body, request, actor)  # type: ignore[arg-type]


@router.delete("/franchise-model-templates/{model_name}", tags=["templates"])
async def delete_template(model_name: str, request: Request,
                           actor: dict = Depends(require_roles("super_admin"))):
    name = model_name.upper()
    r = await _db.franchise_model_templates.delete_one({"model_name": name})
    if r.deleted_count == 0:
        raise HTTPException(404, "Template not found")
    if _log_audit:
        await _log_audit(actor, "template.delete", "franchise_model_template", name, request=request)
    return {"ok": True}


# ---------- Has-stock-history (for "first order" detection) ----------
@router.get("/franchises/{fid}/has-stock-history", tags=["templates"])
async def has_stock_history(fid: str, _: dict = Depends(get_current_user)):
    """Return {has_history: bool}. A franchise is considered 'new' if no fulfilled
    indent (status in dispatched/delivered) AND no delivery challan exists for it."""
    fr = await _db.franchises.find_one({"id": fid}, {"_id": 0, "id": 1})
    if not fr:
        raise HTTPException(404, "Franchise not found")
    indent = await _db.indents.find_one(
        {"franchise_id": fid, "status": {"$in": ["dispatched", "delivered", "fulfilled", "partial"]}},
        {"_id": 0, "id": 1},
    )
    if indent:
        return {"has_history": True, "reason": "indent"}
    dc = await _db.delivery_challans.find_one({"franchise_id": fid}, {"_id": 0, "id": 1})
    if dc:
        return {"has_history": True, "reason": "delivery_challan"}
    return {"has_history": False}


# ---------- Starter-kit resolver ----------
@router.get("/franchises/{fid}/starter-kit", tags=["templates"])
async def franchise_starter_kit(fid: str, _: dict = Depends(get_current_user)):
    """Resolve the franchise's startup_model to a ready-to-load list of line items.

    Returns: {model_name, default_discount, line_items: [{product_id, sku, product_name,
    requested_qty, unit_price, hub_stock}]}
    """
    fr = await _db.franchises.find_one({"id": fid}, {"_id": 0})
    if not fr:
        raise HTTPException(404, "Franchise not found")
    model = (fr.get("startup_model") or "").upper()
    if not model:
        return {"model_name": "", "default_discount": 0.0, "line_items": [], "_warning": "Franchise has no startup_model assigned"}
    tpl = await _db.franchise_model_templates.find_one({"model_name": model}, {"_id": 0})
    if not tpl:
        return {"model_name": model, "default_discount": 0.0, "line_items": [], "_warning": f"No template configured for model {model}"}

    line_items: list[dict] = []
    for it in tpl.get("items", []):
        pid = it.get("product_id")
        if not pid:
            continue
        prod = await _db.products.find_one({"id": pid}, {"_id": 0})
        if not prod:
            continue
        # resolve hub stock and franchise price
        stock_row = await _db.stock.find_one(
            {"product_id": pid, "location_type": "hub", "location_id": "hub-main"},
            {"_id": 0, "quantity": 1},
        )
        hub_qty = float((stock_row or {}).get("quantity") or 0)
        # Pick a reasonable selling price: franchise_price if known else landing × (1 + margin)
        unit_price = float(prod.get("franchise_price") or 0)
        if unit_price <= 0:
            landing = float(prod.get("landing_price") or prod.get("cost_price") or 0)
            margin = float(tpl.get("default_margin", 22)) / 100.0
            unit_price = round(landing * (1 + margin), 2) if landing else 0.0
        line_items.append({
            "product_id": pid,
            "sku": prod.get("sku") or it.get("sku", ""),
            "product_name": prod.get("name") or it.get("product_name", ""),
            "requested_qty": float(it.get("recommended_qty") or 0),
            "unit_price": unit_price,
            "discount_percent": float(tpl.get("default_discount") or 0),
            "hub_stock": hub_qty,
            "cost_price": float(prod.get("landing_price") or prod.get("cost_price") or 0),
        })
    return {
        "model_name": model,
        "default_discount": float(tpl.get("default_discount") or 0),
        "default_margin": float(tpl.get("default_margin") or 0),
        "line_items": line_items,
    }


# ---------- Reports: Discount summary ----------
@router.get("/reports/discount-summary", tags=["reports"])
async def discount_summary(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    franchise_id: Optional[str] = None,
    actor: dict = Depends(require_roles("super_admin", "hub_accountant", "warehouse_manager")),
):
    """Aggregate revenue before/after discount + profit for fulfilled indents in date range.

    Window matches by Indent.created_at (ISO). Discount field is `discount_percent` per line.
    """
    q: dict = {"status": {"$in": ["dispatched", "delivered", "fulfilled", "partial"]}}
    if franchise_id:
        q["franchise_id"] = franchise_id
    if from_ or to:
        date_q: dict = {}
        if from_:
            date_q["$gte"] = from_
        if to:
            date_q["$lte"] = to
        q["created_at"] = date_q

    rows = await _db.indents.find(q, {"_id": 0}).to_list(5000)
    by_franchise: dict[str, dict] = {}
    grand = {
        "revenue_before_discount": 0.0,
        "discount_given": 0.0,
        "revenue_after_discount": 0.0,
        "cost_total": 0.0,
        "profit_after_discount": 0.0,
        "indents_count": 0,
    }

    for ind in rows:
        fid = ind.get("franchise_id") or "unknown"
        bucket = by_franchise.setdefault(fid, {
            "franchise_id": fid,
            "franchise_name": ind.get("franchise_name") or "",
            "model": "",
            "revenue_before_discount": 0.0,
            "discount_given": 0.0,
            "revenue_after_discount": 0.0,
            "cost_total": 0.0,
            "profit_after_discount": 0.0,
            "indents_count": 0,
        })
        bucket["indents_count"] += 1
        grand["indents_count"] += 1
        for li in (ind.get("line_items") or []):
            qty = float(li.get("allocated_qty") or li.get("requested_qty") or 0)
            unit = float(li.get("unit_price") or 0)
            disc = float(li.get("discount_percent") or 0)
            cost = float(li.get("cost_price") or 0)
            gross = qty * unit
            discount_amt = gross * (disc / 100.0)
            net = gross - discount_amt
            cost_total = qty * cost
            profit = net - cost_total
            bucket["revenue_before_discount"] += gross
            bucket["discount_given"] += discount_amt
            bucket["revenue_after_discount"] += net
            bucket["cost_total"] += cost_total
            bucket["profit_after_discount"] += profit
            grand["revenue_before_discount"] += gross
            grand["discount_given"] += discount_amt
            grand["revenue_after_discount"] += net
            grand["cost_total"] += cost_total
            grand["profit_after_discount"] += profit

    # enrich with model name from franchise doc
    if by_franchise:
        franchises = await _db.franchises.find(
            {"id": {"$in": list(by_franchise.keys())}},
            {"_id": 0, "id": 1, "name": 1, "startup_model": 1},
        ).to_list(500)
        f_map = {f["id"]: f for f in franchises}
        for fid, b in by_franchise.items():
            b["franchise_name"] = (f_map.get(fid) or {}).get("name") or b["franchise_name"]
            b["model"] = (f_map.get(fid) or {}).get("startup_model") or ""
            # round floats
            for k in ("revenue_before_discount", "discount_given", "revenue_after_discount",
                      "cost_total", "profit_after_discount"):
                b[k] = round(b[k], 2)
    for k in ("revenue_before_discount", "discount_given", "revenue_after_discount",
              "cost_total", "profit_after_discount"):
        grand[k] = round(grand[k], 2)

    return {"grand_total": grand, "by_franchise": list(by_franchise.values())}
