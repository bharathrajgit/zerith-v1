import os
import threading
from collections import Counter

import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier, VotingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
import diagnostic_model

load_dotenv()

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 8 * 1024 * 1024

CORS(
    app,
    resources={
        r"/ml/*": {"origins": "*"},
        r"/health": {"origins": "*"},
    },
)

from classify import classify_bp
from weakarea import weakarea_bp
from readiness import readiness_bp
from dropout import dropout_bp
from cheating import cheating_bp
from malpractices_bp import malpractices_bp

app.register_blueprint(classify_bp, url_prefix="/ml")
app.register_blueprint(weakarea_bp, url_prefix="/ml")
app.register_blueprint(readiness_bp, url_prefix="/ml")
app.register_blueprint(dropout_bp, url_prefix="/ml/dropout")
app.register_blueprint(cheating_bp, url_prefix="/ml/cheat")
app.register_blueprint(malpractices_bp, url_prefix="/ml/malpractices")

FEATURE_ORDER = diagnostic_model.FEATURE_ORDER

LEVEL_LABELS = diagnostic_model.LEVEL_LABELS

DIAGNOSTIC_MODEL_BUNDLE = None
DIAGNOSTIC_MODEL_LOCK = threading.Lock()
DIAGNOSTIC_MODEL_WARMUP_STARTED = False
MCQ_COMBINED_WEIGHT = 0.3
CODING_COMBINED_WEIGHT = 0.7


def clamp(value, lower=0.0, upper=1.0):
    return max(lower, min(upper, float(value)))


def clip_feature(name, value):
    if name == "mcq_avg_response_time":
        return float(np.clip(value, 0.0, 60.0))
    if name == "coding_attempt_rate":
        return float(np.clip(value, 0.0, 3.0))
    return clamp(value)


def weighted_coding_score(basic_score, medium_score, hard_score):
    return clamp(((basic_score * 2) + (medium_score * 6) + (hard_score * 15)) / 23.0)


def weighted_mcq_score(basic_score, medium_score, hard_score):
    return clamp((basic_score * 0.4) + (medium_score * 0.35) + (hard_score * 0.25))


def consistency_from_scores(mcq_score, basic_score, medium_score, hard_score):
    deviation = float(np.std([mcq_score, basic_score, medium_score, hard_score]))
    return clamp(1.0 - min(deviation / 0.5, 1.0))


def hard_ratio_from_scores(mcq_hard_accuracy, hard_coding_score):
    return clamp((hard_coding_score * 0.7) + (mcq_hard_accuracy * 0.3))


def combined_score_from_parts(mcq_score, coding_score):
    return clamp((mcq_score * MCQ_COMBINED_WEIGHT) + (coding_score * CODING_COMBINED_WEIGHT))


def score_bucket_ranges(level_index):
    if level_index == 0:
        return {
            "mcq_basic": (0.25, 0.55),
            "mcq_medium": (0.15, 0.45),
            "mcq_hard": (0.0, 0.25),
            "basic_coding": (0.1, 0.45),
            "medium_coding": (0.05, 0.35),
            "hard_coding": (0.0, 0.2),
            "mcq_time": (18.0, 40.0),
            "hint_rate": (0.2, 0.7),
            "attempt_rate": (1.6, 3.0),
            "time_efficiency": (0.25, 0.6),
            "completion_rate": (0.3, 0.8),
        }
    if level_index == 1:
        return {
            "mcq_basic": (0.55, 0.85),
            "mcq_medium": (0.4, 0.72),
            "mcq_hard": (0.25, 0.6),
            "basic_coding": (0.55, 0.85),
            "medium_coding": (0.35, 0.7),
            "hard_coding": (0.1, 0.5),
            "mcq_time": (14.0, 28.0),
            "hint_rate": (0.05, 0.3),
            "attempt_rate": (1.2, 2.2),
            "time_efficiency": (0.45, 0.8),
            "completion_rate": (0.6, 1.0),
        }
    return {
        "mcq_basic": (0.8, 1.0),
        "mcq_medium": (0.7, 0.95),
        "mcq_hard": (0.55, 0.9),
        "basic_coding": (0.75, 1.0),
        "medium_coding": (0.65, 0.9),
        "hard_coding": (0.5, 1.0),
        "mcq_time": (10.0, 22.0),
        "hint_rate": (0.0, 0.15),
        "attempt_rate": (1.0, 1.8),
        "time_efficiency": (0.6, 0.95),
        "completion_rate": (0.8, 1.0),
    }


