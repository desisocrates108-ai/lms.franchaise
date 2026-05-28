"""Pydantic models for Servall Nexus ERP."""
from datetime import datetime, timezone
from typing import Optional, List, Literal
from pydantic import BaseModel, Field, EmailStr, ConfigDict
import uuid


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def gen_id() -> str:
    return str(uuid.uuid4())


# ============ USERS ============
Role = Literal["super_admin", "hub_accountant", "warehouse_manager", "franchise_manager"]


class UserBase(BaseModel):
    model_config = ConfigDict(extra="ignore")
    email: EmailStr
    full_name: str
    role: Role
    franchise_id: Optional[str] = None  # required if role==franchise_manager
    active: bool = True


class UserCreate(UserBase):
    password: str


class User(UserBase):
    id: str = Field(default_factory=gen_id)
    created_at: str = Field(default_factory=now_iso)


class UserPublic(UserBase):
    id: str
    created_at: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    token: str
    user: UserPublic


# ============ FRANCHISES ============
class Franchise(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=gen_id)
    code: str  # e.g. FR-DEL-001
    name: str
    city: str
    state: str
    address: str = ""
    gstin: str = ""
    contact_phone: str = ""
    contact_email: str = ""
    credit_limit: float = 0.0
    active: bool = True
    created_at: str = Field(default_factory=now_iso)


# ============ VENDORS ============
class Vendor(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=gen_id)
    code: str
    name: str
    gstin: str = ""
    address: str = ""
    contact_phone: str = ""
    contact_email: str = ""
    credit_period_days: int = 30
    outstanding_balance: float = 0.0
    credit_limit: float = 0.0
    rating: float = 4.5  # 0..5
    fulfillment_score: float = 95.0  # 0..100 %
    created_at: str = Field(default_factory=now_iso)


# ============ PRODUCTS / SKU ============
class Product(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=gen_id)
    sku: str
    name: str
    brand: str = ""
    category: str = ""
    subcategory: str = ""
    part_number_oem: str = ""
    part_number_aftermarket: str = ""
    hsn_code: str = ""
    barcode: str = ""
    qr_code: str = ""
    unit: str = "pcs"  # pcs / box / set / ltr
    pack_size: int = 1
    rack_location: str = ""  # e.g. "Rack A - Shelf 3 - Bin 12"
    # pricing
    landing_price: float = 0.0  # purchase + tax + freight
    mrp: float = 0.0
    franchise_price: float = 0.0
    retail_price: float = 0.0
    gst_rate: float = 18.0
    margin_percent: float = 20.0
    # stock thresholds
    safety_stock: int = 10
    reorder_qty: int = 50
    # batch
    has_expiry: bool = False
    image_url: str = ""
    primary_vendor_id: Optional[str] = None
    active: bool = True
    created_at: str = Field(default_factory=now_iso)


# ============ STOCK (per location) ============
LocationType = Literal["hub", "franchise"]


class StockItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=gen_id)
    product_id: str
    location_type: LocationType
    location_id: str  # hub_id or franchise_id
    quantity: int = 0
    batch_no: str = ""
    expiry_date: Optional[str] = None
    last_in_date: Optional[str] = None  # iso
    last_out_date: Optional[str] = None
    updated_at: str = Field(default_factory=now_iso)


# ============ INVOICES (purchase) ============
class InvoiceLineItem(BaseModel):
    product_id: Optional[str] = None  # null if unmatched
    product_name: str
    sku: str = ""
    hsn_code: str = ""
    quantity: float
    unit_price: float
    gst_percent: float = 18.0
    line_total: float
    matched: bool = True
    anomaly: Optional[str] = None  # e.g., "price_increased_15%"


class PurchaseInvoice(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=gen_id)
    invoice_number: str
    vendor_id: Optional[str] = None
    vendor_name: str = ""
    invoice_date: str = ""
    total_amount: float = 0.0
    cgst: float = 0.0
    sgst: float = 0.0
    igst: float = 0.0
    line_items: List[InvoiceLineItem] = []
    file_url: str = ""  # path stored
    status: Literal["draft", "reconciled", "committed"] = "draft"
    raw_ocr_text: str = ""
    created_by: str = ""
    created_at: str = Field(default_factory=now_iso)


