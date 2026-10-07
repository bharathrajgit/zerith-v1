import sys
import os
import base64
import numpy as np
import cv2
from flask import Blueprint, request, jsonify
from dotenv import load_dotenv

# Add malpractices directory to path
sys.path.append(os.path.join(os.path.dirname(__file__), 'malpractices'))

try:
    from malpractices_pipeline import MalpracticesPipeline
    PIPELINE_IMPORT_ERROR = ''
except Exception as import_error:  # noqa: BLE001 - optional pipeline
    MalpracticesPipeline = None
    PIPELINE_IMPORT_ERROR = str(import_error)

load_dotenv()

malpractices_bp = Blueprint('malpractices_bp', __name__)

# Global pipeline instance
pipeline = None

def get_pipeline():
    global pipeline
    if MalpracticesPipeline is None:
        return None
    if pipeline is None:
        device = 'cuda' if os.environ.get('USE_CUDA', 'false').lower() == 'true' else 'cpu'
        pipeline = MalpracticesPipeline(device=device)
    return pipeline

def _fallback_frame_result(frame, reason):
    return {
        'detections': {
            'phoneVisible': False,
            'headPoseAway': False,
            'faceMissing': False,
            'multipleFaces': False,
            'extraScreenVisible': False,
            'faceCount': 1,
        },
        'alerts': [],
        'signals': [],
        'riskLevel': 'LOW',
        'riskScore': 0,
        'confidence': 0,
        'frameSize': {'width': int(frame.shape[1]), 'height': int(frame.shape[0])},
        'fallback': True,
        'metadata': {
            'modelSource': 'heuristic',
            'modelLoaded': False,
            'message': f'Malpractices pipeline unavailable: {reason}',
        },
    }

@malpractices_bp.route('/analyze-frame', methods=['POST'])
def analyze_frame():
    """Analyze a frame for malpractices (phone, head pose, face missing)."""
    try:
        data = request.get_json()
        
        if not data or 'imageData' not in data:
            return jsonify({
                'success': False,
                'message': 'imageData is required'
            }), 400
        
        # Decode base64 image
        image_data = data['imageData']
        if ',' in image_data:
            image_data = image_data.split(',')[1]
        
        image_bytes = base64.b64decode(image_data)
        nparr = np.frombuffer(image_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            return jsonify({
                'success': False,
                'message': 'Failed to decode image'
            }), 400
        
        # Process frame
        pipe = get_pipeline()
        if pipe is None:
            return jsonify({'success': True, 'data': _fallback_frame_result(frame, PIPELINE_IMPORT_ERROR)})
        results = pipe.process_frame(frame)
        
        # Convert results to API format
        face_annotations = [
            {
                'type': 'face',
                'label': face_box.get('label', 'Face'),
                'bbox': face_box.get('bbox', []),
                'confidence': float(face_box.get('confidence', 1.0)),
            }
            for face_box in results.get('face_boxes', [])
        ]
        phone_annotations = [
            {
                'type': 'phone',
                'label': 'Phone',
                'bbox': phone_box.get('bbox', []),
                'confidence': float(phone_box.get('confidence', 0.0)),
            }
            for phone_box in results.get('phone_boxes', [])
        ]
        annotations = [*face_annotations, *phone_annotations]
        detections = {
            'phoneVisible': results['phone_detected'],
            'headPoseAway': results['head_pose_drowsy'],
            'faceMissing': not results['face_detected'],
            'multipleFaces': results.get('multiple_faces', False),
            'extraScreenVisible': False,
            'faceCount': results.get('face_count', 1 if results['face_detected'] else 0),
            'faceBoxes': face_annotations,
            'phoneBoxes': phone_annotations,
            'annotations': annotations,
        }
        
        # Build alerts based on results
        alerts = []
        if results['phone_detected']:
            alerts.append({
                'code': 'PHONE_VISIBLE',
                'message': f'Phone detected (confidence: {results["phone_confidence"]:.2%})',
                'severity': 'HIGH',
                'confidence': results['phone_confidence']
            })
        
        if results['head_pose_drowsy']:
            alerts.append({
                'code': 'HEAD_POSE_AWAY',
                'message': f'Head pose drowsiness detected (yaw: {results["head_pose"]["yaw"]:.1f}°, pitch: {results["head_pose"]["pitch"]:.1f}°)',
                'severity': 'MEDIUM',
                'confidence': 0.7
            })
        
        if not results['face_detected']:
            alerts.append({
                'code': 'FACE_MISSING',
                'message': 'No face detected - person missing from frame',
                'severity': 'HIGH',
                'confidence': 0.8
            })
        
        # Determine risk level
        risk_level = 'LOW'
        if results['phone_detected'] or not results['face_detected']:
            risk_level = 'HIGH'
        elif results['head_pose_drowsy']:
            risk_level = 'MEDIUM'
        
        # Build signals
        signals = []
        if results['phone_detected']:
            signals.append('PHONE_VISIBLE')
        if results['head_pose_drowsy']:
            signals.append('HEAD_POSE_AWAY')
        if not results['face_detected']:
            signals.append('FACE_MISSING')
        
        return jsonify({
            'success': True,
            'data': {
                'detections': detections,
                'alerts': alerts,
                'signals': signals,
                'riskLevel': risk_level,
                'riskScore': 0.7 if risk_level == 'HIGH' else 0.4 if risk_level == 'MEDIUM' else 0.1,
                'confidence': results['phone_confidence'] if results['phone_detected'] else 0.8 if not results['face_detected'] else 0.5,
                'frameSize': {
                    'width': int(frame.shape[1]),
                    'height': int(frame.shape[0]),
                },
                'metadata': {
                    'modelSource': 'onnx',
                    'modelLoaded': True,
                    'supportsPhoneDetection': True,
                    'supportsHeadPoseDetection': True,
                    'supportsFaceDetection': True,
                }
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@malpractices_bp.route('/health', methods=['GET'])
def health():
    """Check if malpractices pipeline is ready."""
    try:
        pipe = get_pipeline()
        if pipe is None:
            status = {
                'ready': False,
                'modelLoaded': False,
                'supportsPhoneDetection': False,
                'supportsHeadPoseDetection': False,
                'supportsFaceDetection': False,
                'message': f'Malpractices pipeline unavailable: {PIPELINE_IMPORT_ERROR}',
            }
        else:
            status = {
                'ready': True,
                'modelLoaded': True,
                'supportsPhoneDetection': True,
                'supportsHeadPoseDetection': True,
                'supportsFaceDetection': True,
                'message': 'Malpractices pipeline is ready',
            }
        return jsonify({'success': True, **status, 'data': status})
    except Exception as e:
        return jsonify({
            'success': False,
            'ready': False,
            'message': str(e)
        }), 500
