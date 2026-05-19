@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."

if "%~1"=="" (
  echo Drag and drop a .wav file onto this .bat file.
  echo This wrapper uses the separate OpenVINO whisper.cpp build.
  echo.
  echo Optional:
  echo   set OV_DEVICE=NPU
  echo   set OV_DEVICE=GPU
  echo   set OV_DEVICE=CPU
  echo.
  pause
  exit /b 2
)

if "%OV_DEVICE%"=="" set "OV_DEVICE=NPU"

if not exist "whisper_cpp\bin_openvino\Release\whisper-cli.exe" (
  echo Missing OpenVINO runtime:
  echo   whisper_cpp\bin_openvino\Release\whisper-cli.exe
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

if not exist "whisper_cpp\models\ggml-small-encoder-openvino.xml" (
  echo Missing OpenVINO encoder:
  echo   whisper_cpp\models\ggml-small-encoder-openvino.xml
  echo   whisper_cpp\models\ggml-small-encoder-openvino.bin
  echo.
  pause
  exit /b 1
)

set "AUDIO=%~1"
set "OUT=%~dpn1_openvino_%OV_DEVICE%_transcript"

echo Audio:
echo   %AUDIO%
echo.
echo OpenVINO device:
echo   %OV_DEVICE%
echo.
echo Output:
echo   %OUT%.txt
echo.

whisper_cpp\bin_openvino\Release\whisper-cli.exe -m whisper_cpp\models\ggml-small.bin -f "%AUDIO%" -l ja -oved %OV_DEVICE% -t 8 -bs 1 -bo 1 -nf -nt -np -otxt -of "%OUT%"

echo.
if errorlevel 1 (
  echo Failed.
) else (
  echo Done.
)
pause
