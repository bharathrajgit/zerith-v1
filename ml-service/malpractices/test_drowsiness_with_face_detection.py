# test_drowsiness_with_face_detection.py
import cv2
from ultralytics import YOLO
import torch

def test_drowsiness_with_face_detection():
    # Check GPU availability
    device = 0 if torch.cuda.is_available() else 'cpu'
    print(f"Using device: {'GPU' if device == 0 else 'CPU'}")
    
    # Load trained drowsiness model
    model_path = '../runs/classify/trained_models/drowsiness_detector-11/weights/best.pt'
    print(f"Loading drowsiness model from: {model_path}")
    drowsiness_model = YOLO(model_path)
    drowsiness_model.to('cuda' if device == 0 else 'cpu')
    
    # Initialize OpenCV Haar Cascade for face detection
    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    
    # Open webcam
    cap = cv2.VideoCapture(0)
    
    if not cap.isOpened():
        print("Error: Could not open webcam")
        return
    
    print("Starting webcam with face detection. Press 'q' to quit.")
    
    while True:
        # Read frame from webcam
        ret, frame = cap.read()
        
        if not ret:
            print("Error: Could not read frame")
            break
        
        # Convert to grayscale for face detection
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # Detect faces using Haar Cascade
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
        
        if len(faces) > 0:
            for (x, y, width, height) in faces:
                # Ensure coordinates are within frame
                x = max(0, x)
                y = max(0, y)
                width = min(width, frame.shape[1] - x)
                height = min(height, frame.shape[0] - y)
                
                # Crop face region
                face_region = frame[y:y+height, x:x+width]
                
                if face_region.size > 0:
                    # Run drowsiness classification on face region
                    drowsiness_results = drowsiness_model(face_region, verbose=False)
                    
                    if drowsiness_results and len(drowsiness_results) > 0:
                        result = drowsiness_results[0]
                        probs = result.probs
                        class_name = result.names[probs.top1]
                        confidence = probs.top1conf
                        
                        # Display result on frame
                        label = f"{class_name}: {confidence:.2%}"
                        color = (0, 255, 0) if class_name == "Non Drowsy" else (0, 0, 255)
                        
                        # Draw face bounding box
                        cv2.rectangle(frame, (x, y), (x + width, y + height), color, 2)
                        
                        # Draw label
                        cv2.putText(frame, label, (x, y - 10), 
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.9, color, 2)
        else:
            # No face detected
            cv2.putText(frame, "No face detected", (10, 30), 
                       cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
        
        # Display frame
        cv2.imshow('Drowsiness Detection with Face Detection', frame)
        
        # Quit on 'q' key
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break
    
    # Release resources
    cap.release()
    cv2.destroyAllWindows()
    print("Camera test completed.")

if __name__ == '__main__':
    test_drowsiness_with_face_detection()
