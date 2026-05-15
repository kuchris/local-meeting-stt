@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."

if "%~1"=="" (
  echo Drag and drop a .wav file onto this .bat file.
  echo.
  pause
  exit /b 2
)

set "AUDIO=%~1"
set "OUT=%~dpn1_qwen_transcript.txt"

echo Audio:
echo   %AUDIO%
echo.
echo Output:
echo   %OUT%
echo.

uv run --with qwen-asr --with torch python python_backend\post_transcribe_qwen.py "%AUDIO%" -o "%OUT%"

echo.
if errorlevel 1 (
  echo Failed.
) else (
  echo Done.
)
pause
