@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."

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

call python_backend\post_transcribe_qwen.cmd "%AUDIO%" -o "%OUT%" --device cuda:0

echo.
if errorlevel 1 (
  echo Failed.
) else (
  echo Done.
)
pause
