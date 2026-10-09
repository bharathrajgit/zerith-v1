# train_phone_detector.py
from ultralytics import YOLO
import torch
import sys


def setup_gpu_for_rtx_3050():
    """Configure GPU for RTX 3050 6GB optimization"""
    if not torch.cuda.is_available():
        print("ERROR: CUDA not available. Exiting.")
        sys.exit(1)
    
    gpu_name = torch.cuda.get_device_name(0)
    vram_gb = torch.cuda.get_device_properties(0).total_memory / 1e9
    
    print("\n" + "="*60)
    print("🎯 RTX 3050 GPU OPTIMIZATION")
    print("="*60)
    print(f"GPU Device: {gpu_name}")
    print(f"VRAM: {vram_gb:.1f} GB")
    print(f"CUDA: {torch.version.cuda}")
    
    # Enable mixed precision for RTX (FP16 + FP32)
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    torch.backends.cudnn.benchmark = True
    
    # Determine batch size for RTX 3050
    if vram_gb >= 6:
        batch_size = 8  # RTX 3050: 6GB - safe batch size
        workers = 0      # No CPU workers - GPU-only training
    else:
        batch_size = 4
        workers = 0
    
    print(f"✓ Batch size: {batch_size} (optimized for {vram_gb:.1f}GB)")
    print(f"✓ Workers: {workers} (GPU-only mode, no CPU overhead)")
    print("✓ Mixed Precision: Enabled (FP16 + FP32)")
    print("="*60 + "\n")
    
    return batch_size, workers


if __name__ == '__main__':
    batch_size, workers = setup_gpu_for_rtx_3050()

    model = YOLO('yolov8n.pt')

    results = model.train(
        data='dataset/Phone Finder 2.0.v3i.yolov8/data.yaml',
        epochs=50,
        imgsz=640,
        batch=batch_size,          # RTX 3050: 8 (reduced from 16)
        device=0,                   # GPU device 0
        workers=workers,            # RTX 3050: 0 (no CPU overhead)
        project='trained_models',
        name='phone_detector',
        patience=10,
        save=True,
        plots=True,
        cache=False,                # Disabled for low RAM
        amp=True,                   # ✅ Mixed Precision for RTX speedup
        optimizer='SGD',            # Better with FP16 on RTX
    )

    print("\n" + "=" * 50)
    print("✅ TRAINING COMPLETE!")
    print(f"Best model saved at: {results.save_dir}/weights/best.pt")
    print("=" * 50)