@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist bin_vulkan\Release\whisper-server.exe (
  echo Vulkan runtime missing; falling back to CPU server.
  call live_cpp_server_cpu.cmd %*
  exit /b %ERRORLEVEL%
)
call select_vulkan_device.cmd bin_vulkan\Release\whisper-cli.exe
uv run --with soundcard --with soundfile --with numpy --with soxr --with requests python -u live_cpp.py --server --save-recording --session-prefix cpp_vulkan_live --whisper-server bin_vulkan\Release\whisper-server.exe --model models\ggml-small.bin --threads 4 --chunk-seconds 3 --max-backlog 1 --gain 2.0 %*
