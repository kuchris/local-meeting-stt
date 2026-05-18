@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist output mkdir output
bin_cpu\Release\whisper-stream.exe -m models\ggml-small.bin -l ja --step 1000 --length 3000 --keep 500 -c 0 -f output\stream_cpp.txt %*
