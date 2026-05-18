@echo off
setlocal EnableExtensions

cd /d "%~dp0"

set "APP_NAME=Local Meeting STT"
set "ELECTRON_DIR=%CD%\electron_app"
set "DIST_DIR=%ELECTRON_DIR%\dist"
set "PORTABLE_EXE=%DIST_DIR%\Local Meeting STT portable.exe"
set "VERSIONED_PORTABLE_EXE=%DIST_DIR%\Local Meeting STT 0.1.0.exe"
set "RELEASE_DIR=%DIST_DIR%\Local Meeting STT portable"

echo Building portable exe...
pushd "%ELECTRON_DIR%" || exit /b 1
call npm run dist:portable
if errorlevel 1 (
  popd
  echo.
  echo Build failed.
  pause
  exit /b 1
)
popd

if not exist "%PORTABLE_EXE%" if exist "%VERSIONED_PORTABLE_EXE%" set "PORTABLE_EXE=%VERSIONED_PORTABLE_EXE%"

if not exist "%PORTABLE_EXE%" (
  echo.
  echo Missing portable exe:
  echo %DIST_DIR%\Local Meeting STT portable.exe
  echo %VERSIONED_PORTABLE_EXE%
  pause
  exit /b 1
)

echo.
echo Creating portable folder...
if exist "%RELEASE_DIR%" rmdir /s /q "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%" || exit /b 1
mkdir "%RELEASE_DIR%\outputs"
mkdir "%RELEASE_DIR%\models"
mkdir "%RELEASE_DIR%\runtime\uv-cache"
mkdir "%RELEASE_DIR%\runtime\venv"
mkdir "%RELEASE_DIR%\whisper_cpp\models"

copy /y "%PORTABLE_EXE%" "%RELEASE_DIR%\%APP_NAME%.exe" >nul

echo Copying backend scripts...
robocopy "%CD%\python_backend" "%RELEASE_DIR%\python_backend" /E /XD __pycache__ /XF *.pyc >nul
if errorlevel 8 (
  echo Failed to copy python_backend.
  pause
  exit /b 1
)

copy /y "%CD%\whisper_cpp\*.cmd" "%RELEASE_DIR%\whisper_cpp\" >nul
copy /y "%CD%\whisper_cpp\*.py" "%RELEASE_DIR%\whisper_cpp\" >nul
copy /y "%CD%\whisper_cpp\README.md" "%RELEASE_DIR%\whisper_cpp\" >nul

> "%RELEASE_DIR%\settings.json" (
  echo {
  echo   "outputDir": "outputs",
  echo   "qwen": {
  echo     "chunkSeconds": 60,
  echo     "tokens": 4096,
  echo     "batch": 4
  echo   },
  echo   "ui": {
  echo     "sessionListWidth": 300,
  echo     "transcribeColumnWidth": 560
  echo   }
  echo }
)

> "%RELEASE_DIR%\README.txt" (
  echo Local Meeting STT portable folder
  echo.
  echo Run:
  echo   %APP_NAME%.exe
  echo.
  echo Put downloaded models in:
  echo   models\
  echo   whisper_cpp\models\
  echo.
  echo Outputs are saved in:
  echo   outputs\
)

echo.
echo Done:
echo %RELEASE_DIR%
pause
