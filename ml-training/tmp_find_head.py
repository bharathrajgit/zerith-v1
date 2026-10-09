from pathlib import Path
p=Path('ml-training/data/raw')
matches=[]
for f in p.rglob('*'):
    if f.is_file():
        if 'head' in f.name.lower() or 'pose' in f.name.lower():
            matches.append(str(f.relative_to(p)))
            if len(matches)>=200:
                break
print('matches', len(matches))
for m in matches:
    print(m)
