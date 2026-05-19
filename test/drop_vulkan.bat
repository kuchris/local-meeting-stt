@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."

if "%~1"=="" (
  echo Drag and drop a .wav file onto this .bat file.
  echo This whisper.cpp wrapper uses the Vulkan backend when available.
  echo.
  pause
  exit /b 2
)

if not exist "whisper_cpp\bin_vulkan\Release\whisper-cli.exe" (
  echo Missing Vulkan runtime:
  echo   whisper_cpp\bin_vulkan\Release\whisper-cli.exe
  echo.
  pause
  exit /b 1
)

if not exist "whisper_cpp\models\ggml-small.bin" (
  echo Missing model:
  echo   whisper_cpp\models\ggml-small.bin
  echo.
  pause
  exit /b 1
)

call whisper_cpp\select_vulkan_device.cmd whisper_cpp\bin_vulkan\Release\whisper-cli.exe

set "AUDIO=%~1"
set "OUT=%~dpn1_vulkan_transcript"

echo Audio:
echo   %AUDIO%
echo.
echo Output:
echo   %OUT%.txt
echo.

whisper_cpp\bin_vulkan\Release\whisper-cli.exe -m whisper_cpp\models\ggml-small.bin -f "%AUDIO%" -l ja -otxt -of "%OUT%" -t 4

echo.
if errorlevel 1 (
  echo Failed.
) else (
  echo Done.
)
pause
