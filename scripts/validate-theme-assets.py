"""Guard shared interaction colors and deterministic generated tokens."""
from pathlib import Path
import re,subprocess
root=Path(__file__).resolve().parents[1]
css=root/'frontend/src/theme/palettes.css'
subprocess.run(['python3',str(root/'scripts/build-avatar-assets.py'),'--check'],check=True)
before=css.read_bytes()
subprocess.run(['python3',str(root/'scripts/build-theme-assets.py')],check=True)
assert css.read_bytes()==before,'Regenerate palettes.css from palettes.json'
errors=[]
for p in (root/'frontend/src').rglob('*.vue'):
 for block in re.findall(r'<style[\s\S]*?</style>',p.read_text()):
  for selector,rule in re.findall(r'([^{}]+)\{([^{}]+)\}',block):
   if any(token in selector for token in ['primary','selected','query-button']):
    if re.search(r'(?:background|color)\s*:\s*#[\da-fA-F]{6}',rule):errors.append(f'{p.relative_to(root)}: {selector.strip()}')
assert not errors,'Use semantic theme tokens: '+str(errors)
print('Theme assets: generated CSS and shared interaction colors verified')
# Text must never inherit a surface/border token (including nested fallbacks).
for p in (root/'frontend/src').rglob('*'):
 if p.suffix not in ['.vue','.css']:continue
 for value in re.findall(r'(?<![-\w])color\s*:\s*([^;}]+)',p.read_text()):
  assert not re.search(r'var\(--color-(?:surface(?:-muted)?|border(?:-strong)?|background)\b',value),f'Text uses background token: {p}: {value}'
print('Text/background semantic separation verified')
