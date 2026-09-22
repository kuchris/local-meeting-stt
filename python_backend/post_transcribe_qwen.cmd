@echo off
setlocal
cd /d "%~dp0.."
if "%~1"=="" (
  echo Usage: python_backend\post_transcribe_qwen.cmd recordings\meeting_YYYYMMDD_HHMMSS.wav
  exit /b 2
)
uv run --no-project --python 3.11 --index-strategy unsafe-best-match --index-url https://download.pytorch.org/whl/cu128 --extra-index-url https://pypi.org/simple --with-requirements python_backend\qwen-requirements.txt python -u python_backend\post_transcribe_qwen.py %*
