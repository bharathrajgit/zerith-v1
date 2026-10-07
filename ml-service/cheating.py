from flask import Blueprint, request, jsonify
from models.cheating_detector import CheatingDetector

cheating_bp = Blueprint('cheating', __name__)
detector = CheatingDetector()

@cheating_bp.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({'success': False, 'message': 'JSON object body is required'}), 400
        features = [
            float(data.get('avg_time', 0)),
            float(data.get('std_time', 0)),
            float(data.get('fast_slow_ratio', 0)),
            float(data.get('tab_switches', 0)),
            float(data.get('copy_attempts', 0)),
            float(data.get('window_blur', 0)),
            float(data.get('hint_rate', 0)),
            float(data.get('changed_answers', 0)),
            float(data.get('total_questions', 10)),
            float(data.get('past_avg_accuracy', 50))
        ]
        result = detector.predict(features)
        return jsonify({'success': True, 'data': result})
    except (ValueError, TypeError) as e:
        return jsonify({'success': False, 'message': f'Invalid input: {e}'}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500