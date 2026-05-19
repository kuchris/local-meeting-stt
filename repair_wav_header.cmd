@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if "%~1"=="" (
  echo Drag and drop a .wav file onto this .bat file.
  echo It repairs simple PCM WAV RIFF/data sizes.
  echo.
  pause
  exit /b 2
)

uv run python python_backend\repair_wav_header.py "%~1"
echo.
pause
