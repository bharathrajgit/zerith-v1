import os

total = 0
for root, dirs, files in os.walk('d:\\VS Code Folder\\dsa-platform\\ml-training\\data\\raw'):
    total += len([f for f in files if f.endswith(('.jpg', '.jpeg', '.png'))])
print(f'Total images: {total}')