def label_target_ranges(level_index):
    if level_index == 0:
        return (0.15, 0.45), (0.0, 0.35)
    if level_index == 1:
        return (0.4, 0.7), (0.3, 0.65)
    return (0.65, 1.0), (0.6, 1.0)


def sample_profile(level_index, rng):
    mcq_target, coding_target = label_target_ranges(level_index)
    ranges = score_bucket_ranges(level_index)

    for _ in range(200):
      mcq_basic = rng.uniform(*ranges["mcq_basic"])
      mcq_medium = rng.uniform(*ranges["mcq_medium"])
      mcq_hard = rng.uniform(*ranges["mcq_hard"])
      basic_coding = rng.uniform(*ranges["basic_coding"])
      medium_coding = rng.uniform(*ranges["medium_coding"])
      hard_coding = rng.uniform(*ranges["hard_coding"])

      mcq_score = weighted_mcq_score(mcq_basic, mcq_medium, mcq_hard)
      coding_score = weighted_coding_score(basic_coding, medium_coding, hard_coding)

      if mcq_target[0] <= mcq_score <= mcq_target[1] and coding_target[0] <= coding_score <= coding_target[1]:
          break

    features = {
        "mcq_score": mcq_score,
        "mcq_basic_accuracy": mcq_basic,
        "mcq_medium_accuracy": mcq_medium,
        "mcq_hard_accuracy": mcq_hard,
        "mcq_avg_response_time": rng.uniform(*ranges["mcq_time"]),
        "mcq_hint_usage_rate": rng.uniform(*ranges["hint_rate"]),
        "coding_score": coding_score,
        "basic_coding_score": basic_coding,
        "medium_coding_score": medium_coding,
        "hard_coding_score": hard_coding,
        "coding_attempt_rate": rng.uniform(*ranges["attempt_rate"]),
        "test_case_pass_rate": clamp(coding_score + rng.normal(0, 0.06)),
        "coding_time_efficiency": rng.uniform(*ranges["time_efficiency"]),
        "coding_completion_rate": rng.uniform(*ranges["completion_rate"]),
    }
    features["combined_score"] = combined_score_from_parts(features["mcq_score"], features["coding_score"])
    features["hard_performance_ratio"] = hard_ratio_from_scores(
        features["mcq_hard_accuracy"], features["hard_coding_score"]
    )
    features["consistency_score"] = consistency_from_scores(
        features["mcq_score"],
        features["basic_coding_score"],
        features["medium_coding_score"],
        features["hard_coding_score"],
    )

    noise_scales = {
        "mcq_avg_response_time": 1.5,
        "coding_attempt_rate": 0.12,
    }

    noisy = {}
    for feature_name in FEATURE_ORDER:
        scale = noise_scales.get(feature_name, 0.05)
        noisy[feature_name] = clip_feature(feature_name, features[feature_name] + rng.normal(0, scale))

    noisy["combined_score"] = combined_score_from_parts(noisy["mcq_score"], noisy["coding_score"])
    noisy["hard_performance_ratio"] = hard_ratio_from_scores(
        noisy["mcq_hard_accuracy"],
        noisy["hard_coding_score"],
    )
    noisy["consistency_score"] = consistency_from_scores(
        noisy["mcq_score"],
        noisy["basic_coding_score"],
        noisy["medium_coding_score"],
        noisy["hard_coding_score"],
    )

    return noisy


