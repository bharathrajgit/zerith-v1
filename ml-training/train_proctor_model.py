import json
import os
from collections import Counter
from pathlib import Path

try:
    import torch
    from sklearn.metrics import accuracy_score, classification_report
    from torch import nn, optim
    from torch.cuda.amp import autocast, GradScaler
    from torch.utils.data import DataLoader, Subset, WeightedRandomSampler
    from torchvision import datasets, models, transforms
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        'PyTorch dependencies are required for training. Install ml-training/requirements.txt first.'
    ) from exc

# Import GPU configuration for RTX 3050 optimization
from gpu_config import configure_gpu_for_rtx_3050


CLASS_LABELS = [
    'normal',
    'gaze_away',
    'head_pose_away',
    'multiple_faces',
    'face_missing',
    'phone_visible',
    'extra_screen_visible',
]
RANDOM_SEED = 42


def get_dataset_slugs():
    multi_value = os.environ.get('PROCTOR_KAGGLE_DATASETS', '')
    single_value = os.environ.get('PROCTOR_KAGGLE_DATASET', '')

    slugs = []
    if multi_value.strip():
        slugs.extend(item.strip() for item in multi_value.split(','))
    if single_value.strip():
        slugs.append(single_value.strip())

    unique = []
    seen = set()
    for slug in slugs:
        normalized = slug.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique.append(normalized)
    return unique


class OrderedImageFolder(datasets.ImageFolder):
    def find_classes(self, directory):
        available = {
            entry.name: entry.path
            for entry in os.scandir(directory)
            if entry.is_dir()
        }
        missing = [label for label in CLASS_LABELS if label not in available]
        if missing:
            raise FileNotFoundError(
                f'Missing prepared class folders: {", ".join(missing)}'
            )

        return list(CLASS_LABELS), {label: index for index, label in enumerate(CLASS_LABELS)}


