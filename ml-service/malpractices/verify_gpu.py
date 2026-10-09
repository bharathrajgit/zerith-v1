# verify_gpu.py
import torch

print("=" * 50)
print("GPU/CUDA VERIFICATION")
print("=" * 50)

print(f"\nPyTorch version: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
print(f"CUDA version: {torch.version.cuda}")

if torch.cuda.is_available():
    print(f"\nGPU Device: {torch.cuda.get_device_name(0)}")
    print(f"GPU Count: {torch.cuda.device_count()}")
    print(f"Current Device: {torch.cuda.current_device()}")
    print(f"VRAM Total: {torch.cuda.get_device_properties(0).total_memory / 1e9:.2f} GB")
    print(f"VRAM Allocated: {torch.cuda.memory_allocated(0) / 1e9:.2f} GB")
    print(f"VRAM Reserved: {torch.cuda.memory_reserved(0) / 1e9:.2f} GB")
    
    # Test GPU computation
    print("\nTesting GPU computation...")
    x = torch.randn(1000, 1000).cuda()
    y = torch.randn(1000, 1000).cuda()
    z = torch.matmul(x, y)
    print("GPU computation test: PASSED")
    print(f"Result device: {z.device}")
else:
    print("\nERROR: CUDA is NOT available!")
    print("GPU will NOT be used for training.")

print("\n" + "=" * 50)
