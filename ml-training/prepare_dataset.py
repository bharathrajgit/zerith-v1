import json
import os
import shutil
from pathlib import Path
from shutil import copy2

from PIL import Image, ImageDraw


CLASS_LABELS = [
    'normal',
    'gaze_away',
    'head_pose_away',
    'multiple_faces',
    'face_missing',
    'phone_visible',
    'extra_screen_visible',
]
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}
DEFAULT_SYNTHETIC_TARGETS = {
    'multiple_faces': 'multiple_faces',
    'face_missing': 'face_missing',
    'extra_screen_visible': 'extra_screen_visible',
    'phone_visible': 'phone_visible',
}

WINDOWS = os.name == 'nt'


def long_windows_path(path):
    path_str = str(path)
    if not WINDOWS:
        return path_str
    if path_str.startswith('\\\\?\\') or path_str.startswith('\\\\.\\'):
        return path_str
    if path_str.startswith('\\\\'):
        return '\\\\?\\UNC\\' + path_str.lstrip('\\')
    return '\\\\?\\' + path_str


def load_class_map(base_dir):
    default_map = base_dir / 'class_map.proctor.json'
    fallback_map = base_dir / 'class_map.example.json'
    class_map_path = Path(os.environ.get('PROCTOR_CLASS_MAP', default_map if default_map.exists() else fallback_map))
    with open(class_map_path, 'r', encoding='utf-8') as handle:
        return json.load(handle), class_map_path


def iter_images(directory):
    for root, _, files in os.walk(long_windows_path(directory)):
        for file_name in files:
            _, extension = os.path.splitext(file_name)
            if extension.lower() not in IMAGE_EXTS:
                continue
            yield Path(root) / file_name


def normalize_class_definition(value):
    if isinstance(value, dict):
        return {
            'aliases': [item for item in value.get('aliases', []) if item],
            'paths': [item for item in value.get('paths', []) if item],
        }
    return {
        'aliases': [item for item in value if item] if isinstance(value, list) else [],
        'paths': [],
    }


def merge_alias_maps(default_aliases, dataset_aliases):
    merged = {}
    for canonical in CLASS_LABELS:
        default_definition = normalize_class_definition(default_aliases.get(canonical, []))
        dataset_definition = normalize_class_definition(dataset_aliases.get(canonical, []))

        merged[canonical] = {
            'aliases': list(dict.fromkeys([
                canonical,
                *default_definition['aliases'],
                *dataset_definition['aliases'],
            ])),
            'paths': list(dict.fromkeys([
                *default_definition['paths'],
                *dataset_definition['paths'],
            ])),
        }
    return merged


def load_manifest(raw_dir):
    manifest_path = raw_dir / 'download_manifest.json'
    if not manifest_path.exists():
        return {}

    with open(manifest_path, 'r', encoding='utf-8') as handle:
        payload = json.load(handle)

    return {
        item['slug']: item['folder']
        for item in payload.get('datasets', [])
        if item.get('slug') and item.get('folder')
    }


def get_dataset_definitions(raw_dir, class_map):
    manifest = load_manifest(raw_dir)
    if isinstance(class_map, dict) and 'datasets' in class_map:
        default_aliases = class_map.get('defaults', {}) or class_map.get('defaultAliases', {})
        synthetic = class_map.get('synthetic', {})
        datasets = []

        for entry in class_map.get('datasets', []):
            folder = entry.get('folder') or manifest.get(entry.get('slug', ''), '')
            if not folder:
                continue

            datasets.append({
                'slug': entry.get('slug', ''),
                'folder': folder,
                'root': raw_dir / folder,
                'aliases': merge_alias_maps(default_aliases, entry.get('aliases', {})),
            })

        return datasets, synthetic

    datasets = []
    for source_dir in raw_dir.iterdir():
        if source_dir.is_dir():
            datasets.append({
                'slug': source_dir.name,
                'folder': source_dir.name,
                'root': source_dir,
                'aliases': merge_alias_maps(class_map, {}),
            })

    return datasets, {}


def find_matching_directories(dataset_root, class_definition):
    matched = []
    seen = set()

    for relative_path in class_definition['paths']:
        candidate = dataset_root / relative_path
        if candidate.is_dir():
            resolved = candidate.resolve()
            if resolved not in seen:
                matched.append(candidate)
                seen.add(resolved)

    alias_pool = {item.strip().lower() for item in class_definition['aliases'] if item}
    if not alias_pool:
        return matched

    for candidate in dataset_root.rglob('*'):
        if not candidate.is_dir():
            continue
        if candidate.name.strip().lower() not in alias_pool:
            continue
        resolved = candidate.resolve()
        if resolved in seen:
            continue
        matched.append(candidate)
        seen.add(resolved)

    return matched


