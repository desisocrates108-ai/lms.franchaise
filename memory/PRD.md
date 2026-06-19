# Servall ERP — PRD

## Original Problem
Build a Next-Gen B2B Franchise ERP for Servall — a multi-branch two-wheeler automotive spare parts distribution network operating on a Hub-and-Spoke model. Replace Vyapar with a custom, premium, scalable ERP. Aesthetics: Apple-minimal + Notion-clean + Zoho-robust.

## User Choices
- Scope: All major modules in v1.
- AI/OCR: Gemini 3 Flash multimodal (`gemini-3-flash-preview`) via Emergent Universal Key.
- Auth: JWT-based with 4 roles (super_admin, hub_accountant, warehouse_manager, franchise_manager).
- Demo data seeded on first startup (idempotent).
- Language: User prefers English responses (confirmed in V2.1 fork, Feb 2026).

## V2.1 Implemented (Feb 2026) — Phase 1
- **OCR Engine v2**: Configurable provider/model via `OCR_PROVIDER` + `OCR_MODEL` env vars (default `gemini` / `gemini-3-flash-preview`). JSON-strict extraction, confidence_score per invoice, line-item validity flags, OCR alias learning (`/api/ocr-aliases`), reconciliation view in `StockEntry.jsx`.
- **Franchise Tier Pricing**: 4 system tiers seeded (MASTER 18%, STANDARD 22%, BUDDY 25%, PERFORMAX 28%) + custom tier support. **Category-wise margin overrides** (e.g. MASTER × Engine Parts = 15%) via `category_overrides` array on `franchise_tiers`. `_resolve_margin` helper at `routers_v21.py:152` falls back from category override → tier base margin. Tier-aware pricing applied in indent creation and `/api/franchise-tiers/{id}/preview`. UI: `/pricing/tiers` with create/edit/preview.
- **Bulk Inventory Import**: Strict 14-column Excel/CSV template, validate-then-commit flow with row-level errors, idempotent upsert by SKU. UI: `/inventory/bulk-import`.
- **Global Date Filter**: New `DateFilter` component with presets (Today, Yesterday, Last 7/30/90 days, This/Last month, This year, Custom). Wired into 9 pages: Dashboard, Inventory, StockEntry (with new Recent Invoices panel), Indents, PurchaseOrders, DeliveryChallans, AuditLogs, Vendors, Franchises. Backend `/api/filtered/*` endpoints for invoices, indents, purchase-orders, delivery-challans, stock-movements, audit-logs, dashboard-trend.
- **Editable Purchase Orders**: PUT `/api/purchase-orders/{id}` allows editing lines/qty/rates/vendor while status=draft. Approval locks the PO. PDF download via `/api/purchase-orders/{id}/pdf` (reportlab).
- **Multi-source Indents**: `/api/indents/photo` (Gemini OCR on image), `/api/indents/excel` (CSV/XLSX upload), legacy `/api/indents` defaults source='system'. `Indent.source` + `source_attachment_url` fields. UI: `/indents/new` with 3 tabs. Source badges shown on `Indents.jsx` cards.

## Implemented (May 2026)

## Architecture
- Backend: FastAPI + Motor (MongoDB), Pydantic v2, PyJWT + bcrypt, emergentintegrations for Gemini OCR.
- Frontend: React 19 + Tailwind + Shadcn UI + Recharts + Phosphor Icons + sonner toasts.
- DB collections: users, franchises, vendors, products, stock, stock_movements, invoices, purchase_orders, indents, delivery_challans, cycle_counts, audit_logs, notifications, counters.

## User Personas
1. **Super Admin**: Global financial metrics, margin control, user/franchise mgmt, audit logs.
2. **Hub Accountant**: Vendor payments, invoicing, GST, audit logs.
3. **Warehouse Manager**: Inward/outward stock, dispatch, cycle counts, POs, fulfillment.
4. **Franchise Manager**: Raises indents, tracks pipeline. Cannot see hub stock numbers.

