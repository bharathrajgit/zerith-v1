# test_drowsiness_camera.py
import cv2
from ultralytics import YOLO
import torch

def test_drowsiness_camera():
    # Check GPU availability
    device = 0 if torch.cuda.is_available() else 'cpu'
    print(f"Using device: {'GPU' if device == 0 else 'CPU'}")
    
    # Load trained model
    model_path = '../runs/classify/trained_models/drowsiness_detector-11/weights/best.pt'
    print(f"Loading model from: {model_path}")
    model = YOLO(model_path)
    
    # Set model to device
    model.to('cuda' if device == 0 else 'cpu')
    
    # Open webcam
    cap = cv2.VideoCapture(0)
    
    if not cap.isOpened():
        print("Error: Could not open webcam")
        return
    
    print("Starting webcam. Press 'q' to quit.")
    
    while True:
        # Read frame from webcam
        ret, frame = cap.read()
        
        if not ret:
            print("Error: Could not read frame")
            break
        
        # Run inference
        results = model(frame, verbose=False)
        
        # Get prediction
        if results and len(results) > 0:
            result = results[0]
            probs = result.probs
            class_name = result.names[probs.top1]
            confidence = probs.top1conf
            
            # Display result on frame
            label = f"{class_name}: {confidence:.2%}"
            color = (0, 255, 0) if class_name == "Non Drowsy" else (0, 0, 255)
            cv2.putText(frame, label, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, color, 2)
        
        # Display frame
        cv2.imshow('Drowsiness Detection', frame)
        
        # Quit on 'q' key
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break
    
    # Release resources
    cap.release()
    cv2.destroyAllWindows()
    print("Camera test completed.")

if __name__ == '__main__':
    test_drowsiness_camera()
