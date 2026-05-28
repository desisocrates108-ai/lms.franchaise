"""Gemini-powered OCR service for invoice parsing."""
import os
import json
import logging
from typing import Optional
from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-3-flash-preview"

SYSTEM_PROMPT = """You are an expert at parsing Indian B2B purchase invoices for automotive spare parts.
Extract structured JSON from the invoice image/PDF. Return ONLY valid JSON, no markdown fences.

Output schema:
{
  "vendor_name": string,
  "invoice_number": string,
  "invoice_date": "YYYY-MM-DD",
  "total_amount": number,
  "cgst": number,
  "sgst": number,
  "igst": number,
  "line_items": [
    {
      "product_name": string,
      "sku": string,
      "hsn_code": string,
      "quantity": number,
      "unit_price": number,
      "gst_percent": number,
      "line_total": number
    }
  ]
}

If any field is unreadable, use empty string or 0. Always return valid JSON."""


async def parse_invoice(file_path: str, mime_type: str) -> dict:
    """Parse a vendor invoice file using Gemini multimodal and return structured data."""
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        logger.error("EMERGENT_LLM_KEY not set")
        return _empty_response("LLM key not configured")

    try:
        chat = LlmChat(
            api_key=api_key,
            session_id=f"invoice-ocr-{os.path.basename(file_path)}",
            system_message=SYSTEM_PROMPT,
        ).with_model("gemini", GEMINI_MODEL)

        file_attachment = FileContentWithMimeType(
            file_path=file_path,
            mime_type=mime_type,
        )

        msg = UserMessage(
            text="Parse this invoice and return the JSON object with all fields.",
            file_contents=[file_attachment],
        )

        response = await chat.send_message(msg)
        text = response.strip() if isinstance(response, str) else str(response)
        # strip code fences if any
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
        data = json.loads(text)
        data["_raw"] = text[:1000]
        return data
    except json.JSONDecodeError as e:
        logger.warning("OCR JSON decode failed: %s", e)
        return _empty_response(f"Could not parse JSON: {str(e)[:100]}")
    except Exception as e:
        logger.exception("OCR failed")
        return _empty_response(f"OCR error: {str(e)[:120]}")


def _empty_response(reason: str) -> dict:
    return {
        "vendor_name": "",
        "invoice_number": "",
        "invoice_date": "",
        "total_amount": 0.0,
        "cgst": 0.0,
        "sgst": 0.0,
        "igst": 0.0,
        "line_items": [],
        "_error": reason,
    }
