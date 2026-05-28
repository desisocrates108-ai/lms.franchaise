"""End-to-end backend tests for Servall Nexus ERP."""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")


# --------- AUTH ---------
class TestAuth:
    def test_login_admin_success(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": "admin@servall.com", "password": "Admin@123"})
        assert r.status_code == 200
        data = r.json()
        assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 20
        assert data["user"]["email"] == "admin@servall.com"
        assert data["user"]["role"] == "super_admin"

    @pytest.mark.parametrize("email,password,role", [
        ("accountant@servall.com", "Accountant@123", "hub_accountant"),
        ("warehouse@servall.com", "Warehouse@123", "warehouse_manager"),
        ("franchise@servall.com", "Franchise@123", "franchise_manager"),
    ])
    def test_login_all_demo_accounts(self, email, password, role):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": email, "password": password})
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == role

    def test_login_invalid(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": "admin@servall.com", "password": "wrong"})
        assert r.status_code == 401
        assert "Invalid email or password" in r.json().get("detail", "")

    def test_me_with_token(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == "admin@servall.com"

    def test_me_without_token(self):
        r = requests.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code in (401, 403)


# --------- DASHBOARD ---------
class TestDashboard:
    def test_dashboard_stats_full(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/dashboard/stats")
        assert r.status_code == 200, r.text
        d = r.json()
        for key in ["products_count", "vendors_count", "franchises_count",
                    "total_stock_value", "low_stock_count", "pending_indents",
                    "top_products", "trend_7d"]:
            assert key in d, f"missing key {key}"
        assert d["products_count"] >= 20
        assert d["vendors_count"] >= 6
        assert d["franchises_count"] >= 4
        assert isinstance(d["trend_7d"], list) and len(d["trend_7d"]) == 7
        assert isinstance(d["top_products"], list)


# --------- PRODUCTS ---------
class TestProducts:
    def test_list_products(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/products?limit=200")
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list) and len(items) >= 20
        sample = items[0]
        for k in ["id", "name", "sku", "hub_stock", "franchise_stock", "low_stock"]:
            assert k in sample
        assert isinstance(sample["low_stock"], bool)

    def test_list_products_low_stock_filter(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/products?low_stock=true")
        assert r.status_code == 200
        for p in r.json():
            assert p["low_stock"] is True

    def test_search_products(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/products?q=brake")
        assert r.status_code == 200

    def test_create_update_product_admin(self, admin_client):
        payload = {
            "name": "TEST_Spark Plug",
            "sku": "TEST_SKU_001",
            "category": "engine",
            "uom": "pcs",
            "landing_price": 100.0,
            "franchise_price": 120.0,
            "retail_price": 150.0,
            "safety_stock": 10,
            "reorder_qty": 50,
        }
        r = admin_client.post(f"{BASE_URL}/api/products", json=payload)
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        assert r.json()["sku"] == "TEST_SKU_001"

        upd = {**payload, "id": pid, "name": "TEST_Spark Plug Updated", "landing_price": 110.0}
        r2 = admin_client.put(f"{BASE_URL}/api/products/{pid}", json=upd)
        assert r2.status_code == 200, r2.text

        r3 = admin_client.get(f"{BASE_URL}/api/products/{pid}")
        assert r3.status_code == 200
        assert r3.json()["name"] == "TEST_Spark Plug Updated"

    def test_adjust_stock(self, admin_client):
        # find a product
        prods = admin_client.get(f"{BASE_URL}/api/products?limit=5").json()
        pid = prods[0]["id"]
        before = prods[0]["hub_stock"]
        # FormData multipart - remove json content-type
        r = requests.post(
            f"{BASE_URL}/api/products/{pid}/adjust-stock",
            data={"delta": "5", "location_type": "hub", "location_id": "hub-main", "reason": "TEST"},
            headers={"Authorization": admin_client.headers["Authorization"]},
        )
        assert r.status_code == 200, r.text
        new_qty = r.json()["new_qty"]
        assert new_qty == before + 5

    def test_bulk_margin(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/products/bulk-margin",
                              json={"margin_percent": 22.0,
                                    "update_franchise_price": True,
                                    "update_retail_price": True})
        assert r.status_code == 200
        assert r.json()["updated"] >= 20


# --------- VENDORS ---------
class TestVendors:
    def test_list_vendors(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/vendors")
        assert r.status_code == 200
        assert len(r.json()) >= 6

    def test_create_vendor_accountant(self, accountant_client):
        payload = {"name": "TEST_Vendor Co", "code": "TVC01", "gstin": "29ABCDE1234F1Z5",
                   "phone": "9999999999", "email": "vendor@test.com",
                   "address": "TEST", "credit_limit": 100000, "payment_terms_days": 30}
        r = accountant_client.post(f"{BASE_URL}/api/vendors", json=payload)
        assert r.status_code == 200, r.text
        vid = r.json()["id"]
        # PUT
        upd = {**payload, "id": vid, "credit_limit": 200000}
        r2 = accountant_client.put(f"{BASE_URL}/api/vendors/{vid}", json=upd)
        assert r2.status_code == 200


# --------- FRANCHISES ---------
class TestFranchises:
    def test_list_franchises(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/franchises")
        assert r.status_code == 200
        assert len(r.json()) >= 4

    def test_create_update_franchise_admin(self, admin_client):
        payload = {"name": "TEST_Franchise X", "code": "FX01",
                   "city": "Mumbai", "state": "MH", "address": "TEST",
                   "phone": "9000000000", "credit_limit": 500000}
        r = admin_client.post(f"{BASE_URL}/api/franchises", json=payload)
        assert r.status_code == 200, r.text
        fid = r.json()["id"]
        upd = {**payload, "id": fid, "credit_limit": 600000}
        r2 = admin_client.put(f"{BASE_URL}/api/franchises/{fid}", json=upd)
        assert r2.status_code == 200


# --------- INDENTS (full lifecycle) ---------
@pytest.fixture(scope="module")
def indent_id(admin_client, request):
    fr = admin_client.get(f"{BASE_URL}/api/franchises").json()
    prods = admin_client.get(f"{BASE_URL}/api/products?limit=10").json()
    # pick products with stock to ensure allocation works
    stocked = [p for p in prods if p["hub_stock"] >= 5][:2] or prods[:2]
    payload = {
        "franchise_id": fr[0]["id"],
        "priority": "routine",
        "notes": "TEST indent",
        "line_items": [
            {"product_id": stocked[0]["id"], "requested_qty": 3},
            {"product_id": stocked[1]["id"], "requested_qty": 2},
        ],
    }
    r = admin_client.post(f"{BASE_URL}/api/indents", json=payload)
    assert r.status_code == 200, r.text
    return r.json()["id"]


class TestIndentsLifecycle:
    def test_create_indent(self, indent_id):
        assert indent_id

    def test_list_indents(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/indents")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_franchise_mgr_sees_only_own(self, franchise_client, franchise_user):
        r = franchise_client.get(f"{BASE_URL}/api/indents")
        assert r.status_code == 200
        fid = franchise_user.get("franchise_id")
        for ind in r.json():
            assert ind["franchise_id"] == fid

    def test_approve_indent(self, admin_client, indent_id):
        r = admin_client.post(f"{BASE_URL}/api/indents/{indent_id}/approve")
        assert r.status_code == 200, r.text
        assert "fulfillment_ratio" in r.json()

    def test_dispatch_indent(self, admin_client, indent_id):
        r = requests.post(
            f"{BASE_URL}/api/indents/{indent_id}/dispatch",
            data={"transporter_name": "TEST Transport", "vehicle_number": "MH01AB1234"},
            headers={"Authorization": admin_client.headers["Authorization"]},
        )
        assert r.status_code == 200, r.text
        assert "dc" in r.json() and r.json()["dc"]["dc_number"].startswith("DC-")

    def test_deliver_indent(self, admin_client, indent_id):
        r = admin_client.post(f"{BASE_URL}/api/indents/{indent_id}/deliver")
        assert r.status_code == 200, r.text
        # Verify state
        ind = admin_client.get(f"{BASE_URL}/api/indents/{indent_id}").json()
        assert ind["status"] == "delivered"

    def test_dcs_list(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/delivery-challans")
        assert r.status_code == 200
        assert isinstance(r.json(), list) and len(r.json()) >= 1


# --------- RBAC ---------
class TestRBAC:
    def test_franchise_mgr_forbidden_audit_logs(self, franchise_client):
        r = franchise_client.get(f"{BASE_URL}/api/audit-logs")
        assert r.status_code == 403

    def test_audit_logs_super_admin(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/audit-logs")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_audit_logs_accountant(self, accountant_client):
        r = accountant_client.get(f"{BASE_URL}/api/audit-logs")
        assert r.status_code == 200

    def test_franchise_cannot_create_indent_for_other(self, franchise_client, admin_client, franchise_user):
        franchises = admin_client.get(f"{BASE_URL}/api/franchises").json()
        other = next(f for f in franchises if f["id"] != franchise_user.get("franchise_id"))
        prods = admin_client.get(f"{BASE_URL}/api/products?limit=2").json()
        r = franchise_client.post(f"{BASE_URL}/api/indents", json={
            "franchise_id": other["id"], "priority": "routine", "notes": "",
            "line_items": [{"product_id": prods[0]["id"], "requested_qty": 1}],
        })
        assert r.status_code == 403


# --------- AGING / CYCLE COUNTS / PO ---------
class TestReports:
    def test_aging_report(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/reports/aging")
        assert r.status_code == 200
        d = r.json()
        for k in ["0-30", "31-90", "91-180", "181-365", "365+"]:
            assert k in d["buckets"]
        assert "items" in d


class TestCycleCounts:
    cc_id = None

    def test_generate_cycle_count(self, admin_client):
        r = requests.post(
            f"{BASE_URL}/api/cycle-counts/generate",
            data={"type": "weekly", "count": "5"},
            headers={"Authorization": admin_client.headers["Authorization"]},
        )
        assert r.status_code == 200, r.text
        TestCycleCounts.cc_id = r.json()["id"]
        assert len(r.json()["items"]) == 5

    def test_list_cycle_counts(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/cycle-counts")
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_submit_cycle_count(self, admin_client):
        assert TestCycleCounts.cc_id, "previous test must run first"
        cc = admin_client.get(f"{BASE_URL}/api/cycle-counts/{TestCycleCounts.cc_id}").json()
        items = [{"product_id": it["product_id"],
                  "counted_qty": it["system_qty"] + 1} for it in cc["items"]]
        r = admin_client.post(f"{BASE_URL}/api/cycle-counts/{TestCycleCounts.cc_id}/submit",
                              json={"items": items})
        assert r.status_code == 200


class TestPurchaseOrders:
    def test_auto_generate(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/purchase-orders/auto-generate")
        assert r.status_code == 200, r.text
        assert "created" in r.json()

    def test_list_pos(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/purchase-orders")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
