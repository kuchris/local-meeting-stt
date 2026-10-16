"""Makes the CUDA 12 / cuDNN 9 DLLs from NVIDIA's pip packages loadable on Windows.

Import before sherpa_onnx's CUDA build: its CUDA provider finds cudart, cuBLAS,
cuFFT and cuDNN through the normal DLL search, and pip puts them in nvidia/*/bin.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def add_nvidia_dll_dirs() -> list[str]:
    added: list[str] = []
    for entry in sys.path:
        root = Path(entry) / "nvidia"
        if not root.is_dir():
            continue
        for bin_dir in sorted(root.glob("*/bin")):
            os.add_dll_directory(str(bin_dir))
            os.environ["PATH"] = f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}"
            added.append(str(bin_dir))
    return added


ADDED = add_nvidia_dll_dirs()
