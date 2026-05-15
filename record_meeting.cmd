@echo off
setlocal
cd /d "%~dp0"
uv run --with soundcard --with soundfile --with numpy --with soxr python record_audio.py %*
