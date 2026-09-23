@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
uv run --with soundcard --with soundfile --with numpy --with soxr --with requests --with faster-whisper python -u live_cpp.py --server --streaming --save-recording --beam-size 1 --best-of 1 %*
