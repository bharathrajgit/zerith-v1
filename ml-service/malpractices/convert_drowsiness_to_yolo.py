# convert_drowsiness_to_yolo.py
import os
import shutil
from pathlib import Path
import random

# Set random seed for reproducibility
random.seed(42)

# Paths
source_dir = Path('dataset/driver drowsiness/Driver Drowsiness Dataset (DDD)')
output_dir = Path('dataset/drowsiness_yolo')

# Create output directories
train_dir = output_dir / 'train'
val_dir = output_dir / 'val'
test_dir = output_dir / 'test'

for split_dir in [train_dir, val_dir, test_dir]:
    for class_name in ['Drowsy', 'Non Drowsy']:
        (split_dir / class_name).mkdir(parents=True, exist_ok=True)

# Get all images for each class
drowsy_images = list((source_dir / 'Drowsy').glob('*.png')) + list((source_dir / 'Drowsy').glob('*.jpg'))
non_drowsy_images = list((source_dir / 'Non Drowsy').glob('*.png')) + list((source_dir / 'Non Drowsy').glob('*.jpg'))

print(f"Found {len(drowsy_images)} Drowsy images")
print(f"Found {len(non_drowsy_images)} Non Drowsy images")

# Split ratios (70% train, 20% val, 10% test)
train_ratio = 0.7
val_ratio = 0.2
test_ratio = 0.1

def split_and_copy(images, class_name):
    random.shuffle(images)
    total = len(images)
    train_end = int(total * train_ratio)
    val_end = train_end + int(total * val_ratio)
    
    train_images = images[:train_end]
    val_images = images[train_end:val_end]
    test_images = images[val_end:]
    
    print(f"\n{class_name}:")
    print(f"  Train: {len(train_images)}")
    print(f"  Val: {len(val_images)}")
    print(f"  Test: {len(test_images)}")
    
    # Copy images
    for img in train_images:
        shutil.copy(img, train_dir / class_name / img.name)
    for img in val_images:
        shutil.copy(img, val_dir / class_name / img.name)
    for img in test_images:
        shutil.copy(img, test_dir / class_name / img.name)

# Split and copy for both classes
split_and_copy(drowsy_images, 'Drowsy')
split_and_copy(non_drowsy_images, 'Non Drowsy')

print("\n" + "=" * 50)
print("CONVERSION COMPLETE!")
print(f"Dataset saved to: {output_dir.absolute()}")
print("=" * 50)
