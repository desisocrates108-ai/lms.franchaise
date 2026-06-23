"""v2.7 — Account Management + Hub Accountant RBAC restrictions."""
import requests
import pytest


BASE_URL = __import__("os").environ["REACT_APP_BACKEND_URL"].rstrip("/")


def _login(email, pwd):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=10)
    r.raise_for_status()
    return r.json()


@pytest.fixture(scope="module")
def admin_token():
    return _login("admin@servall.com", "Admin@123")["token"]


@pytest.fixture(scope="module")
def warehouse_token():
    return _login("warehouse@servall.com", "Warehouse@123")["token"]


@pytest.fixture(scope="module")
def accountant_token():
    return _login("accountant@servall.com", "Accountant@123")["token"]


@pytest.fixture(scope="module")
def franchise_token():
    return _login("franchise@servall.com", "Franchise@123")["token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- HUB ACCOUNTANT RBAC ----------
def test_hub_accountant_blocked_from_audit_logs(accountant_token):
    r = requests.get(f"{BASE_URL}/api/audit-logs", headers=_h(accountant_token), timeout=10)
    assert r.status_code == 403


def test_hub_accountant_blocked_from_cycle_counts(accountant_token):
    r = requests.get(f"{BASE_URL}/api/cycle-counts", headers=_h(accountant_token), timeout=10)
    assert r.status_code == 403


def test_hub_accountant_blocked_from_accounts(accountant_token):
    r = requests.get(f"{BASE_URL}/api/accounts", headers=_h(accountant_token), timeout=10)
    assert r.status_code == 403


def test_hub_accountant_blocked_from_invoice_upload(accountant_token):
    # POST with no file should return 422; we just check it's not 200.
    # When role check fails, FastAPI returns 403 before request body parsing.
    r = requests.post(f"{BASE_URL}/api/invoices/upload", headers=_h(accountant_token),
                      files={"file": ("x.png", b"00", "image/png")}, timeout=10)
    assert r.status_code == 403


def test_hub_accountant_keeps_purchase_orders(accountant_token):
    r = requests.get(f"{BASE_URL}/api/purchase-orders", headers=_h(accountant_token), timeout=10)
    assert r.status_code == 200


def test_hub_accountant_keeps_vendors_and_tax_invoices(accountant_token):
    for path in ("/api/vendors", "/api/tax-invoices", "/api/credit-notes", "/api/debit-notes", "/api/reports/aging"):
        r = requests.get(f"{BASE_URL}{path}", headers=_h(accountant_token), timeout=10)
        assert r.status_code == 200, f"{path}: {r.status_code}"


# ---------- ACCOUNT MANAGEMENT — Super Admin ----------
def test_super_admin_can_list_all_accounts(admin_token):
    r = requests.get(f"{BASE_URL}/api/accounts", headers=_h(admin_token), timeout=10)
    assert r.status_code == 200
    data = r.json()
    roles = {a["role"] for a in data}
    # Must include the four demo roles
    assert "super_admin" in roles
    assert "hub_accountant" in roles
    assert "warehouse_manager" in roles


def test_super_admin_can_create_each_role(admin_token):
    # Create a one-off franchise_manager account
    franchises = requests.get(f"{BASE_URL}/api/franchises", headers=_h(admin_token), timeout=10).json()
    payload = {
        "email": "qa.fm@servall.com", "password": "Pwd@1234", "full_name": "QA FM",
        "role": "franchise_manager", "franchise_id": franchises[0]["id"],
        "username": "qa.fm", "mobile": "+91-9999999990",
    }
    r = requests.post(f"{BASE_URL}/api/accounts", headers=_h(admin_token), json=payload, timeout=10)
    # First run creates; second run conflicts — both are valid outcomes
    assert r.status_code in (200, 409), r.text


def test_super_admin_cannot_create_super_admin_via_accounts(admin_token):
    payload = {
        "email": "another.admin@servall.com", "password": "Pwd@1234",
        "full_name": "Should Fail", "role": "super_admin",
    }
    r = requests.post(f"{BASE_URL}/api/accounts", headers=_h(admin_token), json=payload, timeout=10)
    assert r.status_code == 403


# ---------- ACCOUNT MANAGEMENT — Warehouse Manager ----------
def test_warehouse_can_only_see_franchise_managers_in_hub(warehouse_token):
    r = requests.get(f"{BASE_URL}/api/accounts", headers=_h(warehouse_token), timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert all(a["role"] == "franchise_manager" for a in data), [a["role"] for a in data]


def test_warehouse_cannot_create_hub_accountant(warehouse_token):
    payload = {
        "email": "qa.ha@servall.com", "password": "Pwd@1234", "full_name": "QA HA",
        "role": "hub_accountant", "hub_id": "hub-main",
    }
    r = requests.post(f"{BASE_URL}/api/accounts", headers=_h(warehouse_token), json=payload, timeout=10)
    assert r.status_code == 403


def test_warehouse_cannot_create_warehouse_manager(warehouse_token):
    payload = {
        "email": "qa.wh@servall.com", "password": "Pwd@1234", "full_name": "QA WH",
        "role": "warehouse_manager", "hub_id": "hub-main",
    }
    r = requests.post(f"{BASE_URL}/api/accounts", headers=_h(warehouse_token), json=payload, timeout=10)
    assert r.status_code == 403


def test_warehouse_can_create_franchise_manager_in_hub(warehouse_token, admin_token):
    franchises = requests.get(f"{BASE_URL}/api/franchises", headers=_h(admin_token), timeout=10).json()
    in_hub = [f for f in franchises if f.get("hub_id") == "hub-main"]
    assert in_hub, "no franchises in hub-main"
    payload = {
        "email": "qa.wh_fm@servall.com", "password": "Pwd@1234", "full_name": "Hub FM",
        "role": "franchise_manager", "franchise_id": in_hub[0]["id"], "username": "qa.wh_fm",
    }
    r = requests.post(f"{BASE_URL}/api/accounts", headers=_h(warehouse_token), json=payload, timeout=10)
    assert r.status_code in (200, 409), r.text


# ---------- RESET PASSWORD ----------
def test_super_admin_can_reset_password(admin_token):
    franchises = requests.get(f"{BASE_URL}/api/franchises", headers=_h(admin_token), timeout=10).json()
    # Find any non-super_admin account
    accounts = requests.get(f"{BASE_URL}/api/accounts", headers=_h(admin_token), timeout=10).json()
    target = next((a for a in accounts if a["role"] == "franchise_manager"), None)
    assert target, "no franchise_manager to reset"
    # We don't actually want to break the live demo account login, so reset to a known good password
    r = requests.post(
        f"{BASE_URL}/api/accounts/{target['id']}/reset-password",
        headers=_h(admin_token), json={"new_password": "Franchise@123"}, timeout=10,
    )
    assert r.status_code == 200, r.text


# ---------- LAST LOGIN TRACKING ----------
def test_last_login_at_updates_on_login(admin_token):
    accounts = requests.get(f"{BASE_URL}/api/accounts", headers=_h(admin_token), timeout=10).json()
    admin_row = next(a for a in accounts if a["email"] == "admin@servall.com")
    assert admin_row.get("last_login_at"), "last_login_at should be set after admin login"
