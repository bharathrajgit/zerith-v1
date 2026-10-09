from pathlib import Path
import os
p = Path(r'd:\VS Code Folder\dsa-platform\ml-training\data\raw\HeadPoseDataset\HeadPoseDataset')
print('root', p, 'exists', p.exists(), 'is_dir', p.is_dir())
files = sorted(os.listdir(p))
print('files count', len(files))
for f in files[:20]:
    fp = p / f
    print('repr', repr(f))
    print('exists', fp.exists(), 'is_file', fp.is_file(), 'suffix', fp.suffix, 'size', fp.stat().st_size if fp.exists() else 'NA')
    with fp.open('rb') as fh:
        hdr = fh.read(16)
    print('hdr', hdr[:16])
    print('---')
