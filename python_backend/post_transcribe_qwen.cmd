@echo off
setlocal
cd /d "%~dp0.."
if "%~1"=="" (
  echo Usage: python_backend\post_transcribe_qwen.cmd recordings\meeting_YYYYMMDD_HHMMSS.wav
  exit /b 2
)
set QWEN_UV=--no-project --python 3.11 --index-strategy unsafe-best-match --index-url https://download.pytorch.org/whl/cu128 --extra-index-url https://pypi.org/simple --with-requirements python_backend\qwen-requirements.txt
rem The environment is pinned, so a cached copy is used without rechecking the
rem package indexes (about 2 s). Without one, uv installs it online.
uv run --offline %QWEN_UV% python -c "" >nul 2>nul
if errorlevel 1 (
  uv run %QWEN_UV% python -u python_backend\post_transcribe_qwen.py %*
) else (
  uv run --offline %QWEN_UV% python -u python_backend\post_transcribe_qwen.py %*
)