def copy_dataset_images(dataset_definitions, prepared_dir):
    copied = 0
    class_counts = {label: 0 for label in CLASS_LABELS}

    for dataset in dataset_definitions:
        if not dataset['root'].exists():
            print('Skipping missing dataset root:', dataset['root'])
            continue

        print('Preparing dataset source:', dataset['folder'])
        
        # Special handling for Mobile_image dataset with flat structure
        if dataset['folder'] == 'Mobile_image':
            target_dir = prepared_dir / 'phone_visible'
            target_dir.mkdir(parents=True, exist_ok=True)
            
            for image_path in iter_images(dataset['root']):
                destination = target_dir / f'{dataset["folder"]}_{copied:05d}{image_path.suffix.lower()}'
                copy2(str(image_path), str(destination))
                copied += 1
                class_counts['phone_visible'] += 1
            continue
        
        # Special handling for Metahuman_tracking_1 dataset with flat structure
        if dataset['folder'] == 'Metahuman_tracking_1':
            # Distribute images between head_pose_away and gaze_away
            target_dir_head = prepared_dir / 'head_pose_away'
            target_dir_gaze = prepared_dir / 'gaze_away'
            target_dir_head.mkdir(parents=True, exist_ok=True)
            target_dir_gaze.mkdir(parents=True, exist_ok=True)
            
            image_list = list(iter_images(dataset['root']))
            for idx, image_path in enumerate(image_list):
                # Alternate between head_pose_away and gaze_away
                if idx % 2 == 0:
                    target_dir = target_dir_head
                    class_label = 'head_pose_away'
                else:
                    target_dir = target_dir_gaze
                    class_label = 'gaze_away'
                
                destination = target_dir / f'{dataset["folder"]}_{copied:05d}{image_path.suffix.lower()}'
                copy2(str(image_path), str(destination))
                copied += 1
                class_counts[class_label] += 1
            continue
        
        for canonical in CLASS_LABELS:
            target_dir = prepared_dir / canonical
            target_dir.mkdir(parents=True, exist_ok=True)

            matched_dirs = find_matching_directories(dataset['root'], dataset['aliases'][canonical])
            for source_dir in matched_dirs:
                for image_path in iter_images(source_dir):
                    destination = target_dir / f'{dataset["folder"]}_{copied:05d}{image_path.suffix.lower()}'
                    copy2(str(image_path), str(destination))
                    copied += 1
                    class_counts[canonical] += 1

    return copied, class_counts


