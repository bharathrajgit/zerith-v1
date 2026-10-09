#!/usr/bin/env python3
"""
Test script for ml-service proctoring end-to-end
Tests all malpractice detection features
"""
import sys
import json
import base64
import cv2
import numpy as np
from pathlib import Path

# Add ml-service to path
sys.path.insert(0, str(Path(__file__).parent / 'ml-service'))

print("[Test] Starting proctoring end-to-end tests...")
print("=" * 60)

# Test 1: Import dependencies
print("\n[Test 1] Checking dependencies...")
try:
    import mediapipe as mp
    import cv2
    from ultralytics import YOLO
    print("✓ All dependencies loaded successfully")
except ImportError as e:
    print(f"✗ Missing dependency: {e}")
    sys.exit(1)

# Test 2: Import proctoring module
print("\n[Test 2] Loading ProctoringAnalyzer...")
try:
    # Add ml-service to path
    sys.path.insert(0, 'ml-service')
    from proctoring import ProctoringAnalyzer
    analyzer = ProctoringAnalyzer()
    print("✓ ProctoringAnalyzer initialized")
except Exception as e:
    print(f"✗ Failed to load ProctoringAnalyzer: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Test 3: Check phone model status
print("\n[Test 3] Checking phone detector model...")
if analyzer.phone_model:
    print("✓ Phone detector model loaded successfully")
else:
    print("⚠ Phone detector model not loaded (will continue with other detections)")

# Test 4: Create a test image (blank frame)
print("\n[Test 4] Testing with blank frame...")
try:
    blank_img = np.ones((480, 640, 3), dtype=np.uint8) * 255
    _, img_bytes = cv2.imencode('.jpg', blank_img)
    img_b64 = base64.b64encode(img_bytes).decode()
    
    result = analyzer.analyze_frame(img_b64, {})
    
    print(f"✓ Blank frame analyzed")
    print(f"  - Signal: {result['signal']}")
    print(f"  - Violations: {result['violations']}")
    print(f"  - Face count: {result['face_count']}")
except Exception as e:
    print(f"✗ Failed to analyze blank frame: {e}")
    import traceback
    traceback.print_exc()

# Test 5: Test with a face image (if we can generate one)
print("\n[Test 5] Testing frame analysis structure...")
try:
    test_frame = np.random.randint(0, 256, (480, 640, 3), dtype=np.uint8)
    _, img_bytes = cv2.imencode('.jpg', test_frame)
    img_b64 = base64.b64encode(img_bytes).decode()
    
    result = analyzer.analyze_frame(img_b64, {})
    
    # Check result structure
    required_keys = ['violations', 'signal', 'face_count', 'confidence', 'gaze_score', 'head_pose', 'details']
    missing_keys = [k for k in required_keys if k not in result]
    
    if missing_keys:
        print(f"✗ Missing keys in result: {missing_keys}")
    else:
        print("✓ Result structure is correct")
        print(f"  - Violations: {result['violations']}")
        print(f"  - Signal: {result['signal']}")
        print(f"  - Confidence: {result['confidence']}")
        print(f"  - Gaze Score: {result['gaze_score']}")
        print(f"  - Head Pose: {result['head_pose']}")
        
except Exception as e:
    print(f"✗ Frame analysis failed: {e}")
    import traceback
    traceback.print_exc()

# Test 6: Check status endpoint
print("\n[Test 6] Checking status endpoint...")
try:
    status = analyzer.get_status()
    
    expected_labels = ['normal', 'gaze_away', 'head_pose_away', 'multiple_faces', 'face_missing', 'phone_visible']
    
    print(f"✓ Status retrieved")
    print(f"  - Service ready: {status.get('ready')}")
    print(f"  - Phone detection available: {status.get('supportsPhoneDetection')}")
    print(f"  - Supported labels: {len(status.get('supportedLabels', []))} labels")
    
    if status.get('supportsPhoneDetection'):
        print(f"  - Phone detection: ✓ ENABLED")
    else:
        print(f"  - Phone detection: ⚠ DISABLED")
        
except Exception as e:
    print(f"✗ Status check failed: {e}")

# Test 7: Verify malpractice detection capabilities
print("\n[Test 7] Verifying malpractice detection capabilities...")
malpractices = [
    'face_missing',
    'multiple_faces',
    'gaze_away',
    'head_pose_away',
    'phone_visible'
]

for practice in malpractices:
    status = analyzer.get_status()
    if practice in status.get('supportedLabels', []):
        print(f"  ✓ {practice}")
    else:
        print(f"  ✗ {practice}")

print("\n" + "=" * 60)
print("[Test] End-to-end testing completed!")
print("=" * 60)
