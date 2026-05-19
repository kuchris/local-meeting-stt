@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist output mkdir output
call select_vulkan_device.cmd bin_vulkan\Release\whisper-cli.exe
bin_vulkan\Release\whisper-stream.exe -m models\ggml-base.bin -l ja --step 500 --length 5000 --keep 500 -c 0 -f output\stream_cpp_vulkan.txt %*