## Implemented (May 2026)
- JWT auth (login, /auth/me, role guards), bcrypt, 4 demo accounts seeded.
- Unified inventory with multi-tier stock (hub + per-franchise), search, filters, low-stock indicator.
- Product CRUD, manual stock adjust, bulk margin update across category/all.
- AI OCR invoice ingestion (drag-drop PDF/JPG/PNG → Gemini 3 Flash → reconciliation view → commit), anomaly detection, duplicate invoice check, commits to hub stock + recalculates pricing.
- Vendor management with credit days, outstanding balance, rating, fulfillment score.
- Franchise management with GSTIN, credit limit.
- **Advanced Franchise Indent + Warehouse Fulfillment Workflow (May 28, 2026):**
  - New statuses: `pending → partially_fulfilled / awaiting_stock → fulfilled → dispatched → delivered` (+ `rejected` / `cancelled`).
  - `POST /api/indents/{id}/fulfill` — per-line `fulfill_qty` allocation, partial fulfillment supported, hub stock decremented immediately, every change logged as immutable `StockMovement` (qty_before / qty_after / delta / reference_id).
  - `POST /api/indents/{id}/reject` — with reason, notifies franchise, audit-logged.
  - `GET /api/indents/pending-stock/summary` — backorder dashboard showing pending qty vs hub availability per item.
  - `GET /api/stock-movements` — full audit trail, filter by product/reference. Forbidden (403) for franchise.
  - Frontend Smart Fulfillment Modal: live hub-stock decrement, per-line qty input bounded by `min(pending, available)`, one-click "Auto-fill Max Available", insufficient-stock visual cues.
  - Reject Dialog with reason textarea.
  - 6-column Kanban for warehouse: Pending Review / Partially Allocated / Awaiting Stock / Ready to Dispatch / Dispatched / Delivered.
  - Franchise UI: simple card grid (no Kanban), no hub-stock leakage.
- **Franchise Confidentiality (May 28, 2026):**
  - `/api/products` whitelists `FRANCHISE_SAFE_KEYS` for franchise_manager (no hub_stock, landing_price, margin_percent, safety_stock, primary_vendor_id).
  - `/api/dashboard/stats` returns reduced `is_franchise:true` payload (only my_pending/my_fulfilled/my_dispatched/my_delivered/trend_7d/total_indents).
  - `/api/indents` auto-scopes to user's franchise_id.
  - Frontend Dashboard branches on `stats.is_franchise` → "My Franchise" view with own pipeline KPIs only.
- Delivery challans + auto tax invoice with CGST/SGST/IGST, transporter + E-Way bill fields, verification QR.
- Purchase Orders: auto-generate from low stock grouped by primary vendor, status flow.
- Inventory Aging matrix (0-30 / 31-90 / 91-180 / 181-365 / 365+) with chart and items table.
- Blind cycle counting (random batch generator, variance, auto-adjust).
- Dynamic pricing engine with global/category margin update.
- Immutable audit logs (all key actions).
- Dashboard with live KPIs, 7-day trend, top-moving products, dead stock card (admin/warehouse only).
- RBAC enforced at route level via `require_roles`.
- Light + true-black dark mode toggle, global Cmd-K style search bar, mobile-responsive sidebar.

## Test Coverage
- `/app/backend/tests/test_v21_phase1.py` — 23 V2.1 Phase 1 tests (tiers CRUD + category overrides, _resolve_margin, bulk import, multi-source indents, editable PO + PDF, all 7 /filtered endpoints, OCR aliases) — ALL PASSING.
- `/app/backend/tests/test_fulfillment_workflow.py` — 19 tests (partial/full fulfill chain, validation, reject, stock-movements immutability, RBAC masking) — ALL PASSING.
- `/app/backend/tests/test_servall_backend.py` — lifecycle tests updated for new fulfill endpoint — 7 PASSING.

## Backlog
**P1 — Phase 2 (Next)**
- **Delivery Challan redesign**: professional format, WhatsApp sharing.

**P2 — Phase 3**
- **Reporting**: Inventory Value report, Stock Movement report, Purchase report, Sales report. Export to PDF/Excel.
- **Refactor `server.py`** (~1346 lines) into `/app/backend/routes/` (auth.py, products.py, indents.py, inventory.py, dashboard.py).
- Auto-reopen pending indents when restock PO is received (notify warehouse, lift "awaiting_stock" indents).
- FIFO batch-wise allocation in fulfillment.
- Barcode-based dispatch verification (mobile/tablet friendly).
- Convert N+1 stock lookups in `/api/products` and `/api/dashboard/stats` to MongoDB `$lookup`.

**P3 — Advanced**
- WhatsApp / Email low-stock alerts.
- Vendor Credit Health widget (working capital optimizer).
- Demand forecasting AI (consumption seasonality).
- Vendor rate variance recommendations on PO drafts.
- E-Way Bill API integration (GSTN).
- Excel/PDF exports.
- Stock-Movements audit page UI (admin/warehouse).

## Notes
- "Made with Emergent" badge is platform branding; cannot be removed by agent. User must deploy the app (50 credits/month) — production deployments do not show the badge.

