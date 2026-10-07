# ml-service/readiness.py
# FINAL VERSION

from flask import Blueprint, request, jsonify

readiness_bp = Blueprint('readiness', __name__)

# Lazy load
scorer = None

def get_scorer():
    global scorer
    if scorer is None:
        from models.readiness_scorer import ReadinessScorer
        scorer = ReadinessScorer()
    return scorer


@readiness_bp.route('/readiness-score', methods=['POST'])
def readiness_score():
    try:
        data = request.get_json(silent=True)

        if not isinstance(data, dict) or 'mastery' not in data:
            return jsonify({
                'success': False,
                'message': 'mastery object is required'
            }), 400

        mastery = data['mastery']

        if not isinstance(mastery, dict):
            return jsonify({
                'success': False,
                'message': 'mastery must be a JSON object'
            }), 400

        result = get_scorer().calculate(mastery)

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