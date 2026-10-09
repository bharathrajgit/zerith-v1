#!/usr/bin/env python
"""
Test Drowsiness Detector Model
Tests the trained YOLO model on images
"""

import torch
from pathlib import Path
from ultralytics import YOLO
import cv2
import numpy as np

def test_model():
    """Test the trained drowsiness detector model"""
    
    print("\n" + "="*70)
    print("DROWSINESS DETECTOR - MODEL TESTING")
    print("="*70)
    
    # Path to trained model
    model_path = r"D:\VS Code Folder\dsa-platform\runs\classify\trained_models\drowsiness_detector-11\weights\best.pt"
    
    # Check if model exists
    if not Path(model_path).exists():
        print(f"ERROR: Model not found at {model_path}")
        return False
    
    print(f"\n✅ Loading model from: {model_path}")
    
    try:
        # Load trained model
        model = YOLO(model_path)
        
        # Show model info
        print(f"✅ Model loaded successfully!")
        print(f"   GPU Available: {torch.cuda.is_available()}")
        if torch.cuda.is_available():
            print(f"   GPU Device: {torch.cuda.get_device_name(0)}")
        
        # Test on dataset
        print("\n" + "-"*70)
        print("Testing on validation dataset...")
        print("-"*70)
        
        dataset_path = r"D:\VS Code Folder\dsa-platform\ml-service\malpractices\dataset\drowsiness_yolo"
        
        # Validate model
        results = model.val(
            data=dataset_path,
            split='val',  # Validate on validation set
            imgsz=640,
            batch=8,
            device=0,  # GPU
            workers=0,
            verbose=True
        )
        
        print("\n" + "="*70)
        print("VALIDATION RESULTS")
        print("="*70)
        print(f"Model: {model_path}")
        print(f"Top-1 Accuracy: {results.top1:.4f}")
        print(f"Top-5 Accuracy: {results.top5:.4f}")
        print("="*70)
        
        return True
        
    except Exception as e:
        print(f"ERROR: {e}")
        return False


def test_single_image():
    """Test model on a single image"""
    
    print("\n" + "="*70)
    print("SINGLE IMAGE TEST")
    print("="*70)
    
    model_path = r"D:\VS Code Folder\dsa-platform\runs\classify\trained_models\drowsiness_detector-11\weights\best.pt"
    
    # Example test images from dataset
    test_images_dir = Path(r"D:\VS Code Folder\dsa-platform\ml-service\malpractices\dataset\drowsiness_yolo\val")
    
    if not test_images_dir.exists():
        print(f"No test images found at {test_images_dir}")
        print("\nTo test on custom images:")
        print("1. Place image in any folder")
        print("2. Run: python -c \"from ultralytics import YOLO; m=YOLO('best.pt'); m.predict(source='image.jpg', conf=0.5)\"")
        return
    
    try:
        model = YOLO(model_path)
        
        # Get first image from val set
        alert_images = list((test_images_dir / "alert").glob("*.jpg"))[:1]
        drowsy_images = list((test_images_dir / "drowsy").glob("*.jpg"))[:1]
        
        test_images = alert_images + drowsy_images
        
        if not test_images:
            print("No test images found")
            return
        
        print(f"\nTesting on {len(test_images)} images...")
        
        for img_path in test_images:
            results = model.predict(source=str(img_path), conf=0.5, verbose=False)
            
            if results:
                result = results[0]
                class_idx = int(result.probs.top1)
                confidence = float(result.probs.top1conf)
                class_name = result.names[class_idx]
                
                print(f"\n  Image: {img_path.name}")
                print(f"  Prediction: {class_name}")
                print(f"  Confidence: {confidence:.4f} ({confidence*100:.2f}%)")
        
        print("\n✅ Single image test completed!")
        
    except Exception as e:
        print(f"ERROR: {e}")


def test_real_time():
    """Test model on webcam (real-time)"""
    
    print("\n" + "="*70)
    print("REAL-TIME WEBCAM TEST")
    print("="*70)
    
    model_path = r"D:\VS Code Folder\dsa-platform\runs\classify\trained_models\drowsiness_detector-11\weights\best.pt"
    
    try:
        model = YOLO(model_path)
        
        print("\n📹 Starting webcam... (Press 'q' to quit)")
        print("Detecting drowsiness in real-time...\n")
        
        # Open webcam
        cap = cv2.VideoCapture(0)
        
        if not cap.isOpened():
            print("ERROR: Cannot access webcam")
            return
        
        frame_count = 0
        
        while True:
            ret, frame = cap.read()
            
            if not ret:
                break
            
            # Resize for faster inference
            frame = cv2.resize(frame, (640, 480))
            
            # Run inference
            results = model.predict(source=frame, conf=0.5, verbose=False)
            
            if results:
                result = results[0]
                class_idx = int(result.probs.top1)
                confidence = float(result.probs.top1conf)
                class_name = result.names[class_idx]
                
                # Color: Green for Alert, Red for Drowsy
                color = (0, 255, 0) if class_name == "alert" else (0, 0, 255)
                
                # Display on frame
                text = f"{class_name.upper()} ({confidence:.2f})"
                cv2.putText(frame, text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, color, 2)
            
            # Show frame
            cv2.imshow("Drowsiness Detector", frame)
            
            frame_count += 1
            if frame_count % 30 == 0:
                print(f"Processed {frame_count} frames...")
            
            # Press 'q' to quit
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
        
        cap.release()
        cv2.destroyAllWindows()
        
        print(f"\n✅ Real-time test completed! ({frame_count} frames processed)")
        
    except Exception as e:
        print(f"ERROR: {e}")


if __name__ == '__main__':
    import sys
    
    print("\n" + "="*70)
    print("DROWSINESS DETECTOR - TEST MENU")
    print("="*70)
    print("\nChoose test type:")
    print("1. Validation Test (on val dataset)")
    print("2. Single Image Test")
    print("3. Real-Time Webcam Test")
    print("0. Exit")
    
    choice = input("\nEnter choice (0-3): ").strip()
    
    if choice == "1":
        test_model()
    elif choice == "2":
        test_single_image()
    elif choice == "3":
        test_real_time()
    elif choice == "0":
        print("Exiting...")
        sys.exit(0)
    else:
        print("Invalid choice")
