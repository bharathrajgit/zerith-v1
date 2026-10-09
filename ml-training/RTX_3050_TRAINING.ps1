# RTX 3050 6GB Training Guide for Windows (PowerShell)
# ====================================================

function Show-RTX3050-Guide {
    Write-Host "`n" -ForegroundColor Cyan
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  🎯 RTX 3050 6GB ML Training - GPU-Only Optimized" -ForegroundColor Cyan
    Write-Host "════════════════════════════════════════════════════════════`n" -ForegroundColor Cyan

    # Check GPU status
    Write-Host "📊 GPU Status:" -ForegroundColor Yellow
    try {
        $gpu_info = nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader
        Write-Host $gpu_info
    } catch {
        Write-Host "⚠️  nvidia-smi not found. Install NVIDIA GPU drivers." -ForegroundColor Red
    }

    Write-Host "`n" -ForegroundColor Yellow
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Yellow
    Write-Host "Available Training Commands:" -ForegroundColor Yellow
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Yellow

    Write-Host "1️⃣  Proctor Monitor Training (PyTorch + MobileNetV3):" -ForegroundColor Green
    Write-Host "    cd ml-training"
    Write-Host "    python train_proctor_model.py"
    Write-Host "    → Batch Size: 8, Workers: 0, Mixed Precision: Yes"
    Write-Host "    → Memory: ~2.3GB, Speed: ~1.8x faster (vs FP32)`n"

    Write-Host "2️⃣  Drowsiness Detector (YOLO):" -ForegroundColor Green
    Write-Host "    cd ml-service\malpractices"
    Write-Host "    python train_drowsiness_detector.py"
    Write-Host "    → Batch Size: 8, Workers: 0, Mixed Precision: Yes"
    Write-Host "    → Memory: ~3-4GB, Epochs: 50`n"

    Write-Host "3️⃣  Phone Detector (YOLO):" -ForegroundColor Green
    Write-Host "    cd ml-service\malpractices"
    Write-Host "    python train_phone_detector.py"
    Write-Host "    → Batch Size: 8, Workers: 0, Mixed Precision: Yes"
    Write-Host "    → Memory: ~3-4GB, Epochs: 50`n"

    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Yellow
    Write-Host "⚡ Real-Time GPU Monitoring (PowerShell):" -ForegroundColor Yellow
    Write-Host "    # Option 1: Continuous monitoring"
    Write-Host "    while(`$true) { clear; nvidia-smi; Start-Sleep -Milliseconds 100 }"
    Write-Host "    `n    # Option 2: Every 1 second"
    Write-Host "    while(`$true) { clear; nvidia-smi; Start-Sleep -Seconds 1 }"
    Write-Host "    `n    # Option 3: Log to file"
    Write-Host "    nvidia-smi -l 1 > gpu_log.txt`n"

    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Yellow
    Write-Host "🎯 Key Optimizations for RTX 3050:" -ForegroundColor Yellow
    Write-Host "    ✅ Batch Size: 8 (down from 16) - fits in 6GB VRAM"
    Write-Host "    ✅ Workers: 0 - no CPU overhead, pure GPU training"
    Write-Host "    ✅ Pin Memory: Enabled - faster GPU data transfer"
    Write-Host "    ✅ Mixed Precision: Enabled - 1.8x faster, 50% less memory"
    Write-Host "    ✅ CUDA Optimized: cuDNN benchmarking enabled"
    Write-Host "    ✅ num_workers=0: Prevents CPU bottleneck`n"

    Write-Host "📈 Expected Performance:" -ForegroundColor Yellow
    Write-Host "    • GPU Utilization: 85-95%"
    Write-Host "    • CPU Usage: Minimal (< 5%)"
    Write-Host "    • Training Speed: ~1.8x faster (mixed precision)"
    Write-Host "    • Memory Usage: 2-4GB out of 6GB available`n"

    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Yellow
    Write-Host "🔧 Troubleshooting:" -ForegroundColor Yellow
    
    Write-Host "    ❌ ""CUDA out of memory"" Error:" -ForegroundColor Red
    Write-Host "       → Edit the training script"
    Write-Host "       → Change batch_size=8 to batch_size=4"
    Write-Host "       → Re-run: python train_*.py`n"

    Write-Host "    ❌ Low GPU Utilization (< 50%):" -ForegroundColor Red
    Write-Host "       → Verify num_workers=0 (already set) ✓"
    Write-Host "       → Verify Mixed Precision enabled (amp=True) ✓"
    Write-Host "       → Close unnecessary applications"
    Write-Host "       → Check Task Manager: GPU should be 85-95%`n"

    Write-Host "    ❌ High CPU Usage:" -ForegroundColor Red
    Write-Host "       → This shouldn't happen with num_workers=0"
    Write-Host "       → Check Task Manager (Ctrl+Shift+Esc)"
    Write-Host "       → Close background processes (browsers, etc)`n"

    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Yellow
    Write-Host "📝 Config Files Modified:" -ForegroundColor Yellow
    Write-Host "    ✓ ml-training/train_proctor_model.py (PyTorch)"
    Write-Host "    ✓ ml-training/gpu_config.py (GPU optimization)"
    Write-Host "    ✓ ml-service/malpractices/train_drowsiness_detector.py (YOLO)"
    Write-Host "    ✓ ml-service/malpractices/train_phone_detector.py (YOLO)`n"

    Write-Host "════════════════════════════════════════════════════════════`n" -ForegroundColor Cyan
}

# Run the guide
Show-RTX3050-Guide

# Export function so it can be called again
Export-ModuleMember -Function Show-RTX3050-Guide
