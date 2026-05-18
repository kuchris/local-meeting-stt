@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "GGML_VK_VISIBLE_DEVICES=1"
uv run --with soundcard --with soundfile --with numpy --with soxr --with requests python -u live_cpp.py --server --save-recording --whisper-server bin_vulkan\Release\whisper-server.exe --model models\ggml-base.bin --threads 4 --chunk-seconds 3 --max-backlog 1 --gain 2.0 %*
