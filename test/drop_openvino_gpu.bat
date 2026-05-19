@echo off
setlocal
set "OV_DEVICE=GPU"
call "%~dp0drop_openvino.bat" %*
