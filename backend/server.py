"""Servall Nexus ERP - Main FastAPI app."""
import os
import logging
import shutil
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

from models import (
    User, UserCreate, UserPublic, LoginRequest, LoginResponse, Role,
    Franchise, Vendor, Product, StockItem,
    PurchaseInvoice, InvoiceLineItem,
    PurchaseOrder, POLineItem,
    Indent, IndentLineItem, IndentStatus,
    DeliveryChallan, CycleCount, CycleCountItem,
    AuditLog, Notification, StockMovement, now_iso, gen_id,
)
from auth_utils import (
    hash_password, verify_password, create_token,
    get_current_user, require_roles,
)
from ocr_service import parse_invoice
from seed import seed_demo_data
import ocr_service as _ocr_service_mod
import routers_v21
import routers_v22

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

UPLOAD_DIR = ROOT_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="Servall Nexus ERP")
app.state.db = db

api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")
logger = logging.getLogger("servall")


# ------------ HELPERS ------------
async def log_audit(user: dict, action: str, entity_type: str, entity_id: str,
                    before: Optional[dict] = None, after: Optional[dict] = None,
                    request: Optional[Request] = None):
    log = AuditLog(
        user_id=user["id"],
        user_email=user["email"],
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before=before,
        after=after,
        ip_address=(request.client.host if request and request.client else ""),
    )
    await db.audit_logs.insert_one(log.model_dump())