def generate_diagnostic_training_data(sample_count=3000, random_state=42):
    rng = np.random.default_rng(random_state)
    label_counts = {
        0: int(sample_count * 0.40),
        1: int(sample_count * 0.35),
    }
    label_counts[2] = sample_count - label_counts[0] - label_counts[1]

    features = []
    labels = []

    for level_index, count in label_counts.items():
        for _ in range(count):
            features.append(sample_profile(level_index, rng))
            labels.append(level_index)

    labels = np.array(labels, dtype=int)
    noise_count = max(1, int(sample_count * 0.05))
    noisy_indices = rng.choice(sample_count, size=noise_count, replace=False)
    for index in noisy_indices:
        alternatives = [0, 1, 2]
        alternatives.remove(int(labels[index]))
        labels[index] = int(rng.choice(alternatives))

    matrix = np.array([[row[name] for name in FEATURE_ORDER] for row in features], dtype=float)
    return matrix, labels


def build_diagnostic_model_bundle():
    return diagnostic_model.build_diagnostic_model_bundle()


def get_diagnostic_model_bundle():
    global DIAGNOSTIC_MODEL_BUNDLE
    if DIAGNOSTIC_MODEL_BUNDLE is None:
        with DIAGNOSTIC_MODEL_LOCK:
            if DIAGNOSTIC_MODEL_BUNDLE is None:
                DIAGNOSTIC_MODEL_BUNDLE = diagnostic_model.load_diagnostic_model_bundle()
                if DIAGNOSTIC_MODEL_BUNDLE is None:
                    DIAGNOSTIC_MODEL_BUNDLE = build_diagnostic_model_bundle()
                    diagnostic_model.save_diagnostic_model_bundle(DIAGNOSTIC_MODEL_BUNDLE)
    return DIAGNOSTIC_MODEL_BUNDLE


def start_diagnostic_model_warmup():
    global DIAGNOSTIC_MODEL_WARMUP_STARTED
    if DIAGNOSTIC_MODEL_WARMUP_STARTED:
        return

    DIAGNOSTIC_MODEL_WARMUP_STARTED = True

    def _warmup():
        try:
            get_diagnostic_model_bundle()
            print("Diagnostic ML model warm-up complete.")
        except Exception as error:
            print(f"Diagnostic ML model warm-up failed: {error}")

    threading.Thread(target=_warmup, daemon=True).start()


def validate_diagnostic_payload(payload):
    if not payload:
        return "Request body is required."

    missing = [feature for feature in FEATURE_ORDER if feature not in payload]
    if missing:
        return f"Missing fields: {', '.join(missing)}"

    return ""


def level_from_rules(features):
    combined_score = float(features["combined_score"])
    if combined_score > 0.85:
        level_index = 2
    elif combined_score >= 0.70:
        level_index = 2
    elif combined_score >= 0.40:
        level_index = 1
    else:
        level_index = 0

    if float(features["hard_coding_score"]) > 0.7 and float(features["mcq_hard_accuracy"]) > 0.7:
        level_index = min(2, level_index + 1)

    if float(features["coding_completion_rate"]) < 0.5:
        level_index = min(level_index, 1)

    if combined_score > 0.85:
        level_index = 2

    return level_index


def weak_areas_from_features(features):
    weak = []
    if float(features["basic_coding_score"]) < 0.5 or float(features["mcq_basic_accuracy"]) < 0.5:
        weak.extend(["Arrays", "Strings"])
    if float(features["medium_coding_score"]) < 0.55 or float(features["mcq_medium_accuracy"]) < 0.55:
        weak.extend(["Searching", "Intermediate Problem Patterns"])
    if float(features["hard_coding_score"]) < 0.45 or float(features["mcq_hard_accuracy"]) < 0.45:
        weak.extend(["Dynamic Programming", "Hard Graph Problems"])
    if float(features["coding_time_efficiency"]) < 0.45:
        weak.append("Timed Coding Practice")
    return list(dict.fromkeys(weak))[:4] or ["General DSA Foundations"]


def strong_areas_from_features(features):
    strong = []
    if float(features["mcq_basic_accuracy"]) >= 0.8 and float(features["basic_coding_score"]) >= 0.75:
        strong.extend(["Arrays", "Strings", "Basic Algorithms"])
    if float(features["medium_coding_score"]) >= 0.7:
        strong.append("Intermediate Algorithm Patterns")
    if float(features["hard_coding_score"]) >= 0.65 and float(features["mcq_hard_accuracy"]) >= 0.65:
        strong.extend(["Dynamic Programming", "Trees"])
    return list(dict.fromkeys(strong))[:4] or ["Consistency"]


