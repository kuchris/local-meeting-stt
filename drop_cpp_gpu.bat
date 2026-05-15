@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if "%~1"=="" (
  echo Drag and drop a .wav file onto this .bat file.
  echo This whisper.cpp wrapper uses GPU when available.
  echo.
  pause
  exit /b 2
)

set "AUDIO=%~1"
set "OUT=%~dpn1_cpp_gpu_transcript"

echo Audio:
echo   %AUDIO%
echo.
echo Output:
echo   %OUT%.txt
echo.

beta_whisper_cpp\bin_cuda\Release\whisper-cli.exe -m beta_whisper_cpp\models\ggml-small.bin -f "%AUDIO%" -l ja -otxt -of "%OUT%"

echo.
if errorlevel 1 (
  echo Failed.
) else (
  echo Done.
)
pause
