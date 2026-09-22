import os
from pathlib import Path
from queue import Queue
import sys
import tempfile
from threading import Event, Thread
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from session_control import capture_worker, next_chunk, watch_stop_request


class SessionControlTests(unittest.TestCase):
    def test_stop_wakes_empty_consumer(self):
        stop = Event()
        result = []
        thread = Thread(target=lambda: result.append(next_chunk(Queue(), stop, [])))
        thread.start()
        stop.set()
        thread.join(timeout=1)
        self.assertFalse(thread.is_alive())
        self.assertEqual(result, [None])

    def test_device_failure_reaches_consumer(self):
        stop, errors, queue = Event(), [], Queue()
        def capture(*_):
            raise OSError("device disconnected")
        capture_worker(capture, None, queue, stop, errors)
        with self.assertRaisesRegex(RuntimeError, "device disconnected"):
            next_chunk(queue, stop, errors)

    def test_desktop_stop_file(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / 'stop.request'
            with patch.dict(os.environ, {"LOCAL_MEETING_STT_STOP_FILE": str(filename)}):
                stop = Event()
                watch_stop_request(stop)
                self.assertFalse(stop.is_set())
                filename.write_text('stop')
                self.assertTrue(stop.wait(1))


if __name__ == '__main__':
    unittest.main()
