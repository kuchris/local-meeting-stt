@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if "%~1"=="" (
  echo Drag and drop a .wav file onto this .bat file.
  echo This GPU wrapper uses --device cuda:0.
  echo.
  pause
  exit /b 2
)

set "AUDIO=%~1"
set "OUT=%~dpn1_qwen_gpu_transcript.txt"

echo Audio:
echo   %AUDIO%
echo.
echo Output:
echo   %OUT%
echo.

uv run --python 3.12 --index-strategy unsafe-best-match --index-url https://download.pytorch.org/whl/cu121 --extra-index-url https://pypi.org/simple --with qwen-asr --with "torch==2.5.1+cu121" --with "torchvision==0.20.1+cu121" python post_transcribe_qwen.py "%AUDIO%" -o "%OUT%" --device cuda:0

echo.
if errorlevel 1 (
  echo Failed.
) else (
  echo Done.
)
pause
