# train_drowsiness_detector.py
from ultralytics import YOLO
import torch
import sys

def validate_rtx_gpu():
    """Ensure RTX GPU is available and properly configured."""
    if not torch.cuda.is_available():
        print("ERROR: CUDA is not available! RTX GPU training requires CUDA.")
        print("Please install NVIDIA CUDA Toolkit and cuDNN.")
        sys.exit(1)
    
    gpu_name = torch.cuda.get_device_name(0)
    vram_gb = torch.cuda.get_device_properties(0).total_memory / 1e9
    
    print("\n" + "=" * 60)
    print("GPU CONFIGURATION")
    print("=" * 60)
    print(f"GPU Device: {gpu_name}")
    print(f"VRAM Available: {vram_gb:.1f} GB")
    print(f"CUDA Version: {torch.version.cuda}")
    print(f"cuDNN Version: {torch.backends.cudnn.version()}")
    print("=" * 60 + "\n")
    
    # Validate it's RTX or compatible GPU
    if "RTX" not in gpu_name and "GeForce" not in gpu_name and "Tesla" not in gpu_name and "A100" not in gpu_name:
        print(f"WARNING: GPU '{gpu_name}' may not be optimal for training.")
        print("Recommended: NVIDIA RTX series (RTX 2060+, RTX 3060+, RTX 4060+)")
    
    return vram_gb

def optimize_cuda():
    """Optimize CUDA settings for maximum training speed."""
    # Enable TF32 for faster training on Ampere GPUs (RTX 30/40 series)
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    
    # Use CUDNN benchmarking for faster convolutions
    torch.backends.cudnn.benchmark = True
    
    # Pre-allocate CUDA memory for efficiency
    torch.cuda.empty_cache()
    
    print("✓ CUDA optimizations enabled (TF32, cuDNN benchmark)")

def determine_batch_size(vram_gb):
    """Determine optimal batch size based on available VRAM."""
    if vram_gb >= 24:  # RTX 4090, A6000
        return 64
    elif vram_gb >= 16:  # RTX 4080, RTX 3090
        return 48
    elif vram_gb >= 12:  # RTX 4070 Ti, RTX 3080
        return 40
    elif vram_gb >= 10:  # RTX 4070
        return 32
    elif vram_gb >= 8:   # RTX 3070, RTX 4060 Ti
        return 28
    elif vram_gb >= 6:   # RTX 3060, RTX 4060
        return 20
    else:
        return 16  # Fallback for smaller GPUs

if __name__ == '__main__':
    # Validate and optimize GPU
    vram_gb = validate_rtx_gpu()
    optimize_cuda()
    
    # Determine optimal batch size
    batch_size = determine_batch_size(vram_gb)
    print(f"✓ Using batch size: {batch_size} (optimized for {vram_gb:.1f}GB VRAM)\n")
    
    # Load model
    print("Loading YOLOv8 Small model...")
    model = YOLO('yolov8s-cls.pt')
    
    # Train with RTX GPU optimizations
    print("Starting training with RTX GPU acceleration...\n")
    results = model.train(
        data='dataset/drowsiness_yolo',
        epochs=50,
        imgsz=640,
        batch=batch_size,           # Optimized for RTX VRAM
        device=0,                    # Force GPU device 0 (RTX GPU)
        workers=4,                   # Increased for better data loading
        project='trained_models',
        name='drowsiness_detector',
        patience=10,
        save=True,
        plots=True,
        cache=False,
        # RTX GPU optimizations
        amp=True,                    # Enable Automatic Mixed Precision (FP16) - HUGE speedup on RTX
        optimizer='SGD',             # SGD often better with FP16 on RTX
        lr0=0.01,                    # Initial learning rate
        lrf=0.01,                    # Final learning rate
        hsv_h=0.015,                 # Image HSV-Hue augmentation
        hsv_s=0.7,                   # Image HSV-Saturation augmentation
        hsv_v=0.4,                   # Image HSV-Value augmentation
        flipud=0.5,                  # Image flip up-down (probability)
        fliplr=0.5,                  # Image flip left-right (probability)
        verbose=True,
    )
    
    # Print results
    print("\n" + "=" * 60)
    print("TRAINING COMPLETE!")
    print("=" * 60)
    print(f"Best model saved at: {results.save_dir}/weights/best.pt")
    print(f"Training time: {results.training_time:.2f} seconds" if hasattr(results, 'training_time') else "")
    print("=" * 60)
    
    # Cleanup
    torch.cuda.empty_cache()