async def gen_sequence(name: str, prefix: str, pad: int = 4) -> str:
    """Generate a sequential number like PO-0001."""
    doc = await db.counters.find_one_and_update(
        {"_id": name}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    seq = (doc or {}).get("seq", 1)
    return f"{prefix}-{str(seq).zfill(pad)}"


async def get_hub_stock(product_id: str) -> int:
    doc = await db.stock.find_one({"product_id": product_id, "location_type": "hub"}, {"_id": 0})
    return int(doc["quantity"]) if doc else 0


# ------------ V2.1 — shared upload helper used by both OCR + multi-source ordering ------------
ALLOWED_UPLOAD_EXT = {"pdf", "jpg", "jpeg", "png", "webp", "xlsx", "xls", "csv"}
MIME_MAP = {
    "pdf": "application/pdf",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
}


async def save_uploaded_file(file: UploadFile, prefix: str = "upload") -> tuple[str, str]:
    ext = (file.filename or "upload").split(".")[-1].lower()
    if ext not in ALLOWED_UPLOAD_EXT:
        raise HTTPException(400, f"Unsupported file type: .{ext}")
    file_id = gen_id()
    safe_name = f"{prefix}-{file_id}.{ext}"
    file_path = UPLOAD_DIR / safe_name
    with file_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    public_url = f"/uploads/{safe_name}"
    return str(file_path), public_url


# ------------ Tier-aware pricing helper ------------
async def get_franchise_tier(franchise_id: str) -> Optional[dict]:
    fr = await db.franchises.find_one({"id": franchise_id}, {"_id": 0})
    if not fr or not fr.get("tier_id"):
        return None
    return await db.franchise_tiers.find_one({"id": fr["tier_id"]}, {"_id": 0})


def compute_tier_price(landing: float, tier: Optional[dict], category: str, fallback_margin: float = 22.0) -> float:
    if not tier:
        return round(landing * (1 + fallback_margin / 100), 2)
    margin = tier.get("margin_percent", fallback_margin)
    for ov in tier.get("category_overrides", []) or []:
        if (ov.get("category") or "").strip().lower() == (category or "").strip().lower():
            margin = ov.get("margin_percent", margin)
            break
    return round(landing * (1 + float(margin) / 100), 2)



async def adjust_stock(product_id: str, location_type: str, location_id: str, delta: int,
                       reason: str = "", user_id: str = "", user_email: str = "",
                       reference_type: str = "manual", reference_id: str = ""):
    """Atomic stock adjustment. Creates row if absent. Writes immutable stock movement log."""
    existing = await db.stock.find_one(
        {"product_id": product_id, "location_type": location_type, "location_id": location_id},
        {"_id": 0},
    )
    qty_before = int(existing["quantity"]) if existing else 0
    new_qty = max(0, qty_before + delta)
    actual_delta = new_qty - qty_before

    if existing:
        update = {"quantity": new_qty, "updated_at": now_iso()}
        if delta > 0:
            update["last_in_date"] = now_iso()
        elif delta < 0:
            update["last_out_date"] = now_iso()
        await db.stock.update_one({"id": existing["id"]}, {"$set": update})
    else:
        item = StockItem(
            product_id=product_id,
            location_type=location_type,
            location_id=location_id,
            quantity=new_qty,
            last_in_date=now_iso() if delta > 0 else None,
        )
        await db.stock.insert_one(item.model_dump())

    # Get product and location labels for the movement log
    product = await db.products.find_one({"id": product_id}, {"_id": 0, "sku": 1, "name": 1})
    location_label = "Hub Main" if location_type == "hub" else ""
    if location_type == "franchise":
        fr = await db.franchises.find_one({"id": location_id}, {"_id": 0, "name": 1})
        if fr:
            location_label = fr["name"]

    movement = StockMovement(
        product_id=product_id,
        sku=(product or {}).get("sku", ""),
        product_name=(product or {}).get("name", ""),
        location_type=location_type,
        location_id=location_id,
        location_label=location_label,
        delta=actual_delta,
        qty_before=qty_before,
        qty_after=new_qty,
        reason=reason,
        reference_type=reference_type,
        reference_id=reference_id,
        user_id=user_id,
        user_email=user_email,
    )
    await db.stock_movements.insert_one(movement.model_dump())
    return new_qty


# ============ AUTH ============
@api.post("/auth/login", response_model=LoginResponse)
async def login(body: LoginRequest):
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if not user or not verify_password(body.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Account disabled")
    token = create_token(user["id"], user["email"], user["role"])
    user.pop("password_hash", None)
    return {"token": token, "user": user}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@api.get("/users", response_model=List[UserPublic])
async def list_users(_: dict = Depends(require_roles("super_admin"))):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(500)
    return users


@api.post("/users", response_model=UserPublic)
async def create_user(body: UserCreate, request: Request,
                      admin: dict = Depends(require_roles("super_admin"))):
    existing = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="Email already exists")
    u = User(**body.model_dump(exclude={"password"}))
    u.email = u.email.lower()
    doc = u.model_dump()
    doc["password_hash"] = hash_password(body.password)
    await db.users.insert_one(doc)
    await log_audit(admin, "user.create", "user", u.id, after={"email": u.email, "role": u.role}, request=request)
    return u


# ============ FRANCHISES ============
@api.get("/franchises", response_model=List[Franchise])
async def list_franchises(user: dict = Depends(get_current_user)):
    docs = await db.franchises.find({}, {"_id": 0}).to_list(500)
    return docs


@api.post("/franchises", response_model=Franchise)
async def create_franchise(body: Franchise, request: Request,
                            admin: dict = Depends(require_roles("super_admin"))):
    body.id = gen_id()
    body.created_at = now_iso()
    await db.franchises.insert_one(body.model_dump())
    await log_audit(admin, "franchise.create", "franchise", body.id, after=body.model_dump(), request=request)
    return body


@api.put("/franchises/{fid}", response_model=Franchise)
async def update_franchise(fid: str, body: Franchise, request: Request,
                            admin: dict = Depends(require_roles("super_admin"))):
    existing = await db.franchises.find_one({"id": fid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    update = body.model_dump(exclude={"id", "created_at"})
    await db.franchises.update_one({"id": fid}, {"$set": update})
    await log_audit(admin, "franchise.update", "franchise", fid, before=existing, after=update, request=request)
    return {**existing, **update}


# ============ VENDORS ============
@api.get("/vendors", response_model=List[Vendor])
async def list_vendors(user: dict = Depends(get_current_user)):
    docs = await db.vendors.find({}, {"_id": 0}).to_list(500)
    return docs


@api.post("/vendors", response_model=Vendor)
async def create_vendor(body: Vendor, request: Request,
                         admin: dict = Depends(require_roles("super_admin", "hub_accountant"))):
    body.id = gen_id()
    body.created_at = now_iso()
    await db.vendors.insert_one(body.model_dump())
    await log_audit(admin, "vendor.create", "vendor", body.id, after=body.model_dump(), request=request)
    return body


@api.put("/vendors/{vid}", response_model=Vendor)
async def update_vendor(vid: str, body: Vendor, request: Request,
                         admin: dict = Depends(require_roles("super_admin", "hub_accountant"))):
    existing = await db.vendors.find_one({"id": vid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    update = body.model_dump(exclude={"id", "created_at"})
    await db.vendors.update_one({"id": vid}, {"$set": update})
    await log_audit(admin, "vendor.update", "vendor", vid, before=existing, after=update, request=request)
    return {**existing, **update}


# ============ PRODUCTS ============
@api.get("/products")
async def list_products(
    q: str = "",
    category: str = "",
    low_stock: bool = False,
    limit: int = 200,
    user: dict = Depends(get_current_user),
):
    query: dict = {}
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"sku": {"$regex": q, "$options": "i"}},
            {"part_number_oem": {"$regex": q, "$options": "i"}},
            {"part_number_aftermarket": {"$regex": q, "$options": "i"}},
            {"barcode": {"$regex": q, "$options": "i"}},
        ]
    if category:
        query["category"] = category
    docs = await db.products.find(query, {"_id": 0}).limit(limit).to_list(limit)

    # Franchise users: hide all stock and cost data
    is_franchise = user["role"] == "franchise_manager"
    FRANCHISE_SAFE_KEYS = {
        "id", "sku", "name", "brand", "category", "subcategory",
        "part_number_oem", "part_number_aftermarket", "hsn_code",
        "barcode", "qr_code", "unit", "pack_size", "image_url",
        "mrp", "franchise_price", "gst_rate", "active",
    }
    if is_franchise:
        tier = await get_franchise_tier(user.get("franchise_id") or "") if user.get("franchise_id") else None
        out = []
        for d in docs:
            row = {k: v for k, v in d.items() if k in FRANCHISE_SAFE_KEYS}
            if tier:
                row["franchise_price"] = compute_tier_price(
                    d.get("landing_price", 0) or 0, tier,
                    d.get("category", ""), d.get("margin_percent", 22),
                )
            out.append(row)
        return out

    # Warehouse + admin: attach hub & franchise stock metadata
    for d in docs:
        d["hub_stock"] = await get_hub_stock(d["id"])
        fr_total = await db.stock.aggregate([
            {"$match": {"product_id": d["id"], "location_type": "franchise"}},
            {"$group": {"_id": None, "total": {"$sum": "$quantity"}}},
        ]).to_list(1)
        d["franchise_stock"] = fr_total[0]["total"] if fr_total else 0
        d["total_stock"] = d["hub_stock"] + d["franchise_stock"]
        d["low_stock"] = d["hub_stock"] < d.get("safety_stock", 0)
    if low_stock:
        docs = [d for d in docs if d["low_stock"]]
    return docs


@api.get("/products/{pid}")
async def get_product(pid: str, user: dict = Depends(get_current_user)):
    doc = await db.products.find_one({"id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    if user["role"] == "franchise_manager":
        FRANCHISE_SAFE_KEYS = {
            "id", "sku", "name", "brand", "category", "subcategory",
            "part_number_oem", "part_number_aftermarket", "hsn_code",
            "barcode", "qr_code", "unit", "pack_size", "image_url",
            "mrp", "franchise_price", "gst_rate", "active",
        }
        return {k: v for k, v in doc.items() if k in FRANCHISE_SAFE_KEYS}
    doc["hub_stock"] = await get_hub_stock(pid)
    fr_stocks = await db.stock.find({"product_id": pid, "location_type": "franchise"}, {"_id": 0}).to_list(200)
    doc["franchise_stocks"] = fr_stocks
    return doc


@api.post("/products", response_model=Product)
async def create_product(body: Product, request: Request,
                          user: dict = Depends(require_roles("super_admin", "warehouse_manager"))):
    body.id = gen_id()
    body.created_at = now_iso()
    await db.products.insert_one(body.model_dump())
    await log_audit(user, "product.create", "product", body.id, after=body.model_dump(), request=request)
    return body


@api.put("/products/{pid}", response_model=Product)
async def update_product(pid: str, body: Product, request: Request,
                          user: dict = Depends(require_roles("super_admin", "warehouse_manager"))):
    existing = await db.products.find_one({"id": pid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    update = body.model_dump(exclude={"id", "created_at"})
    await db.products.update_one({"id": pid}, {"$set": update})
    await log_audit(user, "product.update", "product", pid, before=existing, after=update, request=request)
    return {**existing, **update}


@api.post("/products/{pid}/adjust-stock")
async def adjust_product_stock(
    pid: str,
    request: Request,
    delta: int = Form(...),
    location_type: str = Form("hub"),
    location_id: str = Form("hub-main"),
    reason: str = Form(""),
    user: dict = Depends(require_roles("super_admin", "warehouse_manager")),
):
    new_qty = await adjust_stock(pid, location_type, location_id, delta, reason,
                                  user["id"], user["email"], "manual", pid)
    await log_audit(user, "stock.adjust", "product", pid, after={"delta": delta, "new_qty": new_qty, "reason": reason}, request=request)
    return {"new_qty": new_qty}


# ============ PRICING / MARGIN BULK UPDATE ============
class BulkMarginRequest(BaseModel):
    category: Optional[str] = None
    margin_percent: float
    update_franchise_price: bool = True
    update_retail_price: bool = True


@api.post("/products/bulk-margin")
async def bulk_margin(body: BulkMarginRequest, request: Request,
                      admin: dict = Depends(require_roles("super_admin"))):
    query = {"category": body.category} if body.category else {}
    products = await db.products.find(query, {"_id": 0}).to_list(2000)
    updated = 0
    for p in products:
        landing = p.get("landing_price", 0) or 0
        new_franchise = round(landing * (1 + body.margin_percent / 100), 2)
        new_retail = round(landing * (1 + (body.margin_percent + 8) / 100), 2)
        upd = {"margin_percent": body.margin_percent}
        if body.update_franchise_price:
            upd["franchise_price"] = new_franchise
        if body.update_retail_price:
            upd["retail_price"] = new_retail
        await db.products.update_one({"id": p["id"]}, {"$set": upd})
        updated += 1
    await log_audit(admin, "pricing.bulk_margin", "product", "bulk",
                    after={"category": body.category, "margin_percent": body.margin_percent, "count": updated},
                    request=request)
    return {"updated": updated}


# ============ INVOICES (PURCHASE) - OCR INGESTION ============
@api.post("/invoices/upload")
async def upload_invoice(
    request: Request,
    file: UploadFile = File(...),
    user: dict = Depends(require_roles("super_admin", "hub_accountant", "warehouse_manager")),
):
    """Upload invoice file (PDF/image), run OCR, return parsed draft."""
    ext = (file.filename or "upload").split(".")[-1].lower()
    if ext not in {"pdf", "jpg", "jpeg", "png", "webp"}:
        raise HTTPException(400, "Unsupported file type")
    file_path_str, public_url = await save_uploaded_file(file, prefix="invoice")
    mime = MIME_MAP.get(ext, "application/octet-stream")

    parsed = await parse_invoice(file_path_str, mime)

    # Try to match vendor by name
    vendor_id = None
    vendor_name = parsed.get("vendor_name", "") or ""
    if vendor_name:
        v = await db.vendors.find_one({"name": {"$regex": vendor_name[:20], "$options": "i"}}, {"_id": 0})
        if v:
            vendor_id = v["id"]

    # Try to match line items to existing products + anomaly detection
    line_items: list = []
    for li in parsed.get("line_items", []) or []:
        pname = li.get("product_name", "") or ""
        sku = li.get("sku", "") or ""
        vendor_alias = (li.get("item_alias") or sku or "").strip()
        product = None
        match_source = None
        auto_matched_alias = False
        # 1) Vendor alias learning engine (highest priority)
        if vendor_alias:
            product = await routers_v21.lookup_alias(vendor_id, vendor_alias)
            if product:
                match_source = "alias"
                auto_matched_alias = True
        # 2) SKU exact
        if not product and sku:
            product = await db.products.find_one({"sku": sku}, {"_id": 0})
            if product:
                match_source = "sku"
        # 3) Name fuzzy
        if not product and pname:
            product = await db.products.find_one(
                {"name": {"$regex": pname[:30], "$options": "i"}}, {"_id": 0}
            )
            if product:
                match_source = "name"
        anomaly = None
        matched = product is not None
        if product:
            old_price = product.get("landing_price", 0) or 0
            new_price = float(li.get("unit_price", 0) or 0)
            if old_price > 0 and new_price > 0:
                pct = (new_price - old_price) / old_price * 100
                if abs(pct) > 10:
                    anomaly = f"Price changed by {pct:+.1f}% vs last purchase"
        else:
            anomaly = "New / unrecognized item"
        line_items.append({
            "product_id": product["id"] if product else None,
            "product_name": pname,
            "sku": (product["sku"] if product else sku),
            "hsn_code": li.get("hsn_code", ""),
            "quantity": float(li.get("quantity", 0) or 0),
            "unit_price": float(li.get("unit_price", 0) or 0),
            "gst_percent": float(li.get("gst_percent", 18) or 18),
            "line_total": float(li.get("line_total", 0) or 0),
            "matched": matched,
            "anomaly": anomaly,
            # V2.1 extras (passed through from OCR)
            "item_alias": li.get("item_alias", ""),
            "unit": li.get("unit", ""),
            "cgst_percent": float(li.get("cgst_percent", 0) or 0),
            "sgst_percent": float(li.get("sgst_percent", 0) or 0),
            "net_amount": float(li.get("net_amount", 0) or 0),
            "qty_valid": bool(li.get("qty_valid", True)),
            "hsn_valid": bool(li.get("hsn_valid", True)),
            "desc_valid": bool(li.get("desc_valid", True)),
            "unit_valid": bool(li.get("unit_valid", True)),
            "row_valid": bool(li.get("row_valid", True)),
            "confidence": float(li.get("confidence", 1.0) or 0),
            # V2.2 confidence split + match metadata
            "llm_confidence": float(li.get("llm_confidence", 1.0) or 0),
            "heuristic_confidence": float(li.get("heuristic_confidence", 1.0) or 0),
            "auto_matched_alias": auto_matched_alias,
            "match_source": match_source,
            "warnings": li.get("warnings", []) or [],
        })

    # Duplicate invoice number check
    inv_number = parsed.get("invoice_number", "") or ""
    duplicate = False
    if inv_number:
        existing = await db.invoices.find_one({"invoice_number": inv_number}, {"_id": 0})
        if existing:
            duplicate = True

    invoice = PurchaseInvoice(
        invoice_number=inv_number,
        vendor_id=vendor_id,
        vendor_name=vendor_name,
        invoice_date=parsed.get("invoice_date", ""),
        total_amount=float(parsed.get("total_amount", 0) or 0),
        cgst=float(parsed.get("cgst", 0) or 0),
        sgst=float(parsed.get("sgst", 0) or 0),
        igst=float(parsed.get("igst", 0) or 0),
        line_items=[InvoiceLineItem(**li) for li in line_items],
        file_url=public_url,
        status="draft",
        raw_ocr_text=parsed.get("_raw", "")[:500],
        confidence_score=float(parsed.get("confidence_score", 0) or 0),
        llm_confidence=float(parsed.get("llm_confidence", 0) or 0),
        heuristic_confidence=float(parsed.get("heuristic_confidence", 0) or 0),
        ocr_provider=parsed.get("provider", ""),
        ocr_model=parsed.get("model", ""),
        created_by=user["id"],
    )
    await db.invoices.insert_one(invoice.model_dump())
    await log_audit(user, "invoice.ocr_parse", "invoice", invoice.id,
                    after={"vendor_name": vendor_name, "items": len(line_items),
                           "confidence": invoice.confidence_score,
                           "llm_confidence": invoice.llm_confidence,
                           "heuristic_confidence": invoice.heuristic_confidence,
                           "provider": invoice.ocr_provider, "model": invoice.ocr_model},
                    request=request)

    invalid_rows = sum(1 for li in line_items if not li.get("row_valid", True))
    auto_matched = sum(1 for li in line_items if li.get("auto_matched_alias"))
    return {
        "invoice": invoice.model_dump(),
        "duplicate_invoice_number": duplicate,
        "invalid_rows": invalid_rows,
        "auto_matched_alias_count": auto_matched,
        "confidence_score": invoice.confidence_score,
        "llm_confidence": invoice.llm_confidence,
        "heuristic_confidence": invoice.heuristic_confidence,
        "ocr_provider": invoice.ocr_provider,
        "ocr_model": invoice.ocr_model,
        "error": parsed.get("_error"),
    }


@api.get("/invoices")
async def list_invoices(user: dict = Depends(get_current_user)):
    docs = await db.invoices.find({}, {"_id": 0, "raw_ocr_text": 0}).sort("created_at", -1).to_list(200)
    return docs


@api.get("/invoices/{iid}")
async def get_invoice(iid: str, user: dict = Depends(get_current_user)):
    doc = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    return doc


class CommitInvoiceRequest(BaseModel):
    invoice_number: str
    vendor_id: Optional[str] = None
    vendor_name: str = ""
    invoice_date: str = ""
    total_amount: float = 0.0
    cgst: float = 0.0
    sgst: float = 0.0
    igst: float = 0.0
    line_items: List[InvoiceLineItem]


@api.post("/invoices/{iid}/commit")
async def commit_invoice(iid: str, body: CommitInvoiceRequest, request: Request,
                          user: dict = Depends(require_roles("super_admin", "hub_accountant", "warehouse_manager"))):
    """Commit a reconciled invoice: update product prices, add to hub stock."""
    inv = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv.get("status") == "committed":
        raise HTTPException(409, "Already committed")

    update = body.model_dump()
    update["status"] = "committed"
    await db.invoices.update_one({"id": iid}, {"$set": update})

    # Apply stock + price updates for matched items
    for li in body.line_items:
        if li.product_id and li.quantity > 0:
            await adjust_stock(li.product_id, "hub", "hub-main", int(li.quantity),
                                reason=f"invoice:{body.invoice_number}",
                                user_id=user["id"], user_email=user["email"],
                                reference_type="invoice", reference_id=iid)
            # Learn vendor alias (V2.1) — only if alias differs from our SKU
            alias = (getattr(li, "item_alias", "") or "").strip().upper()
            if alias:
                existing_alias = await db.ocr_aliases.find_one(
                    {"vendor_id": body.vendor_id, "vendor_alias": alias, "product_id": li.product_id},
                    {"_id": 0},
                )
                if existing_alias:
                    await db.ocr_aliases.update_one(
                        {"id": existing_alias["id"]},
                        {"$inc": {"hits": 1}, "$set": {"last_used_at": now_iso()}},
                    )
                else:
                    from models import OcrAlias
                    rec = OcrAlias(
                        vendor_id=body.vendor_id, vendor_alias=alias,
                        product_id=li.product_id, sku=li.sku or "",
                    )
                    await db.ocr_aliases.insert_one(rec.model_dump())
            # Update landing price + recalc franchise/retail
            await db.products.update_one(
                {"id": li.product_id},
                {"$set": {
                    "landing_price": li.unit_price,
                    "gst_rate": li.gst_percent,
                    "primary_vendor_id": body.vendor_id,
                }},
            )
            # recalc franchise / retail by current margin
            prod = await db.products.find_one({"id": li.product_id}, {"_id": 0})
            if prod:
                m = prod.get("margin_percent", 20) or 20
                await db.products.update_one({"id": li.product_id}, {"$set": {
                    "franchise_price": round(li.unit_price * (1 + m / 100), 2),
                    "retail_price": round(li.unit_price * (1 + (m + 8) / 100), 2),
                }})

    # Update vendor outstanding balance
    if body.vendor_id:
        await db.vendors.update_one(
            {"id": body.vendor_id},
            {"$inc": {"outstanding_balance": body.total_amount}},
        )

    await log_audit(user, "invoice.commit", "invoice", iid, after={"total": body.total_amount}, request=request)
    return {"ok": True}


# ============ PURCHASE ORDERS ============
@api.get("/purchase-orders")
async def list_pos(user: dict = Depends(get_current_user)):
    docs = await db.purchase_orders.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@api.post("/purchase-orders/auto-generate")
async def auto_generate_pos(request: Request,
                             user: dict = Depends(require_roles("super_admin", "warehouse_manager", "hub_accountant"))):
    """Scan low-stock products and generate draft POs grouped by primary vendor."""
    products = await db.products.find({}, {"_id": 0}).to_list(5000)
    by_vendor: dict = {}
    for p in products:
        hub_qty = await get_hub_stock(p["id"])
        if hub_qty < p.get("safety_stock", 0):
            vid = p.get("primary_vendor_id")
            if not vid:
                continue
            qty_needed = max(p.get("reorder_qty", 50), p.get("safety_stock", 10) * 2 - hub_qty)
            by_vendor.setdefault(vid, []).append({
                "product_id": p["id"],
                "product_name": p["name"],
                "sku": p["sku"],
                "quantity": int(qty_needed),
                "unit_price": p.get("landing_price", 0) or 0,
                "line_total": round((p.get("landing_price", 0) or 0) * qty_needed, 2),
            })

    pos_created = []
    for vid, items in by_vendor.items():
        v = await db.vendors.find_one({"id": vid}, {"_id": 0})
        po_num = await gen_sequence("po", "PO")
        po = PurchaseOrder(
            po_number=po_num,
            vendor_id=vid,
            vendor_name=v["name"] if v else "",
            line_items=[POLineItem(**i) for i in items],
            total_amount=round(sum(i["line_total"] for i in items), 2),
            auto_generated=True,
            created_by=user["id"],
        )
        await db.purchase_orders.insert_one(po.model_dump())
        pos_created.append(po.model_dump())

    await log_audit(user, "po.auto_generate", "purchase_order", "bulk",
                    after={"count": len(pos_created)}, request=request)
    return {"created": len(pos_created), "purchase_orders": pos_created}


@api.put("/purchase-orders/{poid}/status")
async def update_po_status(poid: str, status: str = Form(...), request: Request = None,
                            user: dict = Depends(require_roles("super_admin", "warehouse_manager", "hub_accountant"))):
    if status not in {"draft", "sent", "received", "cancelled"}:
        raise HTTPException(400, "Invalid status")
    res = await db.purchase_orders.update_one({"id": poid}, {"$set": {"status": status}})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    await log_audit(user, "po.status", "purchase_order", poid, after={"status": status}, request=request)
    # V2.2 — auto-reopen pending indents when stock arrives
    reopened = {"reopened": 0}
    if status == "received":
        po = await db.purchase_orders.find_one({"id": poid}, {"_id": 0})
        try:
            reopened = await routers_v22.reopen_awaiting_stock_indents(po)
        except Exception as e:
            logger.exception(f"reopen_awaiting_stock_indents failed: {e}")
    return {"ok": True, **reopened}


# ============ INDENTS (Franchise Orders) ============
class IndentCreate(BaseModel):
    franchise_id: str
    priority: str = "routine"
    notes: str = ""
    line_items: List[dict]  # [{product_id, requested_qty}]


@api.post("/indents", response_model=Indent)
async def create_indent(body: IndentCreate, request: Request, user: dict = Depends(get_current_user)):
    # franchise_manager can only create for their own franchise
    if user["role"] == "franchise_manager":
        if user.get("franchise_id") != body.franchise_id:
            raise HTTPException(403, "Cannot create indent for other franchise")

    franchise = await db.franchises.find_one({"id": body.franchise_id}, {"_id": 0})
    if not franchise:
        raise HTTPException(404, "Franchise not found")

    tier = await get_franchise_tier(body.franchise_id)

    items: List[IndentLineItem] = []
    total = 0.0
    for li in body.line_items:
        p = await db.products.find_one({"id": li["product_id"]}, {"_id": 0})
        if not p:
            continue
        qty = int(li["requested_qty"])
        if tier:
            price = compute_tier_price(p.get("landing_price", 0) or 0, tier,
                                       p.get("category", ""), p.get("margin_percent", 22))
        else:
            price = p.get("franchise_price", 0) or 0
        items.append(IndentLineItem(
            product_id=p["id"],
            product_name=p["name"],
            sku=p["sku"],
            requested_qty=qty,
            unit_price=price,
            line_total=round(price * qty, 2),
        ))
        total += price * qty

    num = await gen_sequence("indent", "IND")
    indent = Indent(
        indent_number=num,
        franchise_id=body.franchise_id,
        franchise_name=franchise["name"],
        priority=body.priority,
        line_items=items,
        total_amount=round(total, 2),
        notes=body.notes,
        created_by=user["id"],
    )
    await db.indents.insert_one(indent.model_dump())
    await log_audit(user, "indent.create", "indent", indent.id,
                    after={"franchise": franchise["name"], "items": len(items)}, request=request)
    return indent


@api.get("/indents")
async def list_indents(franchise_id: Optional[str] = None, status: Optional[str] = None,
                        user: dict = Depends(get_current_user)):
    query: dict = {}
    if user["role"] == "franchise_manager":
        query["franchise_id"] = user.get("franchise_id")
    elif franchise_id:
        query["franchise_id"] = franchise_id
    if status:
        query["status"] = status
    docs = await db.indents.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@api.get("/indents/{iid}")
async def get_indent(iid: str, user: dict = Depends(get_current_user)):
    doc = await db.indents.find_one({"id": iid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    if user["role"] == "franchise_manager" and doc["franchise_id"] != user.get("franchise_id"):
        raise HTTPException(403, "Forbidden")
    return doc


class FulfillItem(BaseModel):
    product_id: str
    fulfill_qty: int


class FulfillRequest(BaseModel):
    items: List[FulfillItem]


@api.post("/indents/{iid}/fulfill")
async def fulfill_indent(iid: str, body: FulfillRequest, request: Request,
                          user: dict = Depends(require_roles("super_admin", "warehouse_manager"))):
    """Warehouse manager allocates fulfill qty per line. Supports partial fulfillment.
    Stock is deducted immediately, before/after recorded in stock_movements."""
    indent = await db.indents.find_one({"id": iid}, {"_id": 0})
    if not indent:
        raise HTTPException(404, "Not found")
    if indent["status"] not in {"pending", "awaiting_stock", "partially_fulfilled"}:
        raise HTTPException(409, f"Cannot fulfill from status: {indent['status']}")

    fulfill_map = {f.product_id: int(f.fulfill_qty) for f in body.items}

    # Validate sums of fulfill_qty doesn't exceed hub stock for each product
    for li in indent["line_items"]:
        requested = int(li["requested_qty"])
        already_allocated = int(li.get("allocated_qty", 0))
        wanted = int(fulfill_map.get(li["product_id"], 0))
        if wanted < 0:
            raise HTTPException(400, "fulfill_qty cannot be negative")
        # Cap: cannot exceed remaining pending qty
        remaining_pending = requested - already_allocated
        if wanted > remaining_pending:
            raise HTTPException(400, f"Fulfill qty exceeds pending for {li['sku']}")
        hub_qty = await get_hub_stock(li["product_id"])
        if wanted > hub_qty:
            raise HTTPException(400, f"Fulfill qty exceeds available stock for {li['sku']}")

    # Apply allocations
    new_items = []
    total_requested = 0
    total_allocated = 0
    any_new_alloc = 0
    for li in indent["line_items"]:
        requested = int(li["requested_qty"])
        already = int(li.get("allocated_qty", 0))
        add = int(fulfill_map.get(li["product_id"], 0))
        new_alloc = already + add
        backorder = max(0, requested - new_alloc)
        new_items.append({**li, "allocated_qty": new_alloc, "backorder_qty": backorder})
        total_requested += requested
        total_allocated += new_alloc
        any_new_alloc += add
        if add > 0:
            await adjust_stock(
                li["product_id"], "hub", "hub-main", -add,
                reason=f"indent:{indent['indent_number']}",
                user_id=user["id"], user_email=user["email"],
                reference_type="indent", reference_id=iid,
            )

    if any_new_alloc == 0:
        raise HTTPException(400, "Enter at least one fulfill quantity")

    ratio = round((total_allocated / total_requested * 100) if total_requested else 0, 1)
    if total_allocated >= total_requested:
        new_status = "fulfilled"
    elif total_allocated > 0:
        new_status = "partially_fulfilled"
    else:
        new_status = "awaiting_stock"

    update = {
        "status": new_status,
        "line_items": new_items,
        "fulfillment_ratio": ratio,
        "fulfilled_at": now_iso(),
        "fulfilled_by": user["id"],
    }
    if not indent.get("approved_at"):
        update["approved_at"] = now_iso()
    await db.indents.update_one({"id": iid}, {"$set": update})
    await log_audit(user, "indent.fulfill", "indent", iid,
                    after={"ratio": ratio, "status": new_status, "added": any_new_alloc},
                    request=request)
    return {"ok": True, "fulfillment_ratio": ratio, "status": new_status}


@api.post("/indents/{iid}/reject")
async def reject_indent(iid: str, request: Request,
                         reason: str = Form(""),
                         user: dict = Depends(require_roles("super_admin", "warehouse_manager"))):
    indent = await db.indents.find_one({"id": iid}, {"_id": 0})
    if not indent:
        raise HTTPException(404, "Not found")
    if indent["status"] not in {"pending", "awaiting_stock"}:
        raise HTTPException(409, f"Cannot reject from status: {indent['status']}")
    await db.indents.update_one({"id": iid}, {"$set": {
        "status": "rejected", "rejection_reason": reason, "rejected_at": now_iso(),
    }})
    # Notify franchise manager
    await db.notifications.insert_one(Notification(
        user_id=indent.get("created_by"),
        title=f"Indent {indent['indent_number']} rejected",
        body=reason or "Your indent was declined by warehouse.",
        level="danger",
        link="/indents",
    ).model_dump())
    await log_audit(user, "indent.reject", "indent", iid, after={"reason": reason}, request=request)
    return {"ok": True}


@api.get("/indents/pending-stock/summary")
async def pending_stock_summary(user: dict = Depends(require_roles("super_admin", "warehouse_manager"))):
    """For each pending/awaiting_stock/partially_fulfilled indent, show which products are backordered and current hub availability."""
    indents = await db.indents.find(
        {"status": {"$in": ["pending", "awaiting_stock", "partially_fulfilled"]}},
        {"_id": 0},
    ).to_list(500)
    rows = []
    for ind in indents:
        for li in ind["line_items"]:
            requested = int(li.get("requested_qty", 0))
            allocated = int(li.get("allocated_qty", 0))
            pending = requested - allocated
            if pending <= 0:
                continue
            hub_qty = await get_hub_stock(li["product_id"])
            rows.append({
                "indent_id": ind["id"],
                "indent_number": ind["indent_number"],
                "franchise_name": ind["franchise_name"],
                "product_id": li["product_id"],
                "sku": li["sku"],
                "product_name": li["product_name"],
                "pending_qty": pending,
                "hub_available": hub_qty,
                "can_now_fulfill": min(pending, hub_qty),
                "status": ind["status"],
                "priority": ind.get("priority", "routine"),
            })
    return rows


@api.post("/indents/{iid}/dispatch")
async def dispatch_indent(
    iid: str, request: Request,
    transporter_name: str = Form(""),
    vehicle_number: str = Form(""),
    lr_number: str = Form(""),
    eway_bill_number: str = Form(""),
    user: dict = Depends(require_roles("super_admin", "warehouse_manager")),
):
    indent = await db.indents.find_one({"id": iid}, {"_id": 0})
    if not indent:
        raise HTTPException(404, "Not found")
    if indent["status"] not in {"fulfilled", "partially_fulfilled"}:
        raise HTTPException(409, "Indent not fulfilled (allocate stock first)")

    # Generate DC
    dc_num = await gen_sequence("dc", "DC")
    allocated_items = [li for li in indent["line_items"] if li.get("allocated_qty", 0) > 0]
    subtotal = sum((li["unit_price"] * li["allocated_qty"]) for li in allocated_items)
    cgst = round(subtotal * 0.09, 2)
    sgst = round(subtotal * 0.09, 2)
    grand = round(subtotal + cgst + sgst, 2)

    dc = DeliveryChallan(
        dc_number=dc_num,
        indent_id=iid,
        franchise_id=indent["franchise_id"],
        franchise_name=indent["franchise_name"],
        transporter_name=transporter_name,
        vehicle_number=vehicle_number,
        lr_number=lr_number,
        eway_bill_number=eway_bill_number,
        line_items=[IndentLineItem(**li) for li in allocated_items],
        total_amount=round(subtotal, 2),
        cgst=cgst,
        sgst=sgst,
        grand_total=grand,
        status="dispatched",
        verification_qr=f"DC-VERIFY-{dc_num}",
    )
    await db.delivery_challans.insert_one(dc.model_dump())
    await db.indents.update_one({"id": iid}, {"$set": {
        "status": "dispatched", "dispatched_at": now_iso()
    }})
    await log_audit(user, "indent.dispatch", "indent", iid, after={"dc_number": dc_num}, request=request)
    return {"ok": True, "dc": dc.model_dump()}


@api.post("/indents/{iid}/deliver")
async def deliver_indent(iid: str, request: Request,
                          user: dict = Depends(require_roles("super_admin", "warehouse_manager", "franchise_manager"))):
    indent = await db.indents.find_one({"id": iid}, {"_id": 0})
    if not indent:
        raise HTTPException(404, "Not found")
    if indent["status"] != "dispatched":
        raise HTTPException(409, "Not dispatched")
    # franchise_manager can only confirm their own franchise's indent
    if user["role"] == "franchise_manager" and indent["franchise_id"] != user.get("franchise_id"):
        raise HTTPException(403, "Cannot deliver indent of another franchise")

    # Add allocated stock to franchise location
    for li in indent["line_items"]:
        if li.get("allocated_qty", 0) > 0:
            await adjust_stock(li["product_id"], "franchise", indent["franchise_id"],
                                int(li["allocated_qty"]),
                                reason=f"indent:{indent['indent_number']}",
                                user_id=user["id"], user_email=user["email"],
                                reference_type="indent", reference_id=iid)

    await db.indents.update_one({"id": iid}, {"$set": {
        "status": "delivered", "delivered_at": now_iso()
    }})
    # Update DC -> verified + invoice
    dc = await db.delivery_challans.find_one({"indent_id": iid}, {"_id": 0})
    if dc:
        inv_num = await gen_sequence("inv", "INV")
        await db.delivery_challans.update_one(
            {"id": dc["id"]},
            {"$set": {"status": "invoiced", "invoice_number": inv_num, "verified_at": now_iso()}},
        )
        # V2.2 P1 — auto-create draft Tax Invoice on DC delivery (gated by org setting)
        try:
            org = await db.org_settings.find_one({"id": "org-settings"}, {"_id": 0}) or {}
            if org.get("auto_create_tax_invoice_on_delivery", True):
                import routers_tax_invoice as _rti
                await _rti.auto_create_tax_invoice_for_dc(dc["id"], user)
        except Exception as _e:
            logger.warning("auto_create_tax_invoice_for_dc failed: %s", _e)
    await log_audit(user, "indent.deliver", "indent", iid, request=request)
    return {"ok": True}


# ============ DELIVERY CHALLANS / INVOICES ============
@api.get("/delivery-challans")
async def list_dcs(user: dict = Depends(get_current_user)):
    query: dict = {}
    if user["role"] == "franchise_manager":
        query["franchise_id"] = user.get("franchise_id")
    docs = await db.delivery_challans.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@api.get("/delivery-challans/{dcid}")
async def get_dc(dcid: str, user: dict = Depends(get_current_user)):
    doc = await db.delivery_challans.find_one({"id": dcid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    return doc


# ============ AGING ============
@api.get("/reports/aging")
async def aging_report(user: dict = Depends(get_current_user)):
    """Categorize hub stock by last_in_date age."""
    now = datetime.now(timezone.utc)
    buckets = {"0-30": 0, "31-90": 0, "91-180": 0, "181-365": 0, "365+": 0}
    value_buckets = {k: 0.0 for k in buckets}
    items: list = []
    stocks = await db.stock.find({"location_type": "hub"}, {"_id": 0}).to_list(5000)
    for s in stocks:
        if s["quantity"] <= 0:
            continue
        prod = await db.products.find_one({"id": s["product_id"]}, {"_id": 0})
        if not prod:
            continue
        last_in = s.get("last_in_date") or s.get("updated_at")
        try:
            dt = datetime.fromisoformat(last_in.replace("Z", "+00:00")) if last_in else now
        except Exception:
            dt = now
        age = (now - dt).days
        if age <= 30:
            bk = "0-30"
        elif age <= 90:
            bk = "31-90"
        elif age <= 180:
            bk = "91-180"
        elif age <= 365:
            bk = "181-365"
        else:
            bk = "365+"
        buckets[bk] += s["quantity"]
        val = s["quantity"] * (prod.get("landing_price", 0) or 0)
        value_buckets[bk] += val
        items.append({
            "product_id": prod["id"], "sku": prod["sku"], "name": prod["name"],
            "qty": s["quantity"], "age_days": age, "bucket": bk, "value": round(val, 2),
        })
    return {
        "buckets": buckets,
        "value_buckets": {k: round(v, 2) for k, v in value_buckets.items()},
        "items": items,
    }


# ============ CYCLE COUNT ============
@api.post("/cycle-counts/generate")
async def generate_cycle_count(request: Request, type: str = Form("weekly"),
                                count: int = Form(10),
                                user: dict = Depends(require_roles("super_admin", "warehouse_manager"))):
    """Randomly select SKUs from hub for blind cycle count."""
    import random
    products = await db.products.find({"active": True}, {"_id": 0}).to_list(5000)
    sample = random.sample(products, min(count, len(products)))
    items = []
    for p in sample:
        qty = await get_hub_stock(p["id"])
        items.append(CycleCountItem(
            product_id=p["id"], product_name=p["name"], sku=p["sku"], system_qty=qty,
        ))
    cc_num = await gen_sequence("cc", "CC")
    cc = CycleCount(
        cc_number=cc_num, type=type, items=items, created_by=user["id"],
    )
    await db.cycle_counts.insert_one(cc.model_dump())
    await log_audit(user, "cyclecount.generate", "cycle_count", cc.id,
                    after={"count": len(items), "type": type}, request=request)
    return cc.model_dump()


@api.get("/cycle-counts")
async def list_cycle_counts(user: dict = Depends(get_current_user)):
    docs = await db.cycle_counts.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return docs


@api.get("/cycle-counts/{ccid}")
async def get_cycle_count(ccid: str, user: dict = Depends(get_current_user)):
    doc = await db.cycle_counts.find_one({"id": ccid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    return doc


class CycleCountSubmit(BaseModel):
    items: List[dict]  # [{product_id, counted_qty}]


@api.post("/cycle-counts/{ccid}/submit")
async def submit_cycle_count(ccid: str, body: CycleCountSubmit, request: Request,
                              user: dict = Depends(require_roles("super_admin", "warehouse_manager"))):
    cc = await db.cycle_counts.find_one({"id": ccid}, {"_id": 0})
    if not cc:
        raise HTTPException(404, "Not found")
    updated_items = []
    counted_map = {i["product_id"]: int(i["counted_qty"]) for i in body.items}
    for item in cc["items"]:
        cq = counted_map.get(item["product_id"])
        if cq is not None:
            item["counted_qty"] = cq
            item["variance"] = cq - item["system_qty"]
            # Adjust stock to match counted qty
            if item["variance"] != 0:
                await adjust_stock(item["product_id"], "hub", "hub-main", item["variance"],
                                    reason=f"cycle_count:{cc['cc_number']}",
                                    user_id=user["id"], user_email=user["email"],
                                    reference_type="cycle_count", reference_id=ccid)
        updated_items.append(item)
    await db.cycle_counts.update_one({"id": ccid}, {"$set": {
        "items": updated_items, "status": "completed", "completed_at": now_iso(),
    }})
    await log_audit(user, "cyclecount.submit", "cycle_count", ccid, request=request)
    return {"ok": True}


# ============ AUDIT LOGS ============
@api.get("/audit-logs")
async def list_audit_logs(limit: int = 100, user: dict = Depends(require_roles("super_admin", "hub_accountant"))):
    docs = await db.audit_logs.find({}, {"_id": 0}).sort("timestamp", -1).limit(limit).to_list(limit)
    return docs


# ============ DASHBOARD ============
@api.get("/dashboard/stats")
async def dashboard_stats(user: dict = Depends(get_current_user)):
    is_franchise = user["role"] == "franchise_manager"
    now = datetime.now(timezone.utc)

    # ---- Franchise-scoped, sensitive-data-stripped view ----
    if is_franchise:
        fid = user.get("franchise_id")
        indents = await db.indents.find({"franchise_id": fid}, {"_id": 0}).to_list(2000)
        my_pending = sum(1 for i in indents if i["status"] in {"pending", "awaiting_stock", "partially_fulfilled"})
        my_fulfilled = sum(1 for i in indents if i["status"] == "fulfilled")
        my_dispatched = sum(1 for i in indents if i["status"] == "dispatched")
        my_delivered = sum(1 for i in indents if i["status"] == "delivered")
        # 7-day own trend
        trend = []
        for i in range(6, -1, -1):
            day = (now - timedelta(days=i)).date().isoformat()
            cnt = sum(1 for ind in indents if (ind.get("created_at", "")[:10] == day))
            trend.append({"date": day, "count": cnt})
        return {
            "is_franchise": True,
            "my_pending": my_pending,
            "my_fulfilled": my_fulfilled,
            "my_dispatched": my_dispatched,
            "my_delivered": my_delivered,
            "total_indents": len(indents),
            "trend_7d": trend,
        }

    # ---- Admin / Warehouse / Accountant full view ----
    products_count = await db.products.count_documents({})
    vendors_count = await db.vendors.count_documents({})
    franchises_count = await db.franchises.count_documents({})

    # Hub stock value
    pipeline = [
        {"$match": {"location_type": "hub"}},
        {"$lookup": {"from": "products", "localField": "product_id", "foreignField": "id", "as": "p"}},
        {"$unwind": "$p"},
        {"$project": {"value": {"$multiply": ["$quantity", {"$ifNull": ["$p.landing_price", 0]}]},
                      "quantity": 1, "p.safety_stock": 1}},
        {"$group": {"_id": None, "total_value": {"$sum": "$value"}, "total_qty": {"$sum": "$quantity"}}},
    ]
    val = await db.stock.aggregate(pipeline).to_list(1)
    total_value = round(val[0]["total_value"], 2) if val else 0
    total_qty = val[0]["total_qty"] if val else 0

    products = await db.products.find({}, {"_id": 0}).to_list(5000)
    low_stock = 0
    dead_stock = 0
    for p in products:
        s = await db.stock.find_one({"product_id": p["id"], "location_type": "hub"}, {"_id": 0})
        if not s:
            if p.get("safety_stock", 0) > 0:
                low_stock += 1
            continue
        if s["quantity"] < p.get("safety_stock", 0):
            low_stock += 1
        last_in = s.get("last_in_date") or s.get("updated_at")
        try:
            dt = datetime.fromisoformat((last_in or "").replace("Z", "+00:00"))
            if (now - dt).days > 365 and s["quantity"] > 0:
                dead_stock += 1
        except Exception:
            pass

    vendors = await db.vendors.find({}, {"_id": 0}).to_list(500)
    outstanding = round(sum(v.get("outstanding_balance", 0) for v in vendors), 2)

    indents = await db.indents.find({}, {"_id": 0}).to_list(2000)
    PENDING_STATUSES = {"pending", "awaiting_stock", "partially_fulfilled", "fulfilled", "dispatched"}
    pending_indents = sum(1 for i in indents if i["status"] in PENDING_STATUSES)
    delivered_indents = sum(1 for i in indents if i["status"] == "delivered")
    completed_set = {"partially_fulfilled", "fulfilled", "dispatched", "delivered"}
    completed_count = sum(1 for i in indents if i["status"] in completed_set)
    avg_fulfillment = (
        round(sum(i.get("fulfillment_ratio", 0) for i in indents if i["status"] in completed_set)
              / max(1, completed_count), 1)
    )

    top_pipeline = [
        {"$match": {"status": {"$in": ["dispatched", "delivered"]}}},
        {"$unwind": "$line_items"},
        {"$group": {"_id": "$line_items.product_id", "name": {"$first": "$line_items.product_name"},
                    "qty": {"$sum": "$line_items.allocated_qty"}}},
        {"$sort": {"qty": -1}},
        {"$limit": 5},
    ]
    top_products = await db.indents.aggregate(top_pipeline).to_list(5)

    trend = []
    for i in range(6, -1, -1):
        day = (now - timedelta(days=i)).date().isoformat()
        cnt = sum(1 for ind in indents if (ind.get("created_at", "")[:10] == day))
        trend.append({"date": day, "count": cnt})

    # Pending fulfillment queue summary
    queue_count = sum(1 for i in indents if i["status"] in {"pending", "awaiting_stock"})

    return {
        "is_franchise": False,
        "products_count": products_count,
        "vendors_count": vendors_count,
        "franchises_count": franchises_count,
        "total_stock_value": total_value,
        "total_stock_qty": total_qty,
        "low_stock_count": low_stock,
        "dead_stock_count": dead_stock,
        "outstanding_payments": outstanding,
        "pending_indents": pending_indents,
        "delivered_indents": delivered_indents,
        "avg_fulfillment_ratio": avg_fulfillment,
        "pending_fulfillment_queue": queue_count,
        "top_products": top_products,
        "trend_7d": trend,
    }


# ============ STOCK MOVEMENTS (audit trail) ============
@api.get("/stock-movements")
async def list_stock_movements(
    product_id: Optional[str] = None,
    reference_type: Optional[str] = None,
    reference_id: Optional[str] = None,
    limit: int = 200,
    user: dict = Depends(require_roles("super_admin", "warehouse_manager", "hub_accountant")),
):
    """Immutable audit trail of every stock change (hub or franchise).
    Visible to admin / warehouse / accountant — NOT to franchise managers."""
    query: dict = {}
    if product_id:
        query["product_id"] = product_id
    if reference_type:
        query["reference_type"] = reference_type
    if reference_id:
        query["reference_id"] = reference_id
    docs = await db.stock_movements.find(query, {"_id": 0}).sort("timestamp", -1).limit(limit).to_list(limit)
    return docs


# ============ NOTIFICATIONS ============
@api.get("/notifications")
async def list_notifications(user: dict = Depends(get_current_user)):
    docs = await db.notifications.find({
        "$or": [{"user_id": user["id"]}, {"role": user["role"]}, {"user_id": None, "role": None}],
    }, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50)
    return docs


# Mount router
app.include_router(api)

# V2.1 — additive routes (OCR aliases, franchise tiers, multi-source orders, bulk import, editable PO, date filters)
routers_v21.init(
    db=db,
    log_audit_fn=log_audit,
    gen_sequence_fn=gen_sequence,
    save_uploaded_file_fn=save_uploaded_file,
    adjust_stock_fn=adjust_stock,
    ocr_service_mod=_ocr_service_mod,
    upload_dir=UPLOAD_DIR,
)
app.include_router(routers_v21.router, prefix="/api")

# V2.2 — additive routes (Invoice PDF, DC PDF redesign, WhatsApp share, Reports, Auto-reopen)
routers_v22.init(
    db=db,
    log_audit_fn=log_audit,
    adjust_stock_fn=adjust_stock,
)
app.include_router(routers_v22.router, prefix="/api")

# V2.2 P1 — Sales Tax Invoice Module (additive)
import routers_tax_invoice  # noqa: E402
routers_tax_invoice.init(db=db, log_audit_fn=log_audit)
app.include_router(routers_tax_invoice.router, prefix="/api")

# Serve uploaded files
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_start():
    logger.info("Starting Servall Nexus ERP backend")
    await seed_demo_data(db)


@app.on_event("shutdown")
async def shutdown_db():
    client.close()
