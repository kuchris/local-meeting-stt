@echo off
setlocal
cd /d "%~dp0.."
rem SenseVoice-Small on an NVIDIA GPU (fp32). sherpa-onnx's CUDA 12 build needs the
rem CUDA runtime, cuBLAS, cuFFT, cuRAND and cuDNN 9 DLLs; NVIDIA's pip packages
rem supply them (about 1.5 GB on first use) and cuda_dlls.py puts them on the DLL path.
uv run --find-links https://k2-fsa.github.io/sherpa/onnx/cuda.html --with "sherpa-onnx==1.13.8+cuda12.cudnn9" --with nvidia-cuda-runtime-cu12 --with nvidia-cublas-cu12 --with nvidia-cufft-cu12 --with nvidia-curand-cu12 --with nvidia-cudnn-cu12 --with soundcard --with soundfile --with numpy --with soxr --with faster-whisper --with opencc-python-reimplemented python -u python_backend\post_transcribe_sensevoice.py --provider cuda %*