def recommended_plan_for_level(level_label):
    if level_label == "Placement-Ready":
        return "30-day"
    if level_label == "Intermediate":
        return "60-day"
    return "90-day"


def contribution_split(features):
    mcq_component = MCQ_COMBINED_WEIGHT * float(features["mcq_score"])
    coding_component = CODING_COMBINED_WEIGHT * float(features["coding_score"])
    total = mcq_component + coding_component
    if total <= 0:
        return MCQ_COMBINED_WEIGHT, CODING_COMBINED_WEIGHT
    return mcq_component / total, coding_component / total


@app.route("/ml/classify-diagnostic", methods=["POST"])
def classify_diagnostic():
    validation_error = validate_diagnostic_payload(request.get_json())
    if validation_error:
        return jsonify({"success": False, "message": validation_error}), 400

    payload = request.get_json()
    features = {name: clip_feature(name, payload[name]) for name in FEATURE_ORDER}
    features["combined_score"] = combined_score_from_parts(features["mcq_score"], features["coding_score"])
    features["hard_performance_ratio"] = hard_ratio_from_scores(
        features["mcq_hard_accuracy"],
        features["hard_coding_score"],
    )
    features["consistency_score"] = consistency_from_scores(
        features["mcq_score"],
        features["basic_coding_score"],
        features["medium_coding_score"],
        features["hard_coding_score"],
    )

    try:
        bundle = get_diagnostic_model_bundle()
        model = bundle["model"]
        vector = np.array([[features[name] for name in FEATURE_ORDER]], dtype=float)
        probabilities = model.predict_proba(vector)[0]
        predicted_index = int(np.argmax(probabilities))
        rule_index = level_from_rules(features)

        final_index = predicted_index if abs(rule_index - predicted_index) == 0 else rule_index

        level_label = LEVEL_LABELS[final_index]
        mcq_contribution, coding_contribution = contribution_split(features)
        confidence_explanation = diagnostic_model.build_confidence_explanation(
            features,
            probabilities,
            level_label,
        )
        model_metadata = {
            "source": bundle.get("model_source", "runtime"),
            "n_features": int(bundle.get("n_features", len(FEATURE_ORDER))),
            "sample_count": int(bundle.get("sample_count", 0)),
            "kaggle_sample_count": int(bundle.get("kaggle_sample_count", 0)),
            "training_sources": bundle.get("training_sources", {}),
            "cv_accuracy": round(float(bundle.get("cv_mean_accuracy", 0)), 4),
        }

        return jsonify(
            {
                "success": True,
                "data": {
                    "level": level_label,
                    "confidence": round(float(np.max(probabilities)), 4),
                    "probabilities": {
                        LEVEL_LABELS[index]: round(float(probability), 4)
                        for index, probability in enumerate(probabilities)
                    },
                    "mcq_contribution": round(mcq_contribution, 4),
                    "coding_contribution": round(coding_contribution, 4),
                    "weak_areas": weak_areas_from_features(features),
                    "strong_areas": strong_areas_from_features(features),
                    "recommended_plan": recommended_plan_for_level(level_label),
                    "cv_accuracy": round(bundle["cv_mean_accuracy"], 4),
                    "confidence_explanation": confidence_explanation,
                    "model_metadata": model_metadata,
                },
            }
        )
    except Exception:
        fallback_index = level_from_rules(features)
        level_label = LEVEL_LABELS[fallback_index]
        mcq_contribution, coding_contribution = contribution_split(features)
        fallback_probabilities = {
            "Beginner": 0.75 if level_label == "Beginner" else 0.1,
            "Intermediate": 0.75 if level_label == "Intermediate" else 0.1,
            "Placement-Ready": 0.75 if level_label == "Placement-Ready" else 0.1,
        }

        return jsonify(
            {
                "success": True,
                "data": {
                    "level": level_label,
                    "confidence": 0.7,
                    "probabilities": fallback_probabilities,
                    "mcq_contribution": round(mcq_contribution, 4),
                    "coding_contribution": round(coding_contribution, 4),
                    "weak_areas": weak_areas_from_features(features),
                    "strong_areas": strong_areas_from_features(features),
                    "recommended_plan": recommended_plan_for_level(level_label),
                    "confidence_explanation": diagnostic_model.build_confidence_explanation(
                        features,
                        fallback_probabilities,
                        level_label,
                    ),
                    "model_metadata": {
                        "source": "fallback_rules",
                        "n_features": len(FEATURE_ORDER),
                        "sample_count": 0,
                        "kaggle_sample_count": 0,
                        "training_sources": {},
                        "cv_accuracy": 0,
                    },
                },
            }
        )