def build_datasets(prepared_dir):
    base_dataset = OrderedImageFolder(prepared_dir)
    if len(base_dataset) == 0:
        raise SystemExit('Prepared dataset is empty. Run prepare_dataset.py first.')

    eval_transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])
    train_transform = transforms.Compose([
        transforms.RandomResizedCrop(224, scale=(0.82, 1.0)),
        transforms.RandomHorizontalFlip(p=0.5),
        transforms.ColorJitter(brightness=0.16, contrast=0.16, saturation=0.12, hue=0.03),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    generator = torch.Generator().manual_seed(RANDOM_SEED)
    indices = torch.randperm(len(base_dataset), generator=generator).tolist()
    val_size = max(1, int(len(base_dataset) * 0.2))
    train_size = len(base_dataset) - val_size
    if train_size <= 0:
        raise SystemExit('Need at least two prepared images to create train/validation splits.')

    val_indices = indices[:val_size]
    train_indices = indices[val_size:]

    train_dataset = Subset(OrderedImageFolder(prepared_dir, transform=train_transform), train_indices)
    val_dataset = Subset(OrderedImageFolder(prepared_dir, transform=eval_transform), val_indices)
    return base_dataset, train_dataset, val_dataset, train_indices, val_indices


def build_training_sampler(base_dataset, train_indices):
    train_targets = [base_dataset.targets[index] for index in train_indices]
    class_counts = Counter(train_targets)
    sample_weights = [1.0 / max(class_counts[label], 1) for label in train_targets]
    sampler = WeightedRandomSampler(
        weights=torch.as_tensor(sample_weights, dtype=torch.double),
        num_samples=len(sample_weights),
        replacement=True,
    )
    class_weights = [
        len(train_targets) / max(len(CLASS_LABELS) * class_counts.get(index, 0), 1)
        for index in range(len(CLASS_LABELS))
    ]
    return sampler, class_counts, torch.tensor(class_weights, dtype=torch.float32)


def evaluate_model(model, dataloader, device):
    predictions = []
    targets = []

    model.eval()
    with torch.no_grad():
        for images, labels in dataloader:
            images = images.to(device)
            labels = labels.to(device)
            logits = model(images)
            batch_predictions = torch.argmax(logits, dim=1)
            predictions.extend(batch_predictions.cpu().tolist())
            targets.extend(labels.cpu().tolist())

    report = classification_report(
        targets,
        predictions,
        labels=list(range(len(CLASS_LABELS))),
        target_names=CLASS_LABELS,
        output_dict=True,
        zero_division=0,
    )
    accuracy = accuracy_score(targets, predictions) if targets else 0.0
    macro_f1 = report.get('macro avg', {}).get('f1-score', 0.0)

    return {
        'accuracy': float(accuracy),
        'macro_f1': float(macro_f1),
        'report': report,
    }


def build_metrics_payload(
    base_dataset,
    train_indices,
    val_indices,
    class_counts,
    best_metrics,
    checkpoint_path,
    dataset_slugs,
):
    dataset_counts = Counter(base_dataset.targets)
    report = best_metrics['report']

    return {
        'model_name': 'proctor_monitor',
        'dataset_slug': dataset_slugs[0] if dataset_slugs else '',
        'dataset_slugs': dataset_slugs,
        'class_labels': CLASS_LABELS,
        'dataset_class_distribution': {
            CLASS_LABELS[index]: int(dataset_counts.get(index, 0))
            for index in range(len(CLASS_LABELS))
        },
        'train_class_distribution': {
            CLASS_LABELS[index]: int(class_counts.get(index, 0))
            for index in range(len(CLASS_LABELS))
        },
        'train_size': int(len(train_indices)),
        'validation_size': int(len(val_indices)),
        'validation_accuracy': round(float(best_metrics['accuracy']), 4),
        'macro_f1': round(float(best_metrics['macro_f1']), 4),
        'per_class_precision': {
            label: round(float(report[label]['precision']), 4)
            for label in CLASS_LABELS
        },
        'per_class_recall': {
            label: round(float(report[label]['recall']), 4)
            for label in CLASS_LABELS
        },
        'per_class_f1': {
            label: round(float(report[label]['f1-score']), 4)
            for label in CLASS_LABELS
        },
        'confusion_matrix_path': '',
        'checkpoint_path': str(checkpoint_path),
        'onnx_export_path': 'ml-service/trained_models/proctor_monitor.onnx',
        'notes': 'Weighted sampler and weighted loss enabled; heuristic runtime remains face-only when no ONNX model is loaded.',
    }


def main():
    # ✅ Configure GPU for RTX 3050 optimization
    configure_gpu_for_rtx_3050()
    
    base_dir = Path(__file__).resolve().parent
    prepared_dir = base_dir / 'data' / 'prepared'
    artifacts_dir = base_dir / 'artifacts'
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    dataset_slugs = get_dataset_slugs()

    torch.manual_seed(RANDOM_SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(RANDOM_SEED)

    base_dataset, train_dataset, val_dataset, train_indices, val_indices = build_datasets(prepared_dir)
    sampler, train_class_counts, class_weights = build_training_sampler(base_dataset, train_indices)

    # RTX 3050 optimized: batch_size=8 (reduced from 16), num_workers=0 (no CPU overhead), pin_memory=True (GPU-optimized)
    train_loader = DataLoader(
        train_dataset,
        batch_size=8,
        sampler=sampler,
        num_workers=0,
        pin_memory=True,
        drop_last=False,
    )
    val_loader = DataLoader(
        val_dataset,
        batch_size=8,
        shuffle=False,
        num_workers=0,
        pin_memory=True,
    )

    model = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.DEFAULT)
    model.classifier[3] = nn.Linear(model.classifier[3].in_features, len(CLASS_LABELS))

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model.to(device)

    criterion = nn.CrossEntropyLoss(weight=class_weights.to(device))
    optimizer = optim.Adam(model.parameters(), lr=1e-4)
    epochs = int(os.environ.get('PROCTOR_TRAIN_EPOCHS', '5'))

    checkpoint_path = artifacts_dir / 'best_model.pt'
    metrics_path = artifacts_dir / 'training_metrics.json'
    best_score = -1.0
    best_metrics = None

    # Mixed precision training for RTX 3050 (faster + less memory)
    scaler = GradScaler() if device.type == 'cuda' else None

    for epoch in range(epochs):
        model.train()
        running_loss = 0.0
        torch.cuda.empty_cache() if device.type == 'cuda' else None

        for images, labels in train_loader:
            images = images.to(device, non_blocking=True)
            labels = labels.to(device, non_blocking=True)

            optimizer.zero_grad()
            
            # Mixed precision training for GPU efficiency
            if scaler is not None:
                with autocast():
                    logits = model(images)
                    loss = criterion(logits, labels)
                scaler.scale(loss).backward()
                scaler.step(optimizer)
                scaler.update()
            else:
                logits = model(images)
                loss = criterion(logits, labels)
                loss.backward()
                optimizer.step()

            running_loss += float(loss.item()) * labels.size(0)

        evaluation = evaluate_model(model, val_loader, device)
        average_loss = running_loss / max(len(train_indices), 1)
        
        # GPU memory stats for RTX 3050
        gpu_mem_msg = ''
        if device.type == 'cuda':
            allocated = torch.cuda.memory_allocated(0) / 1e9
            reserved = torch.cuda.memory_reserved(0) / 1e9
            gpu_mem_msg = f' | GPU: {allocated:.2f}GB/{reserved:.2f}GB'
        
        print(
            f'Epoch {epoch + 1}/{epochs} - '
            f'train_loss={average_loss:.4f} '
            f'val_accuracy={evaluation["accuracy"]:.4f} '
            f'val_macro_f1={evaluation["macro_f1"]:.4f}{gpu_mem_msg}'
        )

        score = evaluation['macro_f1'] + (evaluation['accuracy'] * 0.01)
        if score >= best_score:
            best_score = score
            best_metrics = evaluation
            torch.save(
                {
                    'state_dict': model.state_dict(),
                    'classes': list(CLASS_LABELS),
                    'expected_labels': list(CLASS_LABELS),
                },
                checkpoint_path,
            )

    if best_metrics is None:
        raise SystemExit('Training completed without producing validation metrics.')

    metrics = build_metrics_payload(
        base_dataset,
        train_indices,
        val_indices,
        train_class_counts,
        best_metrics,
        checkpoint_path,
        dataset_slugs,
    )
    with open(metrics_path, 'w', encoding='utf-8') as handle:
        json.dump(metrics, handle, indent=2)

    print('Saved checkpoint to', checkpoint_path)
    print('Saved metrics to', metrics_path)


if __name__ == '__main__':
    main()
