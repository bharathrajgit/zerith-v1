"""Frame-level malpractice detection used by malpractices_bp.

Face and head pose: OpenCV Haar cascades (bundled with opencv-python).
Phone: Ultralytics YOLO. Weights are resolved in this order:
  1. MALPRACTICES_YOLO_MODEL env var
  2. ml-service/trained_models/malpractices_yolo.pt (custom-trained)
  3. yolov8n.pt (COCO, class "cell phone"), downloaded on first use
If YOLO cannot be loaded, phone detection is reported as unsupported.
"""

import os
import threading

import cv2
import numpy as np

ML_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRAINED_MODELS_DIR = os.path.join(ML_SERVICE_DIR, 'trained_models')
PHONE_LABELS = {'cell phone', 'mobile phone', 'phone', 'cellphone', 'mobile'}

YAW_LIMIT_DEG = float(os.environ.get('MALPRACTICES_YAW_LIMIT', 30))
PITCH_LIMIT_DEG = float(os.environ.get('MALPRACTICES_PITCH_LIMIT', 25))
PHONE_CONFIDENCE = float(os.environ.get('MALPRACTICES_PHONE_CONFIDENCE', 0.35))
MIN_FACE_RATIO = 0.08


def _cascade(name):
    cascade = cv2.CascadeClassifier(os.path.join(cv2.data.haarcascades, name))
    if cascade.empty():
        raise RuntimeError(f'Could not load OpenCV cascade {name}')
    return cascade


def _resolve_yolo_weights():
    configured = os.environ.get('MALPRACTICES_YOLO_MODEL', '').strip()
    if configured:
        return configured
    custom = os.path.join(TRAINED_MODELS_DIR, 'malpractices_yolo.pt')
    if os.path.exists(custom):
        return custom
    return os.path.join(TRAINED_MODELS_DIR, 'yolov8n.pt')


