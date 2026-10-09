#!/usr/bin/env python
"""
Quick CUDA verification script for RTX 3050
Run this after PyTorch installation completes
"""
import sys

try:
    import torch
    print("\n" + "="*60)
    print("CUDA Verification")
    print("="*60)
    cuda_available = torch.cuda.is_available()
    print(f"CUDA Available: {cuda_available}")
    
    if cuda_available:
        print(f"Device Name: {torch.cuda.get_device_name(0)}")
        print(f"CUDA Version: {torch.version.cuda}")
        print(f"cuDNN Version: {torch.backends.cudnn.version()}")
        props = torch.cuda.get_device_properties(0)
        print(f"GPU Memory: {props.total_memory / 1e9:.1f} GB")
        print(f"Compute Capability: {props.major}.{props.minor}")
        print("\nStatus: SUCCESS - GPU is ready for training!")
        print("="*60 + "\n")
        sys.exit(0)
    else:
        print("Status: FAILED - CUDA not detected")
        print("Try: pip install -U torch --index-url https://download.pytorch.org/whl/cu118")
        print("="*60 + "\n")
        sys.exit(1)
        
except ImportError as e:
    print(f"Error: {e}")
    print("PyTorch not installed yet. Wait for pip install to complete.")
    sys.exit(1)
