@echo off
setlocal
cd /d "%~dp0.."
uv run --with soundcard --with soundfile --with numpy --with soxr --with faster-whisper --with opencc-python-reimplemented python -u python_backend\live_transcribe.py --streaming %*
