# Phase 1 — Critical Fixes — Completion Report

**Date:** Feb 2026  
**Local commit:** `6ab7bb1` (head of `main`)  
**Prior auto-commit with most Phase 1 work:** `f5de7a7`

## What Was Done

### 1. Branding — "Servall Nexus" → "Servall"
- `frontend/public/index.html` (page title `Servall ERP`)
- `frontend/src/components/Layout.jsx` (sidebar brand block)
- `frontend/src/components/ErrorBoundary.jsx` (header label)
- `frontend/src/pages/Login.jsx`
- `frontend/src/pages/AuditLogs.jsx` (subtitle)
- `frontend/src/App.css`
- Backend `routers_v21.py` PO PDF header
- Confirmed: zero remaining `Servall Nexus` references in `backend/`, `frontend/src/`, `frontend/public/` (only in test fixture strings, harmless).

### 2. Purchase Order Quantity Leading-Zero Bug
- `frontend/src/pages/PurchaseOrders.jsx` — `updateLine` strips leading zeros, allows free editing
- `frontend/src/pages/NewOrder.jsx` — same fix on `updateQty`
- `frontend/src/pages/Indents.jsx` — same fix on fulfill quantity input (this commit)
- All inputs now use `type="number" inputMode="numeric"` with `onFocus={(e) => e.target.select()}`.

### 3. Role Restrictions (Franchise Confidentiality)
**Frontend** (`Layout.jsx`): Franchise sidebar now shows ONLY:
- Dashboard, Indents, Delivery Challans, Tax Invoices  
Hidden from franchise: Inventory, Bulk Import, Stock Entry, Purchase Orders, Vendors, Franchises, Aging, Cycle Count, Pricing, Reports, Org Settings, Audit Logs.

**Backend** (verified via curl as franchise user):
- `GET /api/purchase-orders` → 403 ✅
- `GET /api/vendors` → 403 ✅
- `GET /api/audit-logs` → 403 ✅
- `GET /api/products` → 200 with `FRANCHISE_SAFE_KEYS` whitelist (no hub_stock / landing_price)

**Admin (super_admin) full nav verified via Playwright** (18 sidebar items).

### 4. PO Date Editability
- Backend `routers_v21.py` accepts `po_date` and `expected_delivery` (YYYY-MM-DD) on both create and update.
- Fixed a serialization regression: `insert_one()` mutates the dict with a Mongo `_id`, which broke JSON encoding on return. Now `po_doc.pop("_id", None)` before returning.
- Verified end-to-end:
  - `POST /api/purchase-orders` with po_date 2026-02-10 → persists ✅
  - `PUT /api/purchase-orders/{id}` updates to 2026-02-15 → persists ✅
  - List endpoint returns the updated dates ✅

### 5. Global Axios Error Handling
- `frontend/src/lib/api.js` response interceptor now:
  - Auto-logs out on 401 and redirects to /login
  - Surfaces 403 / 404 / 500 / network errors as toasts (with 600ms dedupe)
  - Validates payload errors (400 / 422) — shows first field error
  - Respects `x-silent: 1` header for optional polled endpoints

### 6. ErrorBoundary Wired into App
- `frontend/src/App.js` wraps the entire `<App>` and every protected route with `<ErrorBoundary>`.
- Catches render exceptions, shows a friendly fallback with "Try again" / "Reload" buttons.
- Dev mode displays the stack trace for debugging.

## Removed
- Dead `Credit Notes` and `Debit Notes` sidebar links (target pages do not exist yet; will be added back in Phase 5).

## Tests
- **Backend pytest: 134/134 passing** (`backend/tests/`)
- **Frontend smoke (Playwright):**
  - Login page renders, title `Servall ERP` ✅
  - Franchise login → sees 4 sidebar items (Dashboard, Indents, DC, Tax Invoices) ✅
  - Admin login → sees full 18-item sidebar ✅
  - Purchase Orders page renders with PO list, edit button visible ✅
- **Backend curl tests:**
  - Franchise role enforcement verified (403 on PO/vendors/audit-logs)
  - PO create + update with custom `po_date` and `expected_delivery` verified end-to-end

## Files Changed in This Session's Commit (6ab7bb1)
- `backend/routers_v21.py` — fix `_id` serialization in `POST /api/purchase-orders`
- `frontend/src/App.js` — wire `ErrorBoundary` at root and per-route
- `frontend/src/components/Layout.jsx` — remove dead credit/debit nav entries
- `frontend/src/pages/Indents.jsx` — apply leading-zero fix to fulfill input

## Files Changed in Prior Auto-Commit (f5de7a7) — Same Phase 1 Effort
- `backend/auth_utils.py`, `backend/models.py`, `backend/routers_v21.py`, `backend/routers_v22.py`, `backend/seed.py`, `backend/server.py`
- `frontend/public/index.html`, `frontend/src/App.css`
- `frontend/src/components/ErrorBoundary.jsx` (created), `frontend/src/components/Layout.jsx`
- `frontend/src/lib/api.js`
- `frontend/src/pages/AuditLogs.jsx`, `Indents.jsx`, `Login.jsx`, `NewOrder.jsx`, `PurchaseOrders.jsx`

## Known Issues / Carry-Forward
- None blocking. Pre-existing lint warnings in `Indents.jsx` (lines 78, 90, 224 — `react/no-unstable-nested-components`) are NOT introduced by Phase 1 and will be addressed in a future refactor pass.
- Phase 2 (OCR), Phase 3 (optional fields), Phase 4 (PDF redesign), Phase 5 (Credit/Debit Notes), Phase 6 (regression) — not started.
