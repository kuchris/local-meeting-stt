@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
uv run --with soundcard --with soundfile --with numpy --with soxr --with requests python -u live_cpp.py --server --save-recording --no-gpu --chunk-seconds 4 --max-backlog 2 --gain 2.0 %*
