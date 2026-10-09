import onnxruntime as ort
import traceback
from pathlib import Path
p = Path(__file__).resolve().parent / 'trained_models' / 'proctor_monitor.onnx'
print('model path:', p)
try:
    s = ort.InferenceSession(str(p), providers=['CPUExecutionProvider'])
    print('loaded session:', s)
except Exception as e:
    print('ERR', e)
    traceback.print_exc()
