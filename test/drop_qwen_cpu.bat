@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."

if "%~1"=="" (
  echo Drag and drop a .wav file onto this .bat file.
  echo This CPU wrapper uses --device cpu.
  echo.
  pause
  exit /b 2
)

set "AUDIO=%~1"
set "OUT=%~dpn1_qwen_cpu_transcript.txt"

echo Audio:
echo   %AUDIO%
echo.
echo Output:
echo   %OUT%
echo.

uv run --python 3.12 --with qwen-asr --with torch --with torchvision python python_backend\post_transcribe_qwen.py "%AUDIO%" -o "%OUT%" --device cpu --max-new-tokens 4096 --chunk-seconds 60 --batch-size 4

echo.
if errorlevel 1 (
  echo Failed.
) else (
  echo Done.
)
pause
