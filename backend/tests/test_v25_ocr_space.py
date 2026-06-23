"""V2.5 — OCR.Space provider integration tests.

These tests exercise the live /api/invoices/upload endpoint with a synthetic
invoice image. They require network access for OCR.Space + Gemini.
"""
from __future__ import annotations

import os
import pytest
import requests
from PIL import Image, ImageDraw, ImageFont


@pytest.fixture(scope="module")
def sample_invoice_image(tmp_path_factory):
    """Render a synthetic invoice with a 4-row table OCR engines can read."""
    w, h = 1000, 800
    img = Image.new("RGB", (w, h), "white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", 22)
        font_sm = ImageFont.truetype("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", 18)
    except Exception:
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
            font_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
        except Exception:
            font = ImageFont.load_default()
            font_sm = font

    draw.text((30, 20), "RASHI AUTOMOTIVE PVT LTD", fill="black", font=font)
    draw.text((30, 55), "GSTIN: 24AABCR1234A1Z5", fill="black", font=font_sm)
    draw.text((30, 90), "TAX INVOICE", fill="black", font=font)
    draw.text((30, 130), "Invoice No: INV-TEST-2026-001", fill="black", font=font_sm)
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
    draw.line([(20, y + 50 + 4 * 36 + 10), (980, y + 50 + 4 * 36 + 10)], fill="black", width=1)
    draw.text((30, y + 50 + 4 * 36 + 30), "Total: Rs. 6549.00", fill="black", font=font)
    draw.text((30, y + 50 + 4 * 36 + 70), "CGST: 499.78    SGST: 499.78", fill="black", font=font_sm)

    out = tmp_path_factory.mktemp("ocr") / "invoice.png"
    img.save(str(out), "PNG")
    return str(out)


@pytest.fixture(scope="module")
def admin_token():
    base = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
    r = requests.post(f"{base}/api/auth/login",
                      json={"email": "admin@servall.com", "password": "Admin@123"},
                      timeout=10)
    r.raise_for_status()
    return r.json()["token"]


def _upload(sample, token, base):
    with open(sample, "rb") as fh:
        r = requests.post(
            f"{base}/api/invoices/upload",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": ("invoice.png", fh, "image/png")},
            timeout=60,
        )
    r.raise_for_status()
    return r.json()


def test_upload_returns_ocr_provider_metadata(sample_invoice_image, admin_token):
    base = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
    data = _upload(sample_invoice_image, admin_token, base)

    assert "ocr_provider" in data
    assert "ocr_effective_provider" in data
    assert "confidence_score" in data
    assert "llm_confidence" in data
    assert "heuristic_confidence" in data
    assert "ocr_space_confidence" in data
    # Must always carry the new field even if it is 0
    assert isinstance(data["ocr_space_confidence"], (int, float))
    # provider should equal the env (hybrid by default in this fork)
    assert data["ocr_provider"] in {"hybrid", "ocr_space", "gemini"}
    # effective provider must be one of the known values
    assert data["ocr_effective_provider"] in {
        "ocr_space", "gemini", "hybrid_fallback_gemini", "gemini_fallback", "none"
    }


def test_upload_invoice_contains_some_rows(sample_invoice_image, admin_token):
    """Quality smoke: the pipeline should produce a non-zero number of line items
    for a well-formed invoice image (table extraction working)."""
    base = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
    data = _upload(sample_invoice_image, admin_token, base)
    inv = data["invoice"]
    # Either path (ocr_space or gemini) should yield at least 1 line item for a 4-row table.
    # Don't assert exactly 4 to keep the test resilient to OCR noise.
    assert len(inv["line_items"]) >= 1, f"No line items extracted: {inv}"
    # Confidence must be > 0
    assert data["confidence_score"] > 0


def test_invoice_endpoint_persists_new_fields(sample_invoice_image, admin_token):
    """GET /invoices/{id} should round-trip the new OCR metadata fields."""
    base = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
    up = _upload(sample_invoice_image, admin_token, base)
    inv_id = up["invoice"]["id"]
    r = requests.get(f"{base}/api/invoices/{inv_id}",
                     headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
    r.raise_for_status()
    inv = r.json()
    assert "ocr_provider" in inv
    assert "ocr_effective_provider" in inv
    assert "ocr_space_confidence" in inv
