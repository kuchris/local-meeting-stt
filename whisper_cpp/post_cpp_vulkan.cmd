@echo off
setlocal
chcp 65001 >nul

if "%~1"=="" (
  echo Missing audio path.
  exit /b 2
)
if "%~2"=="" (
  echo Missing output base path.
  exit /b 2
)
if "%~3"=="" (
  set "THREADS=8"
) else (
  set "THREADS=%~3"
)
set "AUDIO=%~f1"
set "OUT=%~f2"

cd /d "%~dp0"

if not exist "bin_vulkan\Release\whisper-cli.exe" (
  echo Missing Vulkan runtime:
  echo   bin_vulkan\Release\whisper-cli.exe
  exit /b 1
)
if not exist "models\ggml-small.bin" (
  echo Missing model:
  echo   models\ggml-small.bin
  exit /b 1
)

call select_vulkan_device.cmd bin_vulkan\Release\whisper-cli.exe
bin_vulkan\Release\whisper-cli.exe -m models\ggml-small.bin -f "%AUDIO%" -l ja -otxt -of "%OUT%" -t %THREADS% -bs 1 -bo 1 -nf -nt -np
