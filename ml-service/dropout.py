from flask import Blueprint, request, jsonify
from models.dropout_predictor import DropoutPredictor

dropout_bp = Blueprint('dropout', __name__)
predictor = DropoutPredictor()

@dropout_bp.route('/predict', methods=['POST'])
def predict_dropout():
    try:
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({'success': False, 'message': 'JSON object body is required'}), 400
        # Expecting a list of 9 features in the same order as training
        features = [
            float(data.get('num_prev_attempts', 0)) / 10.0,
            float(data.get('studied_credits', 0)) / 180.0,
            float(data.get('avg_score', 0)) / 100.0,
            float(data.get('engagement_score', 0)),
            float(data.get('performance_score', 0)),
            float(data.get('risk_score', 0)),
            float(data.get('days_active', 0)) / 365.0,
            float(data.get('module_count', 0)) / 10.0,
            float(data.get('consistency', 0))
        ]
        result = predictor.predict(features)
        return jsonify({'success': True, 'data': result})
    except (ValueError, TypeError) as e:
        return jsonify({'success': False, 'message': f'Invalid input: {e}'}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500  