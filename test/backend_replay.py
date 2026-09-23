"""Real streaming CUDA Whisper lifecycle with public-file audio, never microphones.

uv run --with soundcard --with soundfile --with numpy --with soxr --with requests --with psutil python test/backend_replay.py
Requires local whisper.cpp CUDA server/small model and the public benchmark WAV.
"""
from pathlib import Path
import os
import subprocess
import sys
import threading
import time
import wave

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'outputs/backend-review'
OUT.mkdir(parents=True, exist_ok=True)


def worker():
    import numpy as np
    import soundfile as sf
    sys.path.insert(0, str(ROOT / 'whisper_cpp'))
    import live_cpp as live
    source, rate = sf.read(ROOT/'outputs/asr_benchmark/data/10020345318418093976.wav', dtype='float32')
    audio = np.concatenate((source[:8*rate], np.zeros(2*rate, dtype=np.float32)))
    class Recorder:
        offset = 0
        def __enter__(self): return self
        def __exit__(self, *_): pass
        def record(self, numframes):
            time.sleep(numframes / rate)
            indices = np.arange(self.offset, self.offset + numframes)
            self.offset += numframes
            result = np.zeros(numframes, dtype=np.float32)
            valid = indices < len(audio)
            result[valid] = audio[indices[valid]]
            return result
    class Device:
        name = 'Public fixture (no audio device)'
        def recorder(self, **_): return Recorder()
    live.select_system_loopback = lambda _: Device()
    model_file = 'ggml-large-v3-turbo.bin' if '--turbo' in sys.argv else 'ggml-small.bin'
    cpu = '--cpu' in sys.argv
    sys.argv = ['replay', '--server', '--streaming', '--save-recording', '--recording-output', str(OUT/'replay.wav'),
                '--output', str(OUT/'stream_transcript.txt'), '--gain', '1',
                '--model', str(ROOT/'whisper_cpp/models'/model_file),
                '--whisper-server', str(ROOT/'whisper_cpp'/('bin_cpu' if cpu else 'bin_cuda')/'Release/whisper-server.exe'),
                '--capture-rate', str(rate), '--capture-block-seconds', '0.5',
                '--beam-size', '1', '--best-of', '1']
    if cpu:
        sys.argv += ['--no-gpu', '--threads', '8']
    live.run_live(live.parse_args())


def parent():
    import psutil
    stop = OUT/'stop.request'
    stop.unlink(missing_ok=True)
    (OUT/'stream_transcript.txt').unlink(missing_ok=True)
    env = {**os.environ, 'LOCAL_MEETING_STT_STOP_FILE': str(stop), 'PYTHONUNBUFFERED': '1', 'PYTHONUTF8': '1'}
    worker_args = [sys.executable, '-u', __file__, '--worker']
    if '--turbo' in sys.argv:
        worker_args.append('--turbo')
    if '--cpu' in sys.argv:
        worker_args.append('--cpu')
    process = subprocess.Popen(worker_args, env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf8')
    lines, ready = [], threading.Event()
    def read():
        for line in process.stdout:
            lines.append(line)
            if '@@FINAL\t' in line:
                ready.set()
    thread = threading.Thread(target=read, daemon=True)
    thread.start()
    children = []
    try:
        assert ready.wait(40), ''.join(lines)
        children = psutil.Process(process.pid).children(recursive=True)
        assert any('whisper-server' in p.name() for p in children), 'Model server never started'
        started = time.perf_counter()
        stop.write_text('stop')
        code = process.wait(timeout=10)
        thread.join(timeout=2)
        assert code == 0, ''.join(lines)
        assert 'recording closed; model worker released' in ''.join(lines)
        assert any('@@PARTIAL\t' in line for line in lines), 'No revisable preview was emitted'
        assert (OUT/'stream_transcript.txt').read_text(encoding='utf8').strip(), 'No finalized transcript'
        assert all(not p.is_running() for p in children), 'Leaked server process'
        with wave.open(str(OUT/'replay.wav'), 'rb') as wav:
            assert wav.getnframes() > 0 and len(wav.readframes(wav.getnframes())) == wav.getnframes()*2
        device = 'CPU' if '--cpu' in sys.argv else 'CUDA'
        print(f'PASS streaming {device} server: preview, final transcript, cooperative stop in {time.perf_counter()-started:.3f}s, finalized WAV, no child model process')
    finally:
        if process.poll() is None:
            for child in psutil.Process(process.pid).children(recursive=True):
                child.kill()
            process.kill()
            process.wait()
        (OUT/'replay.log').write_text(''.join(lines), encoding='utf8')
        stop.unlink(missing_ok=True)


if __name__ == '__main__':
    worker() if '--worker' in sys.argv else parent()
