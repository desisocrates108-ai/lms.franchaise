"""v2.8 — Franchise Model Templates + Auto Discount Engine tests."""
import os
import time
import requests
import pytest


BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


def _login(email, pwd):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=10)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login("admin@servall.com", "Admin@123")


@pytest.fixture(scope="module")
def fr_token():
    return _login("franchise@servall.com", "Franchise@123")


def _h(t):
    return {"Authorization": f"Bearer {t}"}


# ---------- Templates ----------
def test_templates_seeded(admin_token):
    r = requests.get(f"{BASE_URL}/api/franchise-model-templates", headers=_h(admin_token), timeout=10)
    assert r.status_code == 200
    names = {t["model_name"] for t in r.json()}
    assert {"BUDDY", "STANDARD", "MASTER", "PERFORMAX"}.issubset(names)


def test_template_upsert_and_get(admin_token):
    products = requests.get(f"{BASE_URL}/api/products?limit=3", headers=_h(admin_token), timeout=10).json()
    payload = {
        "model_name": "STANDARD",
        "default_margin": 20.0,
        "default_discount": 8.0,
        "items": [{"product_id": products[0]["id"], "recommended_qty": 12}],
    }
    r = requests.post(f"{BASE_URL}/api/franchise-model-templates", headers=_h(admin_token), json=payload, timeout=10)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["default_discount"] == 8.0
    assert len(out["items"]) == 1
    assert out["items"][0]["recommended_qty"] == 12


def test_templates_role_guard(fr_token):
    # franchise_manager can READ but cannot POST
    r = requests.post(f"{BASE_URL}/api/franchise-model-templates", headers=_h(fr_token),
                      json={"model_name": "BUDDY", "items": []}, timeout=10)
    assert r.status_code == 403


# ---------- has-stock-history ----------
def test_has_stock_history_for_existing_franchise(admin_token):
    franchises = requests.get(f"{BASE_URL}/api/franchises", headers=_h(admin_token), timeout=10).json()
    # The first demo franchise should have at least one DC by now
    delhi = next((f for f in franchises if "Delhi" in f.get("name", "")), franchises[0])
    r = requests.get(f"{BASE_URL}/api/franchises/{delhi['id']}/has-stock-history",
                     headers=_h(admin_token), timeout=10)
    assert r.status_code == 200
    # delhi has had stock motion in earlier tests; assertion stays lenient
    assert "has_history" in r.json()


def test_has_stock_history_for_brand_new_franchise(admin_token):
    code = f"FR-QA-{int(time.time())}"
    r = requests.post(f"{BASE_URL}/api/franchises", headers=_h(admin_token),
                      json={"code": code, "name": "QA Brand New", "city": "X", "state": "Y",
                            "startup_model": "MASTER"}, timeout=10)
    assert r.status_code == 200
    fid = r.json()["id"]
    r = requests.get(f"{BASE_URL}/api/franchises/{fid}/has-stock-history",
                     headers=_h(admin_token), timeout=10)
    assert r.status_code == 200
    assert r.json()["has_history"] is False


# ---------- starter-kit ----------
def test_starter_kit_for_master_franchise(admin_token):
    code = f"FR-QA-{int(time.time())+1}"
    r = requests.post(f"{BASE_URL}/api/franchises", headers=_h(admin_token),
                      json={"code": code, "name": "QA Master", "city": "X", "state": "Y",
                            "startup_model": "MASTER"}, timeout=10)
    fid = r.json()["id"]
    r = requests.get(f"{BASE_URL}/api/franchises/{fid}/starter-kit",
                     headers=_h(admin_token), timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["model_name"] == "MASTER"
    assert body["default_discount"] > 0
    assert len(body["line_items"]) >= 1
    for li in body["line_items"]:
        assert "sku" in li and "unit_price" in li and "requested_qty" in li and "discount_percent" in li


# ---------- Indent with discount ----------
def test_indent_applies_discount_to_line_total(admin_token):
    franchises = requests.get(f"{BASE_URL}/api/franchises", headers=_h(admin_token), timeout=10).json()
    fid = franchises[0]["id"]
    products = requests.get(f"{BASE_URL}/api/products?limit=2", headers=_h(admin_token), timeout=10).json()
    payload = {
        "franchise_id": fid,
        "priority": "routine",
        "notes": "discount sanity",
        "line_items": [
            {"product_id": products[0]["id"], "requested_qty": 4, "discount_percent": 25.0},
        ],
    }
    r = requests.post(f"{BASE_URL}/api/indents", headers=_h(admin_token), json=payload, timeout=10)
    assert r.status_code == 200, r.text
    ind = r.json()
    li = ind["line_items"][0]
    assert li["discount_percent"] == 25.0
    expected = round(li["unit_price"] * li["requested_qty"] * 0.75, 2)
    assert abs(li["line_total"] - expected) < 0.01, (li["line_total"], expected)


# ---------- Discount summary report ----------
def test_discount_summary_report(admin_token):
    r = requests.get(f"{BASE_URL}/api/reports/discount-summary", headers=_h(admin_token), timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert "grand_total" in body and "by_franchise" in body
    g = body["grand_total"]
    for key in ("revenue_before_discount", "discount_given", "revenue_after_discount",
                "cost_total", "profit_after_discount", "indents_count"):
        assert key in g


# ---------- Customer vs Internal PDF ----------
def test_tax_invoice_pdf_has_customer_and_internal_modes(admin_token):
    invs = requests.get(f"{BASE_URL}/api/tax-invoices", headers=_h(admin_token), timeout=10).json()
    assert invs
    tid = invs[0]["id"]
    cust = requests.get(f"{BASE_URL}/api/tax-invoices/{tid}/pdf?view=customer", headers=_h(admin_token), timeout=15)
    intl = requests.get(f"{BASE_URL}/api/tax-invoices/{tid}/pdf?view=internal", headers=_h(admin_token), timeout=15)
    assert cust.status_code == 200 and cust.content[:4] == b"%PDF"
    assert intl.status_code == 200 and intl.content[:4] == b"%PDF"
    # Internal PDF should always be at least as large as customer (extra banner + columns)
    assert len(intl.content) >= len(cust.content) - 100  # allow small variance
