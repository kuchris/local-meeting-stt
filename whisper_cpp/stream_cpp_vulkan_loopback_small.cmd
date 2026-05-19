@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist output mkdir output
call select_vulkan_device.cmd bin_vulkan_loopback\Release\whisper-stream-loopback.exe
bin_vulkan_loopback\Release\whisper-stream-loopback.exe -m models\ggml-small.bin -l ja -t 4 --step 0 --length 5000 --keep 250 --vad-check 750 -vth 0.55 -fth 150 -nf --plain -f output\stream_cpp_vulkan_loopback_small.txt --save-wav output\stream_cpp_vulkan_loopback_small.wav %*
