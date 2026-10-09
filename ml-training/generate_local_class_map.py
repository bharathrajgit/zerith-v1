import json
import os
from pathlib import Path

CANONICAL = [
    'normal',
    'gaze_away',
    'head_pose_away',
    'multiple_faces',
    'face_missing',
    'phone_visible',
    'extra_screen_visible',
]

KEYWORDS = {
    'normal': ['normal', 'focused', 'act', 'attentive', 'single_face', 'student'],
    'gaze_away': ['look', 'gaze', 'looking', 'friend', 'away', 'eye'],
    'head_pose_away': ['head', 'pose', 'turned', 'turned_head', 'left', 'right', 'up', 'down'],
    'multiple_faces': ['multiple', 'two', 'multi', 'people', 'group'],
    'face_missing': ['no_face', 'missing', 'no-face', 'noface', 'mask'],
    'phone_visible': ['phone', 'mobile', 'giving', 'device'],
    'extra_screen_visible': ['screen', 'monitor', 'second', 'extra'],
}


def guess_label_for_name(name):
    n = name.lower()
    for label, kws in KEYWORDS.items():
        for kw in kws:
            if kw in n:
                return label
    return 'normal'


def build_dataset_entry(folder_path: Path, defaults):
    aliases = {c: {'aliases': [], 'paths': []} for c in CANONICAL}
    # list subdirectories and use names as aliases
    if folder_path.exists() and folder_path.is_dir():
        # include nested directory names so class folders inside 'train/' are discovered
        for entry in folder_path.rglob('*'):
            if not entry.is_dir():
                continue
            name = entry.name
            guessed = guess_label_for_name(name)
            if name not in aliases[guessed]['aliases']:
                aliases[guessed]['aliases'].append(name)
    # fallback: if nothing found, leave empty so defaults apply
    return aliases


def main():
    base_dir = Path(__file__).resolve().parent
    raw_dir = base_dir / 'data' / 'raw'
    # load defaults from existing class_map.proctor.json
    with open(base_dir / 'class_map.proctor.json', 'r', encoding='utf-8') as f:
        existing = json.load(f)
    defaults = existing.get('defaults', {})

    datasets = []
    for item in raw_dir.iterdir():
        if not item.is_dir():
            continue
        entry = {
            'slug': item.name,
            'folder': item.name,
            'aliases': build_dataset_entry(item, defaults),
        }
        datasets.append(entry)

    out = {
        'defaults': defaults,
        'datasets': datasets,
        'synthetic': existing.get('synthetic', {}),
    }

    out_path = base_dir / 'class_map.auto.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2)
    print('Wrote', out_path)


if __name__ == '__main__':
    main()
