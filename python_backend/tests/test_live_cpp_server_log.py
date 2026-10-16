from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "whisper_cpp"))
from live_cpp import server_line_worth_logging


class ServerLogTests(unittest.TestCase):
    def test_per_request_and_parameter_lines_are_dropped(self):
        for line in [
            "",
            "system_info: n_threads = 8 / 8 | WHISPER : COREML = 0 |",
            "operator (): processing 'chunk.wav' (11200 samples, 0.7 sec), 8 threads, 1 processors, lang = yue",
            "whisper_model_load: n_vocab       = 51866",
            "whisper_init_state: kv self size  =   10.49 MB",
            "whisper_init_with_params_no_state: use gpu    = 1",
            "whisper_backend_init_gpu: device 0: CUDA0 (type: 1)",
        ]:
            self.assertFalse(server_line_worth_logging(line), line)

    def test_device_model_and_problem_lines_are_kept(self):
        for line in [
            "ggml_cuda_init: found 1 CUDA devices (Total VRAM: 16302 MiB):",
            "  Device 0: NVIDIA GeForce RTX 5070 Ti, compute capability 12.0, VMM: yes, VRAM: 16302 MiB",
            "whisper_init_from_file_with_params_no_state: loading model from 'models\\ggml-large-v3-turbo.bin'",
            "whisper_backend_init_gpu: using CUDA0 backend",
            "whisper_model_load: model size    = 1623.92 MB",
            "whisper_model_load: failed to open 'models\\missing.bin'",
            "error: failed to read audio data",
        ]:
            self.assertTrue(server_line_worth_logging(line), line)


if __name__ == "__main__":
    unittest.main()
