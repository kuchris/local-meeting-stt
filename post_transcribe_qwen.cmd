@echo off
setlocal
cd /d "%~dp0"
if "%~1"=="" (
  echo Usage: post_transcribe_qwen.cmd recordings\meeting_YYYYMMDD_HHMMSS.wav
  exit /b 2
)
uv run --with qwen-asr --with torch python post_transcribe_qwen.py %*
