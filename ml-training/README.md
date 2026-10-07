# Proctor Model Training

This directory contains the training scaffold for the webcam monitoring model used by the DSA platform.

## Goal

Train a lightweight proctoring classifier that can export to ONNX and support these session-level signals:

- `normal`
- `gaze_away`
- `head_pose_away`
- `multiple_faces`
- `face_missing`
- `phone_visible`
- `extra_screen_visible`

The runtime endpoint is `ml-service -> POST /ml/proctor/analyze-frame`.

## Dataset Strategy

This scaffold is intentionally configurable through `PROCTOR_KAGGLE_DATASETS` so the pipeline can blend multiple free webcam/proctoring datasets. `PROCTOR_KAGGLE_DATASET` is still accepted as a backward-compatible one-dataset fallback.

Recommended class layout after download/prep:

- `normal/`
- `gaze_away/`
- `head_pose_away/`
- `multiple_faces/`
- `face_missing/`
- `phone_visible/`
- `extra_screen_visible/`

The existing repo reference to `Mercor Cheating Detection` is still useful for session-level calibration, but the proctoring image model should be trained from a webcam-appropriate dataset with frame/image labels.

## Quick Start

1. Set environment variables:

```powershell
$env:KAGGLE_CONFIG_DIR="D:\VS Code Folder\dsa-platform\ml-training\.kaggle"
$env:PROCTOR_KAGGLE_DATASETS="raajanwankhade/oep-dataset,goatman1/head-pose-tracking,ardutraagiginting/exam-cheating-dataset"
$env:ML_TRAINING_DATA_DIR="D:\VS Code Folder\dsa-platform\ml-training\data\raw"
```

Place your Kaggle token at:

`$env:KAGGLE_CONFIG_DIR\kaggle.json`

Format:

```json
{"username":"<kaggle_username>","key":"<kaggle_api_key>"}
```

You can copy the template from:

`ml-training\.kaggle\kaggle.example.json`

Optional:

```powershell
$env:PROCTOR_CLASS_MAP="D:\VS Code Folder\dsa-platform\ml-training\class_map.proctor.json"
```

2. Download and unpack:

```powershell
python ml-training\download_dataset.py
python ml-training\prepare_dataset.py
```

3. Train:

```powershell
python ml-training\train_proctor_model.py
```

4. Export to ONNX for runtime:

```powershell
python ml-training\export_onnx.py
```

Single-command runner (optional):

```powershell
python ml-training\run_proctor_pipeline.py
```

5. Verify artifacts:

- `ml-training\artifacts\best_model.pt`
- `ml-training\artifacts\training_metrics.json`
- `ml-service\trained_models\proctor_monitor.onnx`
- `ml-service\trained_models\proctor_labels.json`
- `ml-service\trained_models\proctor_training_report.json`

## Threshold Defaults

These are the default runtime thresholds expected by the app:

- `multiple_faces` -> high risk, immediate warning candidate
- `head_pose_away` -> medium risk
- `gaze_away` -> medium risk
- `face_missing` -> medium risk
- `phone_visible` -> high risk, immediate warning candidate
- `extra_screen_visible` -> high risk, immediate warning candidate
- warning suggestion threshold -> `riskScore >= 0.45`

## Notes

- The runtime contract is fixed to the seven labels above, in that exact order.
- `download_dataset.py` now writes each Kaggle source into its own raw subdirectory and records a manifest.
- `prepare_dataset.py` defaults to `class_map.proctor.json` and can synthesize `multiple_faces`, `face_missing`, and `extra_screen_visible` if the raw datasets do not ship those folders directly.
- The current runtime endpoint supports fallback behavior when the ONNX file is not present yet.
- Heuristic fallback stays face-only; gadget classes are emitted only by an ONNX model.
- Raw video should not be persisted by default; only derived alerts and aggregated metadata are stored in app data.
