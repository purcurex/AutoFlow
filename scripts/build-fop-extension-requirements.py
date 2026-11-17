"""Compatibility entry: build only the current unified FOP synchronization handoff."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).resolve().with_name('build-unified-requirements.py')),run_name='__main__')
