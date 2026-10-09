from pathlib import Path
import os
p = Path(r'd:\VS Code Folder\dsa-platform\ml-training\data\raw\HeadPoseDataset')
print('root', p, 'exists', p.exists(), 'is_dir', p.is_dir())
for root, dirs, files in os.walk(p):
    print('DIR', root)
    print('  dirs', dirs)
    print('  file count', len(files))
    for f in files[:50]:
        fp = Path(root) / f
        print('   ', f, 'suffix=', Path(f).suffix, 'size=', fp.stat().st_size)
    print('---')
