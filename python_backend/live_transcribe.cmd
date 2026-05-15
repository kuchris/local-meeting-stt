@echo off
setlocal
cd /d "%~dp0.."
uv run --with soundcard --with soundfile --with numpy --with soxr --with faster-whisper python python_backend\live_transcribe.py %*
