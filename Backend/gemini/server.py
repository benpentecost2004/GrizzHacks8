import io
from typing import Any, Dict

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS
from PIL import Image, UnidentifiedImageError

try:
    import pillow_heif

    pillow_heif.register_heif_opener()
except ImportError:
    pillow_heif = None

from geminiImageCall import detect_ai_image_as_dict

app = Flask(__name__)
CORS(app)


def _normalize_confidence(value: Any) -> int:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 0

    # Support models returning 0-1 or 0-100 confidence ranges.
    if confidence <= 1:
        confidence *= 100

    return max(0, min(100, int(round(confidence))))


def _is_avif_image(*, image_url: str, content_type: str, image_format: str) -> bool:
    normalized_content_type = (content_type or "").lower()
    normalized_format = (image_format or "").upper()
    normalized_url = image_url.split("?", 1)[0].lower()

    return (
        "image/avif" in normalized_content_type
        or normalized_url.endswith(".avif")
        or normalized_format == "AVIF"
    )


def _load_image_for_analysis(*, image_bytes: bytes, image_url: str, content_type: str) -> Image.Image:
    image_stream = io.BytesIO(image_bytes)
    img = Image.open(image_stream)

    if _is_avif_image(
        image_url=image_url,
        content_type=content_type,
        image_format=getattr(img, "format", ""),
    ):
        # Normalize AVIF into PNG bytes so downstream analysis sees a common format.
        png_buffer = io.BytesIO()
        img.convert("RGB").save(png_buffer, format="PNG")
        png_buffer.seek(0)
        return Image.open(png_buffer).convert("RGB")

    return img.convert("RGB")


@app.post("/analyze-image")
def analyze_image() -> Any:
    payload = request.get_json(silent=True) or {}
    image_url = payload.get("imageUrl")

    if not image_url:
        return jsonify({"error": "imageUrl is required."}), 400

    try:
        response = requests.get(image_url, timeout=12)
        response.raise_for_status()
        img = _load_image_for_analysis(
            image_bytes=response.content,
            image_url=image_url,
            content_type=response.headers.get("Content-Type", ""),
        )
    except UnidentifiedImageError as exc:
        if image_url.lower().split("?", 1)[0].endswith(".avif") and pillow_heif is None:
            return (
                jsonify(
                    {
                        "error": (
                            "Failed to decode AVIF image. Install pillow-heif to enable AVIF support. "
                            f"Details: {exc}"
                        )
                    }
                ),
                400,
            )
        return jsonify({"error": f"Unsupported image format: {exc}"}), 400
    except Exception as exc:
        return jsonify({"error": f"Failed to load image URL: {exc}"}), 400

    model_result: Dict[str, Any] = detect_ai_image_as_dict(img)

    if "error" in model_result:
        return jsonify(model_result), 500

    confidence = _normalize_confidence(model_result.get("confidence"))
    reasoning = str(model_result.get("reasoning", "")).strip()

    return jsonify(
        {
            "label": model_result.get("label", "unknown"),
            "confidence": confidence,
            "reasoning": reasoning,
            "raw": model_result,
        }
    )


@app.get("/health")
def health() -> Any:
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=True)
