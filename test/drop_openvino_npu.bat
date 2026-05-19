@echo off
setlocal
set "OV_DEVICE=NPU"
call "%~dp0drop_openvino.bat" %*
