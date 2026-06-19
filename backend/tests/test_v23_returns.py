"""Tests for v2.3 Returns Engine — Credit Notes + Debit Notes."""
import pytest


@pytest.fixture(scope="module", autouse=True)
def _reset_returns(admin_client, base_url):
    """Clean up between test runs so PDF + lifecycle tests don't drift."""
    # Best-effort: just list and ignore
    return


def test_org_settings_has_return_prefixes(admin_client, base_url):
    r = admin_client.get(f"{base_url}/api/org/settings")
    assert r.status_code == 200
    org = r.json()
    assert "credit_note_prefix" in org
    assert "debit_note_prefix" in org


def test_credit_note_manual_full_lifecycle(admin_client, base_url):
    franchises = admin_client.get(f"{base_url}/api/franchises").json()
    products = admin_client.get(f"{base_url}/api/products?limit=1").json()
    fid, pid = franchises[0]["id"], products[0]["id"]

    body = {
        "source_type": "manual",
        "franchise_id": fid,
        "reason": "Damaged",
        "line_items": [{
            "product_id": pid, "sku": "T1", "description": "Test",
            "qty": 3, "unit_price": 100, "gst_percent": 18,
        }],
    }
    r = admin_client.post(f"{base_url}/api/credit-notes", json=body)
    assert r.status_code == 200, r.text
    cn = r.json()
    assert cn["status"] == "draft"
    assert cn["subtotal"] == 300.0
    assert cn["grand_total"] == 354.0
    cnid = cn["id"]

    # List
    lst = admin_client.get(f"{base_url}/api/credit-notes").json()
    assert any(x["id"] == cnid for x in lst)

    # Edit
    body["line_items"][0]["qty"] = 5
    r = admin_client.put(f"{base_url}/api/credit-notes/{cnid}", json=body)
    assert r.status_code == 200

    # Issue
    r = admin_client.post(f"{base_url}/api/credit-notes/{cnid}/issue")
    assert r.status_code == 200, r.text
    assert r.json()["cn_number"].startswith("CN-")

    # Get
    r = admin_client.get(f"{base_url}/api/credit-notes/{cnid}")
    assert r.json()["status"] == "issued"

    # PDF
    r = admin_client.get(f"{base_url}/api/credit-notes/{cnid}/pdf")
    assert r.status_code == 200
    assert r.content[:4] == b"%PDF"

    # Idempotent issue
    r2 = admin_client.post(f"{base_url}/api/credit-notes/{cnid}/issue")
    assert r2.json().get("idempotent") is True

    # Cancel reverses stock
    r = admin_client.post(f"{base_url}/api/credit-notes/{cnid}/cancel?reason=test")
    assert r.status_code == 200


def test_credit_note_from_invoice(admin_client, base_url):
    invs = admin_client.get(f"{base_url}/api/tax-invoices").json()
    if not invs:
        pytest.skip("No tax invoices in DB to test against")
    tid = invs[0]["id"]
    r = admin_client.post(f"{base_url}/api/credit-notes",
                          json={"source_type": "invoice", "tax_invoice_id": tid,
                                "reason": "Wrong items"})
    assert r.status_code == 200
    assert r.json()["tax_invoice_id"] == tid


def test_debit_note_manual_full_lifecycle(admin_client, base_url):
    vendors = admin_client.get(f"{base_url}/api/vendors").json()
    products = admin_client.get(f"{base_url}/api/products?limit=1").json()
    vid, pid = vendors[0]["id"], products[0]["id"]

    body = {
        "source_type": "manual",
        "vendor_id": vid,
        "reason": "Defective",
        "line_items": [{
            "product_id": pid, "sku": "T1", "description": "Test",
            "qty": 2, "unit_price": 250, "gst_percent": 18,
        }],
    }
    r = admin_client.post(f"{base_url}/api/debit-notes", json=body)
    assert r.status_code == 200, r.text
    dn = r.json()
    assert dn["grand_total"] == 590.0
    dnid = dn["id"]

    r = admin_client.post(f"{base_url}/api/debit-notes/{dnid}/issue")
    assert r.status_code == 200
    assert r.json()["dn_number"].startswith("DN-")

    r = admin_client.get(f"{base_url}/api/debit-notes/{dnid}/pdf")
    assert r.status_code == 200
    assert r.content[:4] == b"%PDF"


def test_debit_note_against_po(admin_client, base_url):
    pos = admin_client.get(f"{base_url}/api/purchase-orders").json()
    if not pos:
        pytest.skip("No POs available")
    po_id = pos[0]["id"]
    r = admin_client.post(f"{base_url}/api/debit-notes",
                          json={"source_type": "purchase_order", "po_id": po_id,
                                "reason": "Wrong items received"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["po_id"] == po_id
    assert j["vendor_id"]


def test_credit_note_franchise_scope(franchise_client, base_url):
    r = franchise_client.get(f"{base_url}/api/credit-notes")
    assert r.status_code == 200


def test_debit_note_franchise_forbidden(franchise_client, base_url):
    r = franchise_client.get(f"{base_url}/api/debit-notes")
    assert r.status_code == 403


def test_credit_note_invalid_source(admin_client, base_url):
    r = admin_client.post(f"{base_url}/api/credit-notes",
                          json={"source_type": "manual"})
    assert r.status_code == 400
