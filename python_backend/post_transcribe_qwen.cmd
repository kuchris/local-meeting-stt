@echo off
setlocal
cd /d "%~dp0.."
if "%~1"=="" (
  echo Usage: python_backend\post_transcribe_qwen.cmd recordings\meeting_YYYYMMDD_HHMMSS.wav
  exit /b 2
)
uv run --with qwen-asr --with torch python python_backend\post_transcribe_qwen.py %*
