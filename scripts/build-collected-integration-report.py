"""Compatibility entrypoint: rebuild the single current requirements document, offline."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name("build-unified-requirements.py")), run_name="__main__")
