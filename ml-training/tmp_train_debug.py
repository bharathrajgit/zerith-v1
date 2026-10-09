import traceback
import runpy

try:
    runpy.run_path('ml-training/train_proctor_model.py', run_name='__main__')
except Exception:
    traceback.print_exc()
    raise
