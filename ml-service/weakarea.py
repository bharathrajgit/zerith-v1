# ml-service/weakarea.py
# FINAL VERSION

import os
from flask import Blueprint, request, jsonify

weakarea_bp = Blueprint('weakarea', __name__)

# Lazy load to avoid circular imports
detector = None

def get_detector():
    global detector
    if detector is None:
        from models.weak_area_detector import (
            WeakAreaDetector
        )
        detector = WeakAreaDetector()
    return detector


@weakarea_bp.route('/detect-weak-areas', methods=['POST'])
def detect_weak_areas():
    try:
        data = request.get_json(silent=True)

        if not isinstance(data, dict) or 'topics' not in data:
            return jsonify({
                'success': False,
                'message': 'topics array is required'
            }), 400

        topics = data['topics']

        if not isinstance(topics, list) or len(topics) == 0:
            return jsonify({
                'success': False,
                'message': 'topics must be a non-empty array'
            }), 400

        required_fields = [
            'topic_name', 'round1_acc', 'round2_acc',
            'round3_acc', 'attempt_count', 'hint_rate'
        ]
        for t in topics:
            for field in required_fields:
                if field not in t:
                    return jsonify({
                        'success': False,
                        'message': (
                            f'Missing field: {field} '
                            f'in topic '
                            f'{t.get("topic_name", "?")}'
                        )
                    }), 400

        result = get_detector().detect(topics)

        return jsonify({
            'success': True,
            'data':    result
        })

    except (ValueError, TypeError) as e:
        return jsonify({'success': False, 'message': f'Invalid input: {e}'}), 400
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500