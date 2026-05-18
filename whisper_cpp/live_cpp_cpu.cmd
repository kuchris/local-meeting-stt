@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
uv run --with soundcard --with soundfile --with numpy --with soxr python -u live_cpp.py --save-recording --no-gpu --chunk-seconds 3 --gain 2.0 %*
