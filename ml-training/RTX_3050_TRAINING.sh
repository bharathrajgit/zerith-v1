#!/bin/bash
# RTX 3050 6GB Training Commands - GPU-Only Optimization
# ====================================================

# Color codes for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  RTX 3050 6GB ML Training - GPU-Only Optimized${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}\n"

# Check GPU status
echo -e "${YELLOW}📊 GPU Status:${NC}"
if command -v nvidia-smi &> /dev/null; then
    nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader
else
    echo "⚠️  nvidia-smi not found. Install NVIDIA GPU drivers."
fi

echo -e "\n${YELLOW}Available Training Commands:${NC}\n"

echo -e "${GREEN}1️⃣  Proctor Monitor Training (PyTorch + MobileNetV3):${NC}"
echo "   cd ml-training"
echo "   python train_proctor_model.py"
echo "   → Batch Size: 8, Workers: 0, Mixed Precision: Yes"
echo "   → Memory: ~2.3GB, Speed: ~1.8x faster (vs FP32)"
echo ""

echo -e "${GREEN}2️⃣  Drowsiness Detector (YOLO):${NC}"
echo "   cd ml-service/malpractices"
echo "   python train_drowsiness_detector.py"
echo "   → Batch Size: 8, Workers: 0, Mixed Precision: Yes"
echo "   → Memory: ~3-4GB, Epochs: 50"
echo ""

echo -e "${GREEN}3️⃣  Phone Detector (YOLO):${NC}"
echo "   cd ml-service/malpractices"
echo "   python train_phone_detector.py"
echo "   → Batch Size: 8, Workers: 0, Mixed Precision: Yes"
echo "   → Memory: ~3-4GB, Epochs: 50"
echo ""

echo -e "${YELLOW}⚡ Real-Time GPU Monitoring:${NC}"
echo "   # Open another terminal and run:"
echo "   watch -n 0.1 nvidia-smi"
echo "   # OR in PowerShell:"
echo "   while($true) { clear; nvidia-smi; sleep 0.1 }"
echo ""

echo -e "${YELLOW}🎯 Key Optimizations for RTX 3050:${NC}"
echo "   ✅ Batch Size: 8 (down from 16) - fits in 6GB VRAM"
echo "   ✅ Workers: 0 - no CPU overhead, pure GPU training"
echo "   ✅ Pin Memory: Enabled - faster GPU data transfer"
echo "   ✅ Mixed Precision: Enabled - 1.8x faster, 50% less memory"
echo "   ✅ CUDA Optimized: cuDNN benchmarking enabled"
echo ""

echo -e "${YELLOW}📈 Expected Performance:${NC}"
echo "   • GPU Utilization: 85-95%"
echo "   • CPU Usage: Minimal (< 5%)"
echo "   • Training Speed: ~1.8x faster (mixed precision)"
echo "   • Memory Usage: 2-4GB out of 6GB available"
echo ""

echo -e "${YELLOW}🔧 Troubleshooting:${NC}"
echo "   ❌ \"CUDA out of memory\":"
echo "      → Edit script and reduce batch_size to 4"
echo ""
echo "   ❌ Low GPU Utilization (< 50%):"
echo "      → Check: num_workers should be 0 ✓"
echo "      → Check: Mixed Precision (amp=True) enabled ✓"
echo "      → Close unnecessary applications"
echo ""
echo "   ❌ High CPU Usage:"
echo "      → Reduce background processes"
echo "      → Ensure num_workers=0 (already configured)"
echo ""

echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}\n"
