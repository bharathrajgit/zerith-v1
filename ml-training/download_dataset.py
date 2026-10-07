import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def get_dataset_slugs():
    multi_value = os.environ.get('PROCTOR_KAGGLE_DATASETS', '')
    single_value = os.environ.get('PROCTOR_KAGGLE_DATASET', '')

    candidates = []
    if multi_value.strip():
        candidates.extend(item.strip() for item in multi_value.split(','))
    if single_value.strip():
        candidates.append(single_value.strip())

    unique = []
    seen = set()
    for slug in candidates:
        normalized = slug.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique.append(normalized)

    if not unique:
        class_map_path = Path(__file__).resolve().parent / 'class_map.proctor.json'
        if class_map_path.exists():
            try:
                with open(class_map_path, 'r', encoding='utf-8') as handle:
                    payload = json.load(handle)
                for dataset in payload.get('datasets', []):
                    slug = str(dataset.get('slug', '')).strip()
                    if slug and slug not in seen:
                        seen.add(slug)
                        unique.append(slug)
            except Exception:
                pass

    if not unique:
        raise SystemExit(
            'No Kaggle dataset slugs found. '
            'Set PROCTOR_KAGGLE_DATASETS / PROCTOR_KAGGLE_DATASET or define datasets in class_map.proctor.json.'
        )

    return unique


def slug_to_folder(slug):
    owner, _, dataset = slug.partition('/')
    owner = owner.strip().lower().replace(' ', '_')
    dataset = dataset.strip().lower().replace(' ', '_')
    return f'{owner}__{dataset}'


def resolve_kaggle_config_dir(base_dir):
    configured = os.environ.get('KAGGLE_CONFIG_DIR', '').strip()
    target = Path(configured) if configured else (base_dir / '.kaggle')
    target.mkdir(parents=True, exist_ok=True)
    os.environ['KAGGLE_CONFIG_DIR'] = str(target)
    return target


def has_kaggle_credentials(config_dir):
    if os.environ.get('KAGGLE_USERNAME') and os.environ.get('KAGGLE_KEY'):
        return True

    config_file = config_dir / 'kaggle.json'
    if not config_file.exists():
        return False

    try:
        # Accept UTF-8 files written by Windows tools that may prepend a BOM.
        with open(config_file, 'r', encoding='utf-8-sig') as handle:
            payload = json.load(handle)
    except Exception:
        return False

    return bool(payload.get('username') and payload.get('key'))


def build_kaggle_command(dataset_slug, target_dir):
    kaggle_cli = shutil.which('kaggle')
    if kaggle_cli:
        return [
            kaggle_cli,
            'datasets',
            'download',
            '-d',
            dataset_slug,
            '-p',
            str(target_dir),
            '--unzip',
        ]

    # Fallback when the kaggle executable script is not on PATH.
    return [
        sys.executable,
        '-m',
        'kaggle.cli',
        'datasets',
        'download',
        '-d',
        dataset_slug,
        '-p',
        str(target_dir),
        '--unzip',
    ]


def main():
    base_dir = Path(__file__).resolve().parent
    dataset_slugs = get_dataset_slugs()
    data_dir = Path(
        os.environ.get(
            'ML_TRAINING_DATA_DIR',
            base_dir / 'data' / 'raw',
        )
    )
    data_dir.mkdir(parents=True, exist_ok=True)

    kaggle_config_dir = resolve_kaggle_config_dir(base_dir)

    if not has_kaggle_credentials(kaggle_config_dir):
        token_path = kaggle_config_dir / 'kaggle.json'
        raise SystemExit(
            'Kaggle credentials are missing. '
            f'Place kaggle.json at "{token_path}" '
            'or set KAGGLE_USERNAME and KAGGLE_KEY before running this script.'
        )

    kaggle_cli_available = shutil.which('kaggle') is not None
    if not kaggle_cli_available:
        # Ensure the python module entry point exists when PATH script is unavailable.
        try:
            __import__('kaggle')
        except Exception as exc:
            raise SystemExit(
                'Kaggle CLI is not available. Install it with `python -m pip install kaggle`.'
            ) from exc

    manifest = []
    for dataset_slug in dataset_slugs:
        target_dir = data_dir / slug_to_folder(dataset_slug)
        if target_dir.exists():
            shutil.rmtree(target_dir)
        target_dir.mkdir(parents=True, exist_ok=True)

        command = build_kaggle_command(dataset_slug, target_dir)
        command_env = {
            **os.environ,
            'KAGGLE_CONFIG_DIR': str(kaggle_config_dir),
        }

        print('Downloading dataset:', dataset_slug)
        subprocess.run(command, check=True, env=command_env)
        manifest.append({
            'slug': dataset_slug,
            'folder': target_dir.name,
            'path': str(target_dir),
        })

    manifest_path = data_dir / 'download_manifest.json'
    with open(manifest_path, 'w', encoding='utf-8') as handle:
        json.dump({'datasets': manifest}, handle, indent=2)

    print('Kaggle config directory:', kaggle_config_dir)
    print('Datasets ready at:', data_dir)
    print('Download manifest written to:', manifest_path)


if __name__ == '__main__':
    main()
