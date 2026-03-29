import io
from typing import Any, Dict

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS
from PIL import Image

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


@app.post("/analyze-image")
def analyze_image() -> Any:
    payload = request.get_json(silent=True) or {}
    image_url = payload.get("imageUrl")

    if not image_url:
        return jsonify({"error": "imageUrl is required."}), 400

    try:
        response = requests.get(image_url, timeout=12)
        response.raise_for_status()
        img = Image.open(io.BytesIO(response.content)).convert("RGB")
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
