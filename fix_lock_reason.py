import re

file_path = r'd:\VS Code Folder\dsa-platform\client\src\pages\institution\MalpracticePage.jsx'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the lock reason display logic to show lock reason even if not currently locked
pattern = r'\{log\.isCurrentlyLocked \? \(\s*<span className=\{styles\.lockReasonText\}\>\{log\.lockReason \|\| \'Unknown reason\'\}\</span\>\s*\) : \(\s*<span className=\{styles\.noAction\}\>-</span\>\s*\)\}'
replacement = '{log.lockReason ? (\n                          <span className={styles.lockReasonText}>{log.lockReason}</span>\n                        ) : (\n                          <span className={styles.noAction}>-</span>\n                        )}'

content = re.sub(pattern, replacement, content)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Successfully updated lock reason display')
