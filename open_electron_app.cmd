@echo off
setlocal

set ELECTRON_RUN_AS_NODE=
set BUILT_EXE=%~dp0electron_app\dist\win-unpacked\Local Meeting STT.exe

if exist "%BUILT_EXE%" (
  start "" "%BUILT_EXE%"
  exit /b 0
)

pushd "%~dp0electron_app"
if errorlevel 1 (
  echo Could not open electron_app folder.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First launch: installing Electron app packages...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    popd
    pause
    exit /b 1
  )
)

call npm.cmd run dev
popd
