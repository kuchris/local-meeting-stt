@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
uv run --with soundcard --with soundfile --with numpy --with soxr --with requests python -u live_cpp.py --server --save-recording --no-gpu --model models\ggml-small.bin --threads 6 --chunk-seconds 3 --max-backlog 1 --gain 2.0 %*