def desired_synthetic_count(reference_count):
    return min(max(reference_count // 2, 12), 100)


def load_rgb_image(image_path):
    with Image.open(image_path) as image:
        return image.convert('RGB')


def build_multiple_faces_image(base_image, donor_image):
    canvas = base_image.copy()
    width, height = canvas.size
    overlay_size = max(48, min(width, height) // 3)
    donor_crop = donor_image.resize((overlay_size, overlay_size))
    offset_x = max(8, width - overlay_size - 12)
    offset_y = max(8, height // 8)
    canvas.paste(donor_crop, (offset_x, offset_y))

    border = ImageDraw.Draw(canvas)
    border.rectangle(
        [offset_x - 2, offset_y - 2, offset_x + overlay_size + 2, offset_y + overlay_size + 2],
        outline=(248, 250, 252),
        width=2,
    )
    return canvas


def build_face_missing_image(base_image):
    canvas = base_image.copy()
    width, height = canvas.size
    mask_width = max(64, width // 3)
    mask_height = max(64, height // 3)
    left = (width - mask_width) // 2
    top = max(12, (height - mask_height) // 3)

    overlay = ImageDraw.Draw(canvas)
    overlay.rounded_rectangle(
        [left, top, left + mask_width, top + mask_height],
        radius=14,
        fill=(32, 41, 58),
    )
    return canvas


def build_extra_screen_image(base_image):
    canvas = base_image.copy()
    width, height = canvas.size
    screen_width = max(72, width // 4)
    screen_height = max(96, int(height * 0.72))
    left = max(10, width - screen_width - 16)
    top = max(12, (height - screen_height) // 2)

    overlay = ImageDraw.Draw(canvas)
    overlay.rounded_rectangle(
        [left, top, left + screen_width, top + screen_height],
        radius=12,
        fill=(17, 24, 39),
        outline=(148, 163, 184),
        width=3,
    )
    overlay.rectangle(
        [left + 10, top + 12, left + screen_width - 10, top + screen_height - 18],
        fill=(56, 189, 248),
    )
    return canvas


def build_phone_image(base_image):
    canvas = base_image.copy()
    width, height = canvas.size
    phone_width = max(40, width // 6)
    phone_height = max(80, int(phone_width * 2))
    left = max(10, width - phone_width - 20)
    top = max(20, height // 3)

    overlay = ImageDraw.Draw(canvas)
    # Phone body
    overlay.rounded_rectangle(
        [left, top, left + phone_width, top + phone_height],
        radius=8,
        fill=(30, 41, 59),
        outline=(100, 116, 139),
        width=2,
    )
    # Phone screen
    screen_margin = 4
    overlay.rounded_rectangle(
        [left + screen_margin, top + screen_margin, left + phone_width - screen_margin, top + phone_height - screen_margin],
        radius=4,
        fill=(56, 189, 248),
    )
    # Phone button/camera
    button_size = 6
    overlay.ellipse(
        [left + phone_width // 2 - button_size // 2, top + phone_height - 15, 
         left + phone_width // 2 + button_size // 2, top + phone_height - 9],
        fill=(148, 163, 184),
    )
    return canvas


def build_synthetic_image(strategy, base_image, donor_image):
    if strategy == 'multiple_faces':
        return build_multiple_faces_image(base_image, donor_image)
    if strategy == 'face_missing':
        return build_face_missing_image(base_image)
    if strategy == 'extra_screen_visible':
        return build_extra_screen_image(base_image)
    if strategy == 'phone_visible':
        return build_phone_image(base_image)
    raise ValueError(f'Unsupported synthetic strategy: {strategy}')


def generate_synthetic_classes(prepared_dir, synthetic_config):
    generated_counts = {label: 0 for label in CLASS_LABELS}
    strategy_map = synthetic_config.get('targets', DEFAULT_SYNTHETIC_TARGETS)
    reference_labels = synthetic_config.get(
        'referenceLabels',
        ['normal', 'gaze_away', 'head_pose_away', 'phone_visible'],
    )
    reference_images = [
        image_path
        for label in reference_labels
        for image_path in sorted((prepared_dir / label).glob('*'))
        if image_path.is_file() and image_path.suffix.lower() in IMAGE_EXTS
    ]

    if not reference_images:
        return generated_counts

    target_count = desired_synthetic_count(len(reference_images))
    for target_label, strategy in strategy_map.items():
        target_dir = prepared_dir / target_label
        existing_images = [
            image_path for image_path in sorted(target_dir.glob('*'))
            if image_path.is_file() and image_path.suffix.lower() in IMAGE_EXTS
        ]
        needed = max(0, target_count - len(existing_images))
        if needed == 0:
            continue

        for index in range(needed):
            base_path = reference_images[index % len(reference_images)]
            donor_path = reference_images[(index + 1) % len(reference_images)]
            synthetic = build_synthetic_image(
                strategy,
                load_rgb_image(base_path),
                load_rgb_image(donor_path),
            )
            destination = target_dir / f'synthetic_{strategy}_{index:04d}.jpg'
            synthetic.save(destination, quality=92)
            generated_counts[target_label] += 1

    return generated_counts


def build_report(prepared_dir, class_map_path, copied_counts, generated_counts):
    final_counts = {
        label: len([
            path for path in (prepared_dir / label).glob('*')
            if path.is_file() and path.suffix.lower() in IMAGE_EXTS
        ])
        for label in CLASS_LABELS
    }

    return {
        'class_map': str(class_map_path),
        'copied_counts': copied_counts,
        'generated_counts': generated_counts,
        'final_counts': final_counts,
    }


def main():
    base_dir = Path(__file__).resolve().parent
    raw_dir = Path(os.environ.get('ML_TRAINING_DATA_DIR', base_dir / 'data' / 'raw'))
    prepared_dir = base_dir / 'data' / 'prepared'
    class_map, class_map_path = load_class_map(base_dir)

    if not raw_dir.exists():
        raise SystemExit(f'Raw dataset directory not found: {raw_dir}')

    if prepared_dir.exists():
        shutil.rmtree(prepared_dir)
    prepared_dir.mkdir(parents=True, exist_ok=True)

    dataset_definitions, synthetic_config = get_dataset_definitions(raw_dir, class_map)
    for canonical in CLASS_LABELS:
        (prepared_dir / canonical).mkdir(parents=True, exist_ok=True)

    copied, copied_counts = copy_dataset_images(dataset_definitions, prepared_dir)
    generated_counts = generate_synthetic_classes(prepared_dir, synthetic_config)
    report = build_report(prepared_dir, class_map_path, copied_counts, generated_counts)

    missing = [label for label, count in report['final_counts'].items() if count == 0]
    report_path = prepared_dir / 'preparation_report.json'
    with open(report_path, 'w', encoding='utf-8') as handle:
        json.dump(report, handle, indent=2)

    print('Prepared dataset at:', prepared_dir)
    print('Total copied images:', copied)
    print('Synthetic images generated:', sum(generated_counts.values()))
    print('Preparation report:', report_path)

    if missing:
        raise SystemExit(
            f'Prepared dataset is still missing required classes: {", ".join(missing)}. '
            'Review class_map.proctor.json or add more raw source data.'
        )


if __name__ == '__main__':
    main()