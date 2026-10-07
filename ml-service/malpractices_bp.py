"""Malpractice frame-analysis blueprint.

Uses an optional YOLO model (``MALPRACTICES_YOLO_MODEL`` or
``trained_models/malpractices_yolo.pt``) for phone detection. When the model or
its dependencies are unavailable, it returns a safe "no detections" response and
the client-side detectors (face-api.js / coco-ssd) remain the primary signal.
"""

import base64
import io
import os
import threading

from flask import Blueprint, jsonify, request

malpractices_bp = Blueprint("malpractices", __name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.getenv(
    "MALPRACTICES_YOLO_MODEL",
    os.path.join(BASE_DIR, "trained_models", "malpractices_yolo.pt"),
)
PHONE_LABELS = {"cell phone", "phone", "mobile", "mobile phone"}
PHONE_MIN_CONFIDENCE = float(os.getenv("MALPRACTICES_PHONE_MIN_CONFIDENCE", "0.55"))

_model = None
_model_error = ""
_model_lock = threading.Lock()


def _load_model():
    global _model, _model_error
    if _model is not None or _model_error:
        return _model
    with _model_lock:
        if _model is not None or _model_error:
            return _model
        if not os.path.exists(MODEL_PATH):
            _model_error = "Model file not found"
            return None
        try:
            from ultralytics import YOLO

            _model = YOLO(MODEL_PATH)
        except Exception as exc:  # noqa: BLE001 - optional dependency
            _model_error = f"Model load failed: {exc}"
            _model = None
    return _model


def _decode_image(image_data):
    if not image_data or not isinstance(image_data, str):
        return None
    try:
        from PIL import Image

        encoded = image_data.split(",", 1)[1] if "," in image_data else image_data
        return Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGB")
    except Exception:  # noqa: BLE001 - invalid image payload
        return None


def _empty_result(width, height, message, fallback=True):
    return {
        "detections": {
            "multipleFaces": False,
            "headPoseAway": False,
            "gazeAway": False,
            "faceMissing": False,
            "faceCount": 1,
            "phoneVisible": False,
            "extraScreenVisible": False,
        },
        "faceBoxes": [],
        "phoneBoxes": [],
        "annotations": [],
        "alerts": [],
        "signals": [],
        "confidence": 0.0,
        "riskLevel": "NONE",
        "frameSize": {"width": width, "height": height},
        "primaryViolationType": "",
        "fallback": fallback,
        "metadata": {
            "modelLoaded": _model is not None,
            "modelSource": "yolo" if _model is not None else "heuristic",
            "message": message,
        },
    }


@malpractices_bp.route("/health", methods=["GET"])
def health():
    model = _load_model()
    loaded = model is not None
    return jsonify(
        {
            "success": True,
            "data": {
                "ready": True,
                "modelLoaded": loaded,
                "modelFilePresent": os.path.exists(MODEL_PATH),
                "modelSource": "yolo" if loaded else "heuristic",
                "supportsPhoneDetection": loaded,
                "supportsFallbackHeuristics": True,
                "message": "Phone detection model loaded."
                if loaded
                else "Using client-side detection fallback.",
            },
        }
    )


@malpractices_bp.route("/analyze-frame", methods=["POST"])
def analyze_frame():
    payload = request.get_json(silent=True) or {}
    width = int(payload.get("width") or 640)
    height = int(payload.get("height") or 480)

    model = _load_model()
    if model is None:
        return jsonify({"success": True, "data": _empty_result(width, height, "Using client-side detection fallback")})

    image = _decode_image(payload.get("imageData"))
    if image is None:
        return jsonify({"success": False, "message": "imageData must be a valid base64 image"}), 400

    width, height = image.size
    try:
        results = model.predict(image, verbose=False)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"success": True, "data": _empty_result(width, height, f"Inference failed: {exc}")})

    phone_boxes = []
    names = getattr(model, "names", {}) or {}
    for result in results:
        for box in getattr(result, "boxes", []) or []:
            label = str(names.get(int(box.cls[0]), "")).lower()
            confidence = float(box.conf[0])
            if label in PHONE_LABELS and confidence >= PHONE_MIN_CONFIDENCE:
                x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
                phone_boxes.append({"box": [x1, y1, x2, y2], "confidence": confidence})

    data = _empty_result(width, height, "Phone detection model analysis", fallback=False)
    if phone_boxes:
        top = max(b["confidence"] for b in phone_boxes)
        data["detections"]["phoneVisible"] = True
        data["phoneBoxes"] = phone_boxes
        data["annotations"] = [
            {"type": "phone", "label": "Phone", "confidence": b["confidence"], "box": b["box"]}
            for b in phone_boxes
        ]
        data["alerts"] = [
            {"code": "PHONE_VISIBLE", "message": "Phone detected in the camera frame.", "severity": "HIGH", "confidence": top}
        ]
        data["signals"] = ["PHONE_VISIBLE"]
        data["confidence"] = top
        data["riskLevel"] = "HIGH"
        data["primaryViolationType"] = "mobile_detected"
    return jsonify({"success": True, "data": data})
