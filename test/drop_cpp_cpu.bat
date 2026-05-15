@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."

if "%~1"=="" (
  echo Drag and drop a .wav file onto this .bat file.
  echo This whisper.cpp wrapper uses CPU only.
  echo.
  pause
  exit /b 2
)

set "AUDIO=%~1"
set "OUT=%~dpn1_cpp_cpu_transcript"

echo Audio:
echo   %AUDIO%
echo.
echo Output:
echo   %OUT%.txt
echo.

whisper_cpp\bin_cpu\Release\whisper-cli.exe -m whisper_cpp\models\ggml-small.bin -f "%AUDIO%" -l ja -otxt -of "%OUT%" -t 16

echo.
if errorlevel 1 (
  echo Failed.
) else (
  echo Done.
)
pause
