@echo off
setlocal
cd /d "%~dp0.."
uv run --with soundcard --with soundfile --with numpy --with soxr --with faster-whisper python -u python_backend\live_transcribe.py --streaming --save-recording %*
