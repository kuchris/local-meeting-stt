@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
uv run --with soundcard --with soundfile --with numpy --with soxr --with requests --with faster-whisper python -u live_cpp.py --server --streaming --save-recording --no-gpu --model models\ggml-small.bin --threads 6 --chunk-seconds 3 --max-backlog 1 %*
