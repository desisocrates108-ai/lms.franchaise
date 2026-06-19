"""Iteration 7 re-verification: warehouse_manager DN issue + hub_stock delta on CN issue/cancel."""
import os
import time
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else "http://localhost:8001"


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    return body.get("access_token") or body["token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def test_warehouse_manager_can_issue_debit_note():
    """Previously failed with 403. After fix to routers_returns.py:528 should succeed."""
    wh = _login("warehouse@servall.com", "Warehouse@123")
    pos = requests.get(f"{BASE}/api/purchase-orders", headers=_h(wh), timeout=30).json()
    pos = pos["items"] if isinstance(pos, dict) and "items" in pos else pos
    if not pos:
        import pytest
        pytest.skip("No POs available")
    payload = {"source_type": "purchase_order", "po_id": pos[0]["id"], "reason": "TEST iter7"}
    create = requests.post(f"{BASE}/api/debit-notes", headers=_h(wh), json=payload, timeout=30)
    assert create.status_code in (200, 201), create.text
    dn = create.json()
    dn_id = dn["id"]
    if not dn.get("line_items"):
        products = requests.get(f"{BASE}/api/products?limit=1", headers=_h(wh), timeout=30).json()
        products = products["items"] if isinstance(products, dict) and "items" in products else products
        vendors = requests.get(f"{BASE}/api/vendors", headers=_h(wh), timeout=30).json()
        vendors = vendors["items"] if isinstance(vendors, dict) and "items" in vendors else vendors
        edit = {
            "source_type": "purchase_order",
            "po_id": pos[0]["id"],
            "vendor_id": dn.get("vendor_id") or (vendors[0]["id"] if vendors else None),
            "reason": "TEST iter7",
            "line_items": [{
                "product_id": products[0]["id"],
                "sku": products[0].get("sku", "X"),
                "description": "TEST",
                "qty": 1,
                "unit_price": 100,
                "gst_percent": 18,
            }],
        }
        er = requests.put(f"{BASE}/api/debit-notes/{dn_id}", headers=_h(wh), json=edit, timeout=30)
        assert er.status_code == 200, er.text
    issue = requests.post(f"{BASE}/api/debit-notes/{dn_id}/issue", headers=_h(wh), timeout=30)
    assert issue.status_code == 200, f"warehouse_manager issue failed (expected 200 after fix): {issue.status_code} {issue.text}"
    body = issue.json()
    assert body.get("dn_number", "").startswith("DN-2026-"), body
    # warehouse_manager cancel
    cancel = requests.post(f"{BASE}/api/debit-notes/{dn_id}/cancel", headers=_h(wh), timeout=30)
    assert cancel.status_code == 200, f"warehouse_manager cancel failed: {cancel.status_code} {cancel.text}"


def test_credit_note_hub_stock_delta_uses_hub_main():
    """Critical fix: CN issue must increment product.hub_stock by qty; cancel must decrement back.
    Note: already covered by test_v23_phases3to8::test_cn_full_lifecycle_with_inventory_and_audit
    but kept here as additional public-URL verification."""
    admin = _login("admin@servall.com", "Admin@123")
    franchises = requests.get(f"{BASE}/api/franchises", headers=_h(admin), timeout=30).json()
    franchises = franchises["items"] if isinstance(franchises, dict) and "items" in franchises else franchises
    assert franchises
    fid = franchises[0]["id"]
    products = requests.get(f"{BASE}/api/products?limit=1", headers=_h(admin), timeout=30).json()
    products = products["items"] if isinstance(products, dict) and "items" in products else products
    assert products
    prod = products[0]
    pid = prod["id"]

    before = float(requests.get(f"{BASE}/api/products/{pid}", headers=_h(admin), timeout=30).json().get("hub_stock") or 0)

    qty = 5
    payload = {
        "franchise_id": fid,
        "source_type": "manual",
        "reason": "TEST iter7 hub_stock delta",
        "line_items": [{
            "product_id": pid,
            "sku": prod.get("sku", "X"),
            "description": prod.get("name", "T"),
            "qty": qty,
            "unit_price": 100,
            "gst_percent": 18,
        }],
    }
    cn = requests.post(f"{BASE}/api/credit-notes", headers=_h(admin), json=payload, timeout=30)
    assert cn.status_code == 200, cn.text
    cn_id = cn.json()["id"]
    issue = requests.post(f"{BASE}/api/credit-notes/{cn_id}/issue", headers=_h(admin), timeout=30)
    assert issue.status_code == 200, issue.text
    full = requests.get(f"{BASE}/api/credit-notes/{cn_id}", headers=_h(admin), timeout=30).json()
    assert full["status"] == "issued"
    assert full["cn_number"].startswith("CN-2026-")

    after_issue = float(requests.get(f"{BASE}/api/products/{pid}", headers=_h(admin), timeout=30).json().get("hub_stock") or 0)
    assert abs(after_issue - before - qty) < 0.001, f"hub_stock delta wrong: before={before} after={after_issue} expected={before + qty}"

    cancel = requests.post(f"{BASE}/api/credit-notes/{cn_id}/cancel?reason=iter7-test", headers=_h(admin), timeout=30)
    assert cancel.status_code == 200, cancel.text
    after_cancel = float(requests.get(f"{BASE}/api/products/{pid}", headers=_h(admin), timeout=30).json().get("hub_stock") or 0)
    assert abs(after_cancel - before) < 0.001, f"hub_stock rollback wrong: before={before} after_cancel={after_cancel}"


def test_login_endpoint_returns_token_clean_url():
    """Sanity: /api/auth/login responds with token (frontend will use REACT_APP_BACKEND_URL)."""
    r = requests.post(f"{BASE}/api/auth/login", json={"email": "admin@servall.com", "password": "Admin@123"}, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert "access_token" in body or "token" in body
