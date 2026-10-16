@echo off
setlocal

set BUILT_EXE=%~dp0desktop\src-tauri\target\release\local-meeting-stt.exe

if exist "%BUILT_EXE%" (
  start "" "%BUILT_EXE%"
  exit /b 0
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust is not installed. Install it from https://rustup.rs/ and try again.
  pause
  exit /b 1
)

pushd "%~dp0desktop\src-tauri"
if errorlevel 1 (
  echo Could not open desktop\src-tauri.
  pause
  exit /b 1
)

echo Building and starting the desktop app...
cargo run
if errorlevel 1 (
  echo.
  echo cargo run failed.
  popd
  pause
  exit /b 1
)
popd