# ============ PURCHASE ORDERS ============
class POLineItem(BaseModel):
    product_id: str
    product_name: str
    sku: str
    quantity: int
    unit_price: float
    line_total: float


class PurchaseOrder(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=gen_id)
    po_number: str
    vendor_id: str
    vendor_name: str = ""
    line_items: List[POLineItem] = []
    total_amount: float = 0.0
    status: Literal["draft", "sent", "received", "cancelled"] = "draft"
    auto_generated: bool = False
    notes: str = ""
    created_by: str = ""
    created_at: str = Field(default_factory=now_iso)


# ============ INDENTS (franchise orders) ============
IndentStatus = Literal["requested", "approved", "dispatched", "delivered", "cancelled"]


class IndentLineItem(BaseModel):
    product_id: str
    product_name: str
    sku: str
    requested_qty: int
    allocated_qty: int = 0
    backorder_qty: int = 0
    unit_price: float = 0.0
    line_total: float = 0.0


class Indent(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=gen_id)
    indent_number: str
    franchise_id: str
    franchise_name: str = ""
    priority: Literal["urgent", "routine"] = "routine"
    status: IndentStatus = "requested"
    line_items: List[IndentLineItem] = []
    total_amount: float = 0.0
    fulfillment_ratio: float = 0.0  # 0..100
    notes: str = ""
    created_by: str = ""
    created_at: str = Field(default_factory=now_iso)
    approved_at: Optional[str] = None
    dispatched_at: Optional[str] = None
    delivered_at: Optional[str] = None


# ============ DELIVERY CHALLANS / INVOICES ============
class DeliveryChallan(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=gen_id)
    dc_number: str
    indent_id: str
    franchise_id: str
    franchise_name: str = ""
    transporter_name: str = ""
    vehicle_number: str = ""
    lr_number: str = ""
    eway_bill_number: str = ""
    line_items: List[IndentLineItem] = []
    total_amount: float = 0.0
    cgst: float = 0.0
    sgst: float = 0.0
    igst: float = 0.0
    grand_total: float = 0.0
    status: Literal["draft", "dispatched", "verified", "invoiced"] = "draft"
    invoice_number: Optional[str] = None
    verification_qr: str = ""
    created_at: str = Field(default_factory=now_iso)
    verified_at: Optional[str] = None


# ============ CYCLE COUNT ============
class CycleCountItem(BaseModel):
    product_id: str
    product_name: str
    sku: str
    system_qty: int
    counted_qty: Optional[int] = None
    variance: Optional[int] = None


class CycleCount(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=gen_id)
    cc_number: str
    type: Literal["weekly", "monthly", "yearly"] = "weekly"
    location_type: LocationType = "hub"
    location_id: str = "hub-main"
    items: List[CycleCountItem] = []
    status: Literal["open", "completed"] = "open"
    notes: str = ""
    created_by: str = ""
    created_at: str = Field(default_factory=now_iso)
    completed_at: Optional[str] = None


# ============ AUDIT LOGS ============
class AuditLog(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=gen_id)
    timestamp: str = Field(default_factory=now_iso)
    user_id: str
    user_email: str = ""
    action: str  # e.g., "product.update"
    entity_type: str = ""
    entity_id: str = ""
    before: Optional[dict] = None
    after: Optional[dict] = None
    ip_address: str = ""


# ============ NOTIFICATIONS ============
class Notification(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=gen_id)
    user_id: Optional[str] = None  # null = broadcast to role
    role: Optional[Role] = None
    title: str
    body: str = ""
    level: Literal["info", "warning", "danger", "success"] = "info"
    link: str = ""
    read: bool = False
    created_at: str = Field(default_factory=now_iso)
