# test_mediapipe.py  —  works with mediapipe 0.10+
import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision
import urllib.request
import os

# ── Download the face detector model if not present ──────────────────────────
MODEL_PATH = "blaze_face_short_range.tflite"
if not os.path.exists(MODEL_PATH):
    print("Downloading face detector model...")
    urllib.request.urlretrieve(
        "https://storage.googleapis.com/mediapipe-models/face_detector/"
        "blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
        MODEL_PATH
    )
    print("Downloaded.")

# ── Build detector ────────────────────────────────────────────────────────────
base_options  = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
options       = vision.FaceDetectorOptions(
    base_options=base_options,
    min_detection_confidence=0.5,
)
detector = vision.FaceDetector.create_from_options(options)

# ── Run camera loop ───────────────────────────────────────────────────────────
cap = cv2.VideoCapture(0)

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    # Convert BGR → RGB, wrap in MediaPipe Image
    rgb        = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image   = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    result     = detector.detect(mp_image)
    face_count = len(result.detections)

    # Draw bounding boxes
    for det in result.detections:
        bb = det.bounding_box
        cv2.rectangle(
            frame,
            (bb.origin_x, bb.origin_y),
            (bb.origin_x + bb.width, bb.origin_y + bb.height),
            (0, 255, 0) if face_count == 1 else (0, 0, 255),
            2,
        )

    # Face count overlay
    color = (0, 255, 0) if face_count == 1 else (0, 0, 255)
    cv2.putText(frame, f"Faces: {face_count}",
                (10, 35), cv2.FONT_HERSHEY_SIMPLEX, 1, color, 2)

    cv2.imshow("MediaPipe Test", frame)
    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()
detector.close()
print("MediaPipe working!")