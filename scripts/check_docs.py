"""Check repository Markdown relative file links, excluding code fences and external URLs."""
from pathlib import Path
import re
import subprocess

files = subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard'],text=True).splitlines()
errors = []
for name in files:
    path = Path(name)
    if path.suffix != '.md' or path.is_symlink(): continue
    text = re.sub(r'```.*?```','',path.read_text(),flags=re.S)
    for target in re.findall(r'\]\(([^)]+)\)',text):
        if '://' in target or target.startswith('#') or target.startswith('mailto:'): continue
        dest = target.split('#')[0]
        if not (path.parent/dest).exists(): errors.append(f'{path}: {target}')
assert not errors, '\n'.join(errors)
print('PASS: repository Markdown relative file links.')
