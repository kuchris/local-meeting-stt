@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if "%~1"=="" (
  echo Usage: transcribe_cpp.cmd ..\demo.wav [output_base_without_extension]
  exit /b 2
)
set "OUT=%~2"
if "%OUT%"=="" set "OUT=output\transcript_cpp"
bin\Release\whisper-cli.exe -m models\ggml-small.bin -f "%~1" -l ja -otxt -of "%OUT%" %3 %4 %5 %6 %7 %8 %9