@app.route("/health", methods=["GET"])
def health():
    return (
        jsonify(
            {
                "success": True,
                "status": "OK",
                "service": "DSA Platform ML Service",
                "version": "3.0",
                "endpoints": [
                    "POST /ml/classify-level",
                    "POST /ml/classify-diagnostic",
                    "POST /ml/detect-weak-areas",
                    "POST /ml/readiness-score",
                    "GET  /ml/feature-importance",
                    "GET  /ml/training-report",
                    "GET  /ml/train",
                    "GET  /ml/proctor/health",
                    "POST /ml/proctor/analyze-frame",
                ],
            }
        ),
        200,
    )


@app.route("/ml/proctor/health", methods=["GET"])
def proctor_health():
    return (
        jsonify(
            {
                "success": True,
                "data": {
                    "ready": True,
                    "fullModelReady": False,
                    "cameraMonitoringReady": True,
                    "modelLoaded": False,
                    "modelFilePresent": False,
                    "onnxRuntimeAvailable": False,
                    "imageStackAvailable": False,
                    "modelSource": "heuristic",
                    "supportedLabels": [],
                    "supportsCameraMonitoring": True,
                    "supportsPhoneDetection": False,
                    "supportsExtraScreenDetection": False,
                    "supportsFallbackHeuristics": True,
                    "message": "Camera monitoring is available using heuristic fallback.",
                },
            }
        ),
        200,
    )


@app.route("/ml/proctor/analyze-frame", methods=["POST"])
def analyze_frame():
    """
    Analyze a frame for proctoring purposes.
    Since we're using heuristic fallback, return a safe response indicating
    no detections. The actual detection happens on the client side using
    browser-based models (face-api.js, coco-ssd).
    """
    try:
        payload = request.get_json() or {}
        
        # Return a safe response indicating no detections
        # The client-side monitoring will handle actual detections
        return jsonify(
            {
                "success": True,
                "data": {
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
                    "frameSize": {
                        "width": payload.get("width", 640),
                        "height": payload.get("height", 480),
                    },
                    "primaryViolationType": "",
                    "fallback": True,
                    "metadata": {
                        "modelLoaded": False,
                        "modelSource": "heuristic",
                        "message": "Using client-side detection fallback",
                    },
                },
            }
        ), 200
    except Exception as error:
        return jsonify({"success": False, "message": str(error)}), 500


@app.errorhandler(404)
def not_found(_error):
    return jsonify({"success": False, "message": "Endpoint not found"}), 404


@app.errorhandler(500)
def server_error(error):
    return jsonify({"success": False, "message": "Internal server error", "detail": str(error)}), 500


if __name__ == "__main__":
    port = int(
        os.environ.get("FLASK_PORT")
        or os.environ.get("PORT")
        or 8000
    )
    debug = os.environ.get("FLASK_ENV") == "development"
    start_diagnostic_model_warmup()

    print(f'\n{"=" * 45}')
    print(f"  DSA ML Service - Port {port}")
    print(f"  Debug mode: {debug}")
    print("  Endpoints:")
    print("    GET  /health")
    print("    POST /ml/classify-level")
    print("    POST /ml/classify-diagnostic")
    print("    POST /ml/detect-weak-areas")
    print("    POST /ml/readiness-score")
    print("    GET  /ml/feature-importance")
    print("    GET  /ml/proctor/health")
    print("    GET  /ml/training-report")
    print(f'{"=" * 45}\n')

    app.run(host="0.0.0.0", port=port, debug=debug)
