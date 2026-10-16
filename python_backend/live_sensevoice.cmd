@echo off
setlocal
cd /d "%~dp0.."
rem SenseVoice-Small on CPU (int8). faster-whisper provides the Silero VAD.
uv run --with soundcard --with soundfile --with numpy --with soxr --with faster-whisper --with opencc-python-reimplemented --with sherpa-onnx==1.13.8 python -u python_backend\live_transcribe.py --engine sensevoice --streaming %*
