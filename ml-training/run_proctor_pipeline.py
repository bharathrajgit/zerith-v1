import argparse
import subprocess
import sys
from pathlib import Path


def run_step(step_name, command, cwd):
    print(f'[{step_name}] {" ".join(command)}')
    subprocess.run(command, check=True, cwd=str(cwd))


def main():
    parser = argparse.ArgumentParser(
        description='Run proctor model pipeline: download -> prepare -> train -> export ONNX.'
    )
    parser.add_argument('--skip-download', action='store_true', help='Skip Kaggle dataset download step.')
    parser.add_argument('--skip-prepare', action='store_true', help='Skip dataset preparation step.')
    parser.add_argument('--skip-train', action='store_true', help='Skip model training step.')
    parser.add_argument('--skip-export', action='store_true', help='Skip ONNX export step.')
    args = parser.parse_args()

    base_dir = Path(__file__).resolve().parent
    python = sys.executable

    if not args.skip_download:
        run_step(
            'download',
            [python, str(base_dir / 'download_dataset.py')],
            base_dir.parent,
        )

    if not args.skip_prepare:
        run_step(
            'prepare',
            [python, str(base_dir / 'prepare_dataset.py')],
            base_dir.parent,
        )

    if not args.skip_train:
        run_step(
            'train',
            [python, str(base_dir / 'train_proctor_model.py')],
            base_dir.parent,
        )

    if not args.skip_export:
        run_step(
            'export',
            [python, str(base_dir / 'export_onnx.py')],
            base_dir.parent,
        )

    print('Proctor model pipeline completed.')


if __name__ == '__main__':
    main()
