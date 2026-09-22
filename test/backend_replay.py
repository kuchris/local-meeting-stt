"""Real CUDA Whisper server lifecycle with public-file audio, never microphones.

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
    audio, rate = sf.read(ROOT/'outputs/asr_benchmark/data/10020345318418093976.wav', dtype='float32')
    class Recorder:
        offset = 0
        def __enter__(self): return self
        def __exit__(self, *_): pass
        def record(self, numframes):
            time.sleep(numframes / rate)
            indices = np.arange(self.offset, self.offset + numframes) % len(audio)
            self.offset += numframes
            return audio[indices]
    class Device:
        name = 'Public fixture (no audio device)'
        def recorder(self, **_): return Recorder()
    live.select_system_loopback = lambda _: Device()
    sys.argv = ['replay', '--server', '--save-recording', '--recording-output', str(OUT/'replay.wav'),
                '--model', str(ROOT/'whisper_cpp/models/ggml-small.bin'),
                '--whisper-server', str(ROOT/'whisper_cpp/bin_cuda/Release/whisper-server.exe'),
                '--capture-rate', str(rate), '--chunk-seconds', '1', '--capture-block-seconds', '0.1',
                '--beam-size', '1', '--best-of', '1']
    live.run_live(live.parse_args())


def parent():
    import psutil
    stop = OUT/'stop.request'
    stop.unlink(missing_ok=True)
    env = {**os.environ, 'LOCAL_MEETING_STT_STOP_FILE': str(stop), 'PYTHONUNBUFFERED': '1', 'PYTHONUTF8': '1'}
    process = subprocess.Popen([sys.executable, '-u', __file__, '--worker'], env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf8')
    lines, ready = [], threading.Event()
    def read():
        for line in process.stdout:
            lines.append(line)
            if '[timing]' in line:
                ready.set()
    thread = threading.Thread(target=read, daemon=True)
    thread.start()
    children = []
    try:
        assert ready.wait(60), ''.join(lines)
        children = psutil.Process(process.pid).children(recursive=True)
        assert any('whisper-server' in p.name() for p in children), 'Model server never started'
        started = time.perf_counter()
        stop.write_text('stop')
        code = process.wait(timeout=10)
        thread.join(timeout=2)
        assert code == 0, ''.join(lines)
        assert 'recording closed; model worker released' in ''.join(lines)
        assert all(not p.is_running() for p in children), 'Leaked server process'
        with wave.open(str(OUT/'replay.wav'), 'rb') as wav:
            assert wav.getnframes() > 0 and len(wav.readframes(wav.getnframes())) == wav.getnframes()*2
        print(f'PASS real CUDA server: public audio inference, cooperative stop in {time.perf_counter()-started:.3f}s, finalized WAV, no child model process')
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
