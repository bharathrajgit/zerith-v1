import re

file_path = r'd:\VS Code Folder\dsa-platform\client\src\pages\student\DiagnosticPage.jsx'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

format_duration_func = '''
const formatDuration = (lockedUntil) => {
  const remainingMs = Math.max(0, new Date(lockedUntil || 0).getTime() - Date.now());
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
};
'''

# Insert after the import styles line
pattern = r"(import styles from '\.\/DiagnosticPage\.module\.css';)"
replacement = r'\1\n\n' + format_duration_func

content = re.sub(pattern, replacement, content)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Successfully added formatDuration function')