## Changelog
### v2.2 — Phase 2: Sales Tax Invoice Module (Feb 2026)
- **OrganizationSettings model** seeded once at startup with sensible defaults; UI `/settings/org` with 4 sections (Company / Tax & Legal / Bank / Invoice Defaults) — gated to super_admin.
- **TaxInvoice model + 13 endpoints** under `routers_tax_invoice.py`: list (date+status filterable & franchise-scoped), create (manual or `source_type=challan`), update, issue (assigns invoice_number via `counters.tax_invoice` + org prefix), cancel, mark-paid, PDF (A4 GST-compliant via reportlab — inter/intra-state aware columns, totals box, amount-in-words, bank block, signature, terms), mailto deeplink.
- **Auto-create on DC deliver**: when `org_settings.auto_create_tax_invoice_on_delivery` is ON, hitting `/api/delivery-challans/{id}/deliver` materialises a draft Tax Invoice prefilled from the DC + franchise. Idempotent — re-deliver returns existing invoice.
- **Always-editable invoices** (per user choice): PUT works in any non-cancelled state; only cancelled invoices reject edits with 409. Frontend `editable` flag mirrors backend.
- **Frontend**: `TaxInvoices.jsx` list page (KPIs, search, status tabs, date filter, table, PDF/email per-row), `TaxInvoiceDetail.jsx` editor (customer + franchise picker, line items with product picker, totals card with live preview, Save/Issue/Mark-Paid/Cancel/PDF/Email/Back actions). Sidebar nav for hub_accountant + super_admin + franchise_manager (read-only).
- **No QR / No WhatsApp** on tax invoice (explicitly opted out by user; DC retains its existing WhatsApp + verification QR).
- **Tests**: +21 new pytests in `test_v22_tax_invoice.py`; updated `test_can_edit_issued` to assert always-editable behavior. Full suite 134/134 passing.

### v2.2 — OCR Improvement Module (Feb 2026)
- **Dual confidence scoring**: every line item now carries `llm_confidence` (Gemini self-rated, 0..1), `heuristic_confidence` (rule-based: qty/HSN/desc/unit validity), and a weighted `confidence` (default 60% LLM + 40% heuristic, configurable via `OCR_CONFIDENCE_LLM_WEIGHT`). Invoice-level averages of the same three exposed in API + UI.
- **Match-source tracking**: every parsed row now flagged with `match_source` ∈ {alias, sku, name, manual, null} and `auto_matched_alias` boolean. Vendor alias engine remains the top-priority matcher.
- **Validation engine sharpened**: HSN regex tightened to `\d{4,8}`. Added `unit_valid` (soft warning, not a commit blocker). Per-row `warnings[]` surfaces machine-readable codes (`missing_hsn`, `invalid_qty`, `missing_unit`, ...).
- **Reconciliation UX**: triple confidence chip cluster (Combined / LLM / Heuristic), per-row source badge, per-row C/L/H mini-chips, inline product picker for unmatched/mismatched rows, "Remember this alias on commit" checkbox (default on), Vendor-vs-System totals reconciliation panel before commit.
- **API contract**: backward compatible — all new fields additive with safe defaults. Existing `confidence_score` continues to work.
- **Tests**: +15 new tests in `test_v22_ocr_module.py`. Full suite 113/113 passing.


### v2.3 — Phase 1: Critical Fixes (Feb 2026)
- **Rebrand**: "Servall Nexus" → "Servall" everywhere except test fixtures.
- **PO Quantity leading-zero bug** fixed across PurchaseOrders.jsx, NewOrder.jsx, Indents.jsx (fulfill input).
- **Role restrictions** enforced at both frontend (Layout.jsx sidebar) and backend (require_roles on /purchase-orders, /vendors, /audit-logs, /cycle-counts, /pricing, /aging, /bulk-import, /stock-entry). Franchise sees only Dashboard / Indents / Delivery Challans / Tax Invoices.
- **Editable PO dates** (`po_date`, `expected_delivery`) on POST/PUT `/api/purchase-orders` with date inputs in PurchaseOrders.jsx.
- **Global Axios error handling** with toast surfacing (401 → logout, 403/404/500/network errors).
- **ErrorBoundary** wired at App root + per-route. Prevents blank screens on render crashes; provides Reload + Try-again.
- **Removed dead nav** for Credit/Debit Notes (will be added in Phase 5).
- Tests: 134/134 backend pytest passing. Franchise role enforcement, PO date persistence, and login flow verified via Playwright + curl.
- Local commit: `6ab7bb1` (after prior auto-commit `f5de7a7`).

