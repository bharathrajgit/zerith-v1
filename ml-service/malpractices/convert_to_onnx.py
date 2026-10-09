# convert_to_onnx.py
from ultralytics import YOLO

# Convert phone detector to ONNX (disable slimming to avoid onnxruntime error)
print("Converting phone detector to ONNX...")
phone_model = YOLO('runs/detect/trained_models/phone_detector-11/weights/best.pt')
phone_model.export(format='onnx', imgsz=640, simplify=False)
print("Phone detector converted to ONNX!")

# Convert drowsiness detector to ONNX (disable slimming to avoid onnxruntime error)
print("\nConverting drowsiness detector to ONNX...")
drowsiness_model = YOLO('../runs/classify/trained_models/drowsiness_detector-11/weights/best.pt')
drowsiness_model.export(format='onnx', imgsz=640, simplify=False)
print("Drowsiness detector converted to ONNX!")

print("\n" + "=" * 50)
print("ONNX CONVERSION COMPLETE!")
print("=" * 50)
