"""Real SenseVoice-Small live lifecycle with public-file audio, never microphones.

CPU: uv run --with soundcard --with soundfile --with numpy --with soxr --with faster-whisper --with opencc-python-reimplemented --with sherpa-onnx==1.13.8 --with psutil python test/sensevoice_replay.py
GPU: add --gpu, and run with the packages python_backend/live_sensevoice_gpu.cmd uses.
Requires models/SenseVoiceSmall (or SenseVoiceSmall-fp32) and the public Cantonese
FLEURS clips under outputs/asr_benchmark/fleurs/yue_hant_hk.
"""
from pathlib import Path
import json
import os
import subprocess
import sys
import threading
import time
import wave

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'outputs/backend-review'
OUT.mkdir(parents=True, exist_ok=True)
CLIPS = ROOT / 'outputs/asr_benchmark/fleurs/yue_hant_hk'


def worker():
    import numpy as np
    import soundfile as sf
    sys.path.insert(0, str(ROOT / 'python_backend'))
    import live_transcribe as live
    first = json.loads((CLIPS / 'manifest.json').read_text(encoding='utf-8'))['samples'][0]
    source, rate = sf.read(CLIPS / first['file'], dtype='float32')
    audio = np.concatenate((source, np.zeros(2 * rate, dtype=np.float32)))

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
    gpu = '--gpu' in sys.argv
    sys.argv = ['replay', '--engine', 'sensevoice', '--streaming', '--save-recording',
                '--recording-output', str(OUT / 'sensevoice_replay.wav'),
                '--output', str(OUT / 'sensevoice_transcript.txt'),
                '--sensevoice-model', str(ROOT / 'models' / ('SenseVoiceSmall-fp32' if gpu else 'SenseVoiceSmall')),
                '--provider', 'cuda' if gpu else 'cpu', '--language', 'yue', '--chinese-script', 'traditional',
                '--capture-rate', str(rate), '--capture-block-seconds', '0.5']
    live.run_live(live.parse_args())


def parent():
    import psutil
    stop = OUT / 'sensevoice_stop.request'
    stop.unlink(missing_ok=True)
    (OUT / 'sensevoice_transcript.txt').unlink(missing_ok=True)
    env = {**os.environ, 'LOCAL_MEETING_STT_STOP_FILE': str(stop), 'PYTHONUNBUFFERED': '1', 'PYTHONUTF8': '1'}
    args = [sys.executable, '-u', __file__, '--worker'] + (['--gpu'] if '--gpu' in sys.argv else [])
    process = subprocess.Popen(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf8')
    lines, ready = [], threading.Event()

    def read():
        for line in process.stdout:
            lines.append(line)
            if '@@FINAL\t' in line:
                ready.set()

    thread = threading.Thread(target=read, daemon=True)
    thread.start()
    try:
        assert ready.wait(60), ''.join(lines)
        started = time.perf_counter()
        stop.write_text('stop')
        code = process.wait(timeout=10)
        thread.join(timeout=2)
        output = ''.join(lines)
        assert code == 0, output
        assert 'recording closed; exiting model worker' in output, output
        assert any('@@PARTIAL\t' in line for line in lines), 'No revisable preview was emitted'
        transcript = (OUT / 'sensevoice_transcript.txt').read_text(encoding='utf8')
        assert transcript.strip(), 'No finalized transcript'
        # FLEURS yue sample 1: "在短短兩週內，美軍和自由法國軍就解放了南法" in Traditional (HK) characters.
        assert '兩' in transcript and '軍' in transcript and '两' not in transcript, transcript
        with wave.open(str(OUT / 'sensevoice_replay.wav'), 'rb') as wav:
            assert wav.getnframes() > 0
        device = 'CUDA' if '--gpu' in sys.argv else 'CPU'
        print(f'PASS SenseVoice {device}: preview, Traditional final transcript, cooperative stop in {time.perf_counter() - started:.3f}s, saved WAV')
        print(transcript.strip())
    finally:
        if process.poll() is None:
            for child in psutil.Process(process.pid).children(recursive=True):
                child.kill()
            process.kill()
            process.wait()
        (OUT / 'sensevoice_replay.log').write_text(''.join(lines), encoding='utf8')
        stop.unlink(missing_ok=True)


if __name__ == '__main__':
    worker() if '--worker' in sys.argv else parent()
