import json
import os
from pathlib import Path

try:
    import torch
    from torch import nn
    from torchvision import models
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        'PyTorch dependencies are required for export. Install ml-training/requirements.txt first.'
    ) from exc

# Force legacy ONNX exporter for better compatibility
os.environ['PYTORCH_ONNX_EXPORTER'] = 'legacy'


def main():
    base_dir = Path(__file__).resolve().parent
    artifacts_dir = base_dir / 'artifacts'
    checkpoint_path = artifacts_dir / 'best_model.pt'
    metrics_path = artifacts_dir / 'training_metrics.json'
    if not checkpoint_path.exists():
        raise SystemExit('Checkpoint not found. Run train_proctor_model.py first.')

    payload = torch.load(checkpoint_path, map_location='cpu')
    classes = payload.get('classes', [])
    expected_labels = payload.get('expected_labels', classes)

    model = models.mobilenet_v3_small(weights=None)
    model.classifier[3] = nn.Linear(model.classifier[3].in_features, len(classes))
    model.load_state_dict(payload['state_dict'])
    model.eval()

    dummy = torch.randn(1, 3, 224, 224)
    output_dir = base_dir.parent / 'ml-service' / 'trained_models'
    output_dir.mkdir(parents=True, exist_ok=True)
    onnx_path = output_dir / 'proctor_monitor.onnx'

    torch.onnx.export(
        model,
        dummy,
        onnx_path,
        input_names=['image'],
        output_names=['logits'],
        opset_version=12,
        export_params=True,
        do_constant_folding=True,
        verbose=False,
    )

    with open(output_dir / 'proctor_labels.json', 'w', encoding='utf-8') as handle:
        json.dump({'labels': expected_labels, 'sourceClasses': classes}, handle, indent=2)

    if metrics_path.exists():
        with open(metrics_path, 'r', encoding='utf-8') as handle:
            metrics = json.load(handle)
        metrics['onnx_export_path'] = 'ml-service/trained_models/proctor_monitor.onnx'
        with open(output_dir / 'proctor_training_report.json', 'w', encoding='utf-8') as handle:
            json.dump(metrics, handle, indent=2)

    print('Exported ONNX model to', onnx_path)


if __name__ == '__main__':
    main()
