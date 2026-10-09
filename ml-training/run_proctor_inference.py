import sys
import json
import base64
from pathlib import Path
from io import BytesIO
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'ml-service'))
from models.proctor_monitor import ProctorMonitor

# Pick a sample image from prepared/phone_visible to test phone detection
prepared_dir = Path(__file__).resolve().parent / 'data' / 'prepared'
img_dir = prepared_dir / 'phone_visible'
imgs = sorted(p for p in img_dir.iterdir() if p.is_file())
if not imgs:
    raise SystemExit('No sample images found in ' + str(img_dir))

sample = imgs[0]
# load and encode as data URI
with Image.open(sample) as im:
    im = im.convert('RGB')
    buf = BytesIO()
    im.save(buf, format='JPEG')
    b = base64.b64encode(buf.getvalue()).decode('ascii')
    data_uri = 'data:image/jpeg;base64,' + b

monitor = ProctorMonitor()
result = monitor.analyze_frame(data_uri, metadata={'deviceType': 'test-script'})
print(json.dumps(result, indent=2))
