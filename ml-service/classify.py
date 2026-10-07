# ml-service/classify.py
# FINAL VERSION

import os
import json
from flask import Blueprint, request, jsonify

classify_bp = Blueprint('classify', __name__)

# Lazy load
classifier = None

def get_classifier():
    global classifier
    if classifier is None:
        from models.skill_classifier import SkillClassifier
        classifier = SkillClassifier()
    return classifier


@classify_bp.route('/classify-level', methods=['POST'])
def classify_level():
    try:
        data = request.get_json(silent=True)

        if not isinstance(data, dict) or 'performance_data' not in data:
            return jsonify({
                'success': False,
                'message': 'performance_data is required'
            }), 400

        perf = data['performance_data']

        required_keys = [
            'round1_accuracy', 'round2_accuracy',
            'round3_accuracy', 'coding_accuracy',
            'avg_response_time', 'hint_usage_rate',
            'attempt_count', 'streak_day',
            'skip_attempts', 'topics_studied_count'
        ]
        for key in required_keys:
            if key not in perf:
                return jsonify({
                    'success': False,
                    'message': f'Missing field: {key}'
                }), 400

        # Add default error rates if not provided
        perf.setdefault('conceptual_error_rate',  0.5)
        perf.setdefault('application_error_rate', 0.5)
        perf.setdefault('reasoning_error_rate',   0.5)

        from utils.feature_extractor import extract_features
        features   = extract_features(perf)
        prediction = get_classifier().predict(features)

        recommendations = {
            'Beginner': (
                'Start with Arrays fundamentals. '
                'Focus on building strong basics.'
            ),
            'Intermediate': (
                'You have good foundations. '
                'Focus on Trees and DP.'
            ),
            'Placement-Ready': (
                'You are interview-ready. '
                'Practice hard problems daily.'
            ),
        }

        return jsonify({
            'success': True,
            'data': {
                'level':          prediction['level'],
                'confidence':     prediction['confidence'],
                'probabilities':  prediction['probabilities'],
                'recommendation': recommendations.get(
                    prediction['level'], ''
                ),
            }
        })

    except (ValueError, TypeError) as e:
        return jsonify({'success': False, 'message': f'Invalid input: {e}'}), 400
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500


@classify_bp.route('/train', methods=['GET'])
def train_model():
    # Retraining overwrites the deployed model; only allow it when explicitly enabled.
    if os.environ.get('ML_ENABLE_TRAIN_ENDPOINT', 'false').lower() != 'true':
        return jsonify({
            'success': False,
            'message': 'Training endpoint is disabled. Set ML_ENABLE_TRAIN_ENDPOINT=true or run train_models.py.'
        }), 403
    try:
        from utils.data_preprocessor import (
            generate_training_data
        )
        X, y   = generate_training_data(2000)
        result = get_classifier().train(X, y)

        return jsonify({
            'success': True,
            'data': {
                'cv_accuracy': result['cv_mean_accuracy'],
                'test_accuracy': result['test_accuracy'],
                'message': 'Model trained successfully'
            }
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500


@classify_bp.route('/feature-importance', methods=['GET'])
def feature_importance():
    try:
        importance = get_classifier().get_feature_importance()

        chart_data = [
            {
                'feature':         k.replace('_', ' ')
                                    .title(),
                'raw_name':        k,
                'importance':      round(v * 100, 2),
                'importance_raw':  v,
            }
            for k, v in importance.items()
        ]

        return jsonify({
            'success': True,
            'data': {
                'features':    chart_data,
                'top_feature': chart_data[0]['raw_name'],
                'insight': (
                    f'Most predictive feature: '
                    f'{chart_data[0]["feature"]} '
                    f'({chart_data[0]["importance"]}%)'
                ),
            }
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500


@classify_bp.route('/training-report', methods=['GET'])
def training_report():
    try:
        report_path = 'trained_models/training_report.json'

        if not os.path.exists(report_path):
            return jsonify({
                'success': False,
                'message': (
                    'No report found. '
                    'Run: python train_models.py'
                )
            }), 404

        with open(report_path, 'r') as f:
            report = json.load(f)

        report['summary'] = {
            'cv_accuracy_percent': round(
                report['cv_mean_accuracy'] * 100, 1
            ),
            'cv_std_percent': round(
                report['cv_std'] * 100, 1
            ),
            'test_accuracy_percent': round(
                report['test_accuracy'] * 100, 1
            ),
            'ieee_statement': (
                f"The ensemble classifier achieved "
                f"{round(report['cv_mean_accuracy']*100,1)}"
                f"% cross-validated accuracy "
                f"(±{round(report['cv_std']*100,1)}%) "
                f"using 5-fold stratified evaluation "
                f"on {report['n_samples']} samples "
                f"with {report['n_features']} "
                f"behavioral features."
            ),
        }

        return jsonify({'success': True, 'data': report})

    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500