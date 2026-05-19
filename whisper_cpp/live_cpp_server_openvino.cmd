@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist bin_openvino\Release\whisper-server.exe (
  echo OpenVINO runtime missing:
  echo   bin_openvino\Release\whisper-server.exe
  exit /b 1
)
if not exist models\ggml-small-encoder-openvino.xml (
  echo OpenVINO encoder missing:
  echo   models\ggml-small-encoder-openvino.xml
  echo   models\ggml-small-encoder-openvino.bin
  exit /b 1
)
uv run --with soundcard --with soundfile --with numpy --with soxr --with requests python -u live_cpp.py --server --save-recording --session-prefix cpp_npu_live --whisper-server bin_openvino\Release\whisper-server.exe --model models\ggml-small.bin --threads 8 --openvino-device NPU --beam-size 1 --best-of 1 --no-fallback --chunk-seconds 3 --max-backlog 1 --gain 2.0 %*
