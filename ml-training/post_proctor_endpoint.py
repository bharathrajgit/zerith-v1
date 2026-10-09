import sys
import json
import base64
from pathlib import Path
from io import BytesIO
from PIL import Image
import requests

# endpoint
url = 'http://127.0.0.1:8000/ml/proctor/analyze-frame'

prepared_dir = Path(__file__).resolve().parent / 'data' / 'prepared'
img_dir = prepared_dir / 'normal'
imgs = sorted(p for p in img_dir.iterdir() if p.is_file())
if not imgs:
    raise SystemExit('No sample images in ' + str(img_dir))

sample = imgs[0]
with Image.open(sample) as im:
    im = im.convert('RGB')
    buf = BytesIO()
    im.save(buf, format='JPEG')
    b = base64.b64encode(buf.getvalue()).decode('ascii')
    data_uri = 'data:image/jpeg;base64,' + b

payload = {'imageData': data_uri, 'metadata': {'deviceType': 'test-endpoint'}}
resp = requests.post(url, json=payload, timeout=30)
print('status', resp.status_code)
try:
    print(json.dumps(resp.json(), indent=2))
except Exception:
    print(resp.text)
