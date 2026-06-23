"""OCR.Space provider — raw text + per-page confidence.

This is a thin HTTP client. Caller decides whether to use the raw text directly,
feed it to Gemini for normalization, or fall back to a different provider.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

DEFAULT_ENDPOINT = "https://api.ocr.space/parse/image"
DEFAULT_TIMEOUT = 12.0


class OcrSpaceError(RuntimeError):
    """Raised when OCR.Space returns an error or times out."""


def _bool_env(name: str, default: str = "true") -> str:
    return os.environ.get(name, default).strip().lower()


async def parse_with_ocr_space(file_path: str, mime_type: str) -> dict:
    """Send a file to the OCR.Space /parse/image endpoint.

    Returns a dict:
        {
          "raw_text": str,            # full extracted text, page-joined
          "pages": int,
          "confidence": float,         # 0..1 (best-effort: OCR.Space doesn't expose a score)
          "engine": int,
          "provider": "ocr_space",
        }

    Raises OcrSpaceError on missing key, HTTP failure, timeout, or parser-flagged error.
    """
    api_key = os.environ.get("OCR_SPACE_API_KEY", "").strip()
    if not api_key:
        raise OcrSpaceError("OCR_SPACE_API_KEY not configured")

    endpoint = os.environ.get("OCR_SPACE_ENDPOINT", DEFAULT_ENDPOINT).strip() or DEFAULT_ENDPOINT
    try:
        timeout = float(os.environ.get("OCR_SPACE_TIMEOUT_SECONDS", DEFAULT_TIMEOUT))
    except ValueError:
        timeout = DEFAULT_TIMEOUT

    # OCR Engine 2 is best for tabular invoices; falls back to engine 1 internally
    engine = int(os.environ.get("OCR_SPACE_ENGINE", "2"))
    is_table = _bool_env("OCR_SPACE_IS_TABLE", "true") in {"true", "1", "yes"}
    detect_orientation = True

    data = {
        "apikey": api_key,
        "language": "eng",
        "isOverlayRequired": "false",
        "OCREngine": str(engine),
        "isTable": "true" if is_table else "false",
        "detectOrientation": "true" if detect_orientation else "false",
        "scale": "true",
    }
    if mime_type == "application/pdf":
        data["filetype"] = "PDF"

    try:
        with open(file_path, "rb") as fh:
            files = {"file": (os.path.basename(file_path), fh, mime_type)}
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(endpoint, data=data, files=files)
    except httpx.TimeoutException as e:
        raise OcrSpaceError(f"timeout after {timeout}s: {e}")
    except Exception as e:
        raise OcrSpaceError(f"http error: {e}")

    if resp.status_code != 200:
        raise OcrSpaceError(f"HTTP {resp.status_code}: {resp.text[:200]}")

    try:
        payload = resp.json()
    except Exception as e:
        raise OcrSpaceError(f"non-json response: {e}")

    if payload.get("IsErroredOnProcessing"):
        err = payload.get("ErrorMessage") or payload.get("ErrorDetails") or "unknown error"
        if isinstance(err, list):
            err = "; ".join(str(x) for x in err)
        raise OcrSpaceError(f"ocr.space error: {str(err)[:200]}")

    results = payload.get("ParsedResults") or []
    if not results:
        raise OcrSpaceError("empty ParsedResults")

    pages_text: list[str] = []
    word_count = 0
    err_count = 0
    for r in results:
        pages_text.append(r.get("ParsedText") or "")
        # OCR.Space doesn't return a numeric score, but FileParseExitCode == 1 means clean
        exit_code = r.get("FileParseExitCode")
        if exit_code != 1:
            err_count += 1
        word_count += len((r.get("ParsedText") or "").split())

    raw_text = "\n\n".join(t for t in pages_text if t).strip()

    # Heuristic provider confidence:
    #  - 0 pages with errors → start at 0.85
    #  - some errors → 0.5
    #  - subtract for very short text
    if err_count == 0:
        conf = 0.85
    elif err_count < len(results):
        conf = 0.55
    else:
        conf = 0.20
    if word_count < 30:
        conf = min(conf, 0.40)
    if not raw_text:
        conf = 0.0

    return {
        "raw_text": raw_text,
        "pages": len(results),
        "confidence": round(conf, 3),
        "engine": engine,
        "provider": "ocr_space",
    }
