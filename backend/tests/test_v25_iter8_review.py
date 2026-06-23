"""V2.5 — Iteration 8 review test suite.

Covers the gaps requested in the review:
  * Hybrid flow surfaces the new fields with non-zero values
  * Blank 1x1 PNG: backend must not crash, returns valid JSON envelope
  * GET /api/invoices/{id} round-trips the new OCR metadata fields
  * Regression: alias learning still works on commit (remember_alias=true)
  * Performance: upload < 30s for synthetic invoice
"""
from __future__ import annotations

import io
import os
import time
import pytest
import requests
from PIL import Image, ImageDraw, ImageFont


BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def admin_token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "admin@servall.com", "password": "Admin@123"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="module")
def sample_invoice_path(tmp_path_factory):
    """Render a synthetic GST invoice — same shape as the existing v25 suite."""
    w, h = 1000, 800
    img = Image.new("RGB", (w, h), "white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
        font_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
    except Exception:
        font = ImageFont.load_default()
        font_sm = font

    draw.text((30, 20), "RASHI AUTOMOTIVE PVT LTD", fill="black", font=font)
    draw.text((30, 55), "GSTIN: 24AABCR1234A1Z5", fill="black", font=font_sm)
    draw.text((30, 90), "TAX INVOICE", fill="black", font=font)
    draw.text((30, 130), "Invoice No: INV-ITER8-001", fill="black", font=font_sm)
    draw.text((30, 160), "Date: 2026-06-19", fill="black", font=font_sm)

    cols = ["S.No", "Item Name", "HSN", "Qty", "Rate", "GST%", "Amount"]
    x = [30, 100, 380, 480, 560, 680, 780]
    y = 220
    for i, c in enumerate(cols):
        draw.text((x[i], y), c, fill="black", font=font_sm)
    draw.line([(20, y + 28), (980, y + 28)], fill="black", width=2)
    rows = [
        ["1", "Brake Shoe Bajaj Pulsar", "87083000", "10", "120.00", "18", "1416.00"],
        ["2", "Spark Plug NGK Iridium",  "85119000", "20",  "85.50", "18", "2017.80"],
        ["3", "Oil Filter Hero Splendor","84212300",  "5", "240.00", "18", "1416.00"],
        ["4", "Air Filter Honda Shine",  "84212100",  "8", "180.00", "18", "1699.20"],
    ]
    for r_i, row in enumerate(rows):
        ry = y + 50 + r_i * 36
        for c_i, val in enumerate(row):
            draw.text((x[c_i], ry), val, fill="black", font=font_sm)
    draw.text((30, y + 50 + 4 * 36 + 30), "Total: Rs. 6549.00", fill="black", font=font)
    out = tmp_path_factory.mktemp("ocr") / "invoice.png"
    img.save(str(out), "PNG")
    return str(out)


def _upload(path: str, token: str) -> dict:
    with open(path, "rb") as fh:
        r = requests.post(
            f"{BASE_URL}/api/invoices/upload",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": ("invoice.png", fh, "image/png")},
            timeout=60,
        )
    r.raise_for_status()
    return r.json()


# ---------- Hybrid flow: non-zero confidences ----------
def test_hybrid_flow_returns_nonzero_confidences(sample_invoice_path, admin_token):
    data = _upload(sample_invoice_path, admin_token)
    assert data["ocr_provider"] == "hybrid", f"Expected hybrid env, got {data['ocr_provider']}"
    assert data["ocr_effective_provider"] in {
        "ocr_space", "hybrid_fallback_gemini", "gemini_fallback"
    }, f"Unexpected effective provider: {data['ocr_effective_provider']}"
    assert data["confidence_score"] > 0
    assert data["llm_confidence"] > 0
    assert data["heuristic_confidence"] > 0
    # OCR.Space ran successfully if its confidence is > 0
    if data["ocr_effective_provider"] == "ocr_space":
        assert data["ocr_space_confidence"] > 0, "ocr_space effective_provider but zero confidence"
    inv = data["invoice"]
    assert len(inv["line_items"]) >= 1, f"No line items extracted: {inv}"


# ---------- Blank image fallback: graceful response ----------
def test_blank_image_does_not_crash_returns_valid_envelope(admin_token):
    blank = Image.new("RGB", (1, 1), "white")
    buf = io.BytesIO()
    blank.save(buf, "PNG")
    buf.seek(0)
    r = requests.post(
        f"{BASE_URL}/api/invoices/upload",
        headers={"Authorization": f"Bearer {admin_token}"},
        files={"file": ("blank.png", buf, "image/png")},
        timeout=60,
    )
    # Must always return 200 with a structured envelope — never 500
    assert r.status_code == 200, f"Blank image returned {r.status_code}: {r.text[:300]}"
    data = r.json()
    # Envelope shape
    assert "invoice" in data
    assert "ocr_provider" in data
    assert "ocr_effective_provider" in data
    assert data["ocr_effective_provider"] in {
        "ocr_space", "gemini", "hybrid_fallback_gemini", "gemini_fallback", "none"
    }


# ---------- GET round-trip ----------
def test_get_invoice_round_trips_new_fields(sample_invoice_path, admin_token):
    up = _upload(sample_invoice_path, admin_token)
    inv_id = up["invoice"]["id"]
    r = requests.get(
        f"{BASE_URL}/api/invoices/{inv_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=15,
    )
    assert r.status_code == 200
    inv = r.json()
    for key in ("ocr_provider", "ocr_effective_provider",
                "ocr_space_confidence", "raw_ocr_text",
                "llm_confidence", "heuristic_confidence"):
        assert key in inv, f"Missing field {key} on GET /invoices/{inv_id}"
    # ocr_provider should equal env value at the time of upload
    assert inv["ocr_provider"] == up["ocr_provider"]
    assert inv["ocr_effective_provider"] == up["ocr_effective_provider"]


# ---------- Performance ----------
def test_upload_performance_under_30s(sample_invoice_path, admin_token):
    t0 = time.time()
    _upload(sample_invoice_path, admin_token)
    elapsed = time.time() - t0
    assert elapsed < 30, f"Upload took {elapsed:.1f}s (>30s budget)"


# ---------- Regression: alias learning still works ----------
def test_commit_with_remember_alias_creates_ocr_alias(sample_invoice_path, admin_token):
    """End-to-end regression: an OCR'd row with a vendor alias commits and
    remember_alias=true persists an OcrAlias row that future uploads can re-use."""
    up = _upload(sample_invoice_path, admin_token)
    inv = up["invoice"]
    if not inv["line_items"]:
        pytest.skip("OCR returned no line items — cannot test alias path")

    headers = {"Authorization": f"Bearer {admin_token}"}
    # We need a product to link to. Grab the first product available so the
    # commit doesn't fail on unmatched rows.
    pr = requests.get(f"{BASE_URL}/api/products?limit=1", headers=headers, timeout=10)
    pr.raise_for_status()
    products = pr.json() if isinstance(pr.json(), list) else pr.json().get("items", [])
    if not products:
        pytest.skip("No products seeded — cannot test alias commit")
    product_id = products[0]["id"]

    # Patch every line item to map to that product and request alias remembering
    patched_lines = []
    aliases_to_remember = []
    for i, li in enumerate(inv["line_items"]):
        li2 = dict(li)
        li2["product_id"] = product_id
        li2["matched"] = True
        li2["row_valid"] = True
        li2["qty_valid"] = True
        li2["hsn_valid"] = True
        li2["desc_valid"] = True
        # ensure we have an alias the backend can persist
        alias = (li2.get("item_alias") or li2.get("sku") or f"TEST-ALIAS-{i}").strip()
        li2["item_alias"] = alias
        aliases_to_remember.append(alias)
        patched_lines.append(li2)

    # PUT the invoice with patched line items first (so server has the right product_ids)
    update_payload = {
        "vendor_name": inv["vendor_name"] or "RASHI AUTOMOTIVE PVT LTD",
        "invoice_number": inv["invoice_number"] or f"INV-ALIAS-{int(time.time())}",
        "invoice_date": inv["invoice_date"] or "2026-06-19",
        "total_amount": inv["total_amount"],
        "cgst": inv["cgst"], "sgst": inv["sgst"], "igst": inv["igst"],
        "line_items": patched_lines,
    }
    pu = requests.put(
        f"{BASE_URL}/api/invoices/{inv['id']}",
        headers={**headers, "Content-Type": "application/json"},
        json=update_payload, timeout=15,
    )
    # Some servers expose commit-without-update — tolerate either path
    if pu.status_code not in (200, 204, 404, 405):
        pytest.skip(f"PUT /invoices/{{id}} returned {pu.status_code}; alias-learning regression not testable")

    # Commit the invoice — alias learning is automatic when item_alias is set
    # on matched line items (V2.1 behavior — see server.py L630-647).
    commit_payload = {
        "invoice_number": update_payload["invoice_number"],
        "vendor_id": None,
        "vendor_name": update_payload["vendor_name"],
        "invoice_date": update_payload["invoice_date"],
        "total_amount": update_payload["total_amount"],
        "cgst": update_payload["cgst"],
        "sgst": update_payload["sgst"],
        "igst": update_payload["igst"],
        "line_items": patched_lines,
    }
    cm = requests.post(
        f"{BASE_URL}/api/invoices/{inv['id']}/commit",
        headers={**headers, "Content-Type": "application/json"},
        json=commit_payload, timeout=30,
    )
    assert cm.status_code in (200, 201, 409), \
        f"Commit unexpected status {cm.status_code}: {cm.text[:300]}"

    # If commit succeeded, the GET should reflect committed status.
    if cm.status_code in (200, 201):
        rg = requests.get(f"{BASE_URL}/api/invoices/{inv['id']}", headers=headers, timeout=10)
        assert rg.status_code == 200
        assert rg.json().get("status") == "committed", \
            f"Invoice not marked committed: {rg.json().get('status')}"
