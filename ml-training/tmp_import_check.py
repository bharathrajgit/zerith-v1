import importlib.util
pkgs = ['torch', 'torchvision', 'onnx', 'onnxruntime', 'numpy', 'PIL', 'sklearn']
for p in pkgs:
    spec = importlib.util.find_spec(p)
    print(p + ': ' + ('OK' if spec else 'MISSING'))