class MalpracticesPipeline:
    def __init__(self, device='cpu'):
        self.device = device
        self.frontal = _cascade('haarcascade_frontalface_default.xml')
        self.profile = _cascade('haarcascade_profileface.xml')
        self.eyes = _cascade('haarcascade_eye.xml')
        self.phone_model = None
        self.phone_class_ids = set()
        self.phone_error = ''
        self._lock = threading.Lock()
        self._load_phone_model()

    def _load_phone_model(self):
        weights = _resolve_yolo_weights()
        try:
            from ultralytics import YOLO

            if not os.path.isabs(weights) or not os.path.exists(weights):
                os.makedirs(TRAINED_MODELS_DIR, exist_ok=True)
                # Ultralytics downloads known weights (e.g. yolov8n.pt) to the given path.
                weights = weights if os.path.isabs(weights) else os.path.join(TRAINED_MODELS_DIR, weights)
            model = YOLO(weights)
            names = model.names if isinstance(model.names, dict) else dict(enumerate(model.names))
            class_ids = {int(i) for i, label in names.items() if str(label).lower() in PHONE_LABELS}
            if not class_ids:
                raise RuntimeError(f'{os.path.basename(weights)} has no phone class')
            self.phone_model = model
            self.phone_class_ids = class_ids
        except Exception as error:  # noqa: BLE001 - phone detection is optional
            self.phone_model = None
            self.phone_error = str(error)

    def status(self):
        phone = self.phone_model is not None
        return {
            'ready': True,
            'modelLoaded': True,
            'supportsFaceDetection': True,
            'supportsHeadPoseDetection': True,
            'supportsPhoneDetection': phone,
            'message': 'Malpractices pipeline is ready' if phone
            else f'Malpractices pipeline is ready without phone detection: {self.phone_error}',
        }

    # ── Faces ──────────────────────────────────────────
    def _detect(self, cascade, gray, min_size):
        found = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(min_size, min_size))
        return [tuple(int(v) for v in box) for box in found] if len(found) else []

    @staticmethod
    def _iou(a, b):
        ax1, ay1, aw, ah = a
        bx1, by1, bw, bh = b
        ix = max(0, min(ax1 + aw, bx1 + bw) - max(ax1, bx1))
        iy = max(0, min(ay1 + ah, by1 + bh) - max(ay1, by1))
        inter = ix * iy
        union = aw * ah + bw * bh - inter
        return inter / union if union else 0.0

    def _faces(self, gray):
        min_size = max(24, int(min(gray.shape[:2]) * MIN_FACE_RATIO))
        frontal = self._detect(self.frontal, gray, min_size)
        profiles = self._detect(self.profile, gray, min_size)
        flipped = cv2.flip(gray, 1)
        width = gray.shape[1]
        profiles += [(width - x - w, y, w, h) for (x, y, w, h) in self._detect(self.profile, flipped, min_size)]

        faces = [{'box': box, 'kind': 'frontal'} for box in frontal]
        for box in profiles:
            if all(self._iou(box, face['box']) < 0.3 for face in faces):
                faces.append({'box': box, 'kind': 'profile'})
        faces.sort(key=lambda face: face['box'][2] * face['box'][3], reverse=True)
        return faces

    def _head_pose(self, gray, face):
        x, y, w, h = face['box']
        if face['kind'] == 'profile':
            center = x + w / 2
            return {'yaw': 60.0 if center < gray.shape[1] / 2 else -60.0, 'pitch': 0.0, 'roll': 0.0}

        roi = gray[y:y + int(h * 0.6), x:x + w]
        eyes = self._detect(self.eyes, roi, max(10, w // 10)) if roi.size else []
        if len(eyes) < 2:
            # Eye cascade misses often (glasses, low light); don't treat that as looking away.
            return {'yaw': 0.0, 'pitch': 0.0, 'roll': 0.0}

        eyes = sorted(sorted(eyes, key=lambda e: e[2] * e[3], reverse=True)[:2], key=lambda e: e[0])
        (lx, ly, lw, lh), (rx, ry, rw, rh) = eyes
        left = np.array([lx + lw / 2, ly + lh / 2])
        right = np.array([rx + rw / 2, ry + rh / 2])
        mid = (left + right) / 2

        # Offset of the eye midpoint from the face center, scaled to rough degrees.
        yaw = float(np.clip((mid[0] - w / 2) / (w / 2) * 90, -90, 90))
        pitch = float(np.clip((0.38 - mid[1] / h) * 150, -90, 90))
        roll = float(np.degrees(np.arctan2(right[1] - left[1], right[0] - left[0])))
        return {'yaw': yaw, 'pitch': pitch, 'roll': roll}

    # ── Phones ─────────────────────────────────────────
    def _phones(self, frame):
        if self.phone_model is None:
            return []
        with self._lock:
            results = self.phone_model.predict(
                frame,
                conf=PHONE_CONFIDENCE,
                classes=sorted(self.phone_class_ids),
                device=self.device,
                verbose=False,
            )
        boxes = []
        for result in results:
            for box in result.boxes:
                x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
                boxes.append({'bbox': [x1, y1, x2, y2], 'confidence': float(box.conf[0]), 'label': 'Phone'})
        return boxes

    # ── Entry point ────────────────────────────────────
    def process_frame(self, frame):
        gray = cv2.equalizeHist(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
        faces = self._faces(gray)
        head_pose = self._head_pose(gray, faces[0]) if faces else {'yaw': 0.0, 'pitch': 0.0, 'roll': 0.0}
        phone_boxes = self._phones(frame)

        face_boxes = [
            {
                'bbox': [float(x), float(y), float(x + w), float(y + h)],
                'confidence': 0.9 if face['kind'] == 'frontal' else 0.7,
                'label': 'Face',
            }
            for face in faces
            for (x, y, w, h) in [face['box']]
        ]

        return {
            'face_detected': bool(faces),
            'face_count': len(faces),
            'multiple_faces': len(faces) > 1,
            'face_boxes': face_boxes,
            'head_pose': head_pose,
            'head_pose_drowsy': bool(faces) and (
                abs(head_pose['yaw']) > YAW_LIMIT_DEG or abs(head_pose['pitch']) > PITCH_LIMIT_DEG
            ),
            'phone_detected': bool(phone_boxes),
            'phone_confidence': max((box['confidence'] for box in phone_boxes), default=0.0),
            'phone_boxes': phone_boxes,
        }
