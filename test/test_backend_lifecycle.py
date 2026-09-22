from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'whisper_cpp'))
import live_cpp


class StartupCleanupTests(unittest.TestCase):
    def test_startup_timeout_reaps_server(self):
        with patch.object(sys, 'argv', ['test']):
            args = live_cpp.parse_args()
        args.threads = 1
        process = Mock()
        with patch.object(live_cpp, 'Popen', return_value=process), \
             patch.object(live_cpp, 'Thread') as thread, \
             patch.object(live_cpp, 'free_local_port', return_value=12345), \
             patch.object(live_cpp, 'wait_for_port', side_effect=TimeoutError('startup timeout')):
            process.poll.return_value = None
            with self.assertRaisesRegex(TimeoutError, 'startup timeout'):
                live_cpp.start_whisper_server(args)
            process.terminate.assert_called_once()
            process.wait.assert_called_once()
            thread.return_value.join.assert_called_once()

    def test_failed_start_does_not_join_unstarted_capture_thread(self):
        with patch.object(sys, 'argv', ['test', '--server', '--output', str(Path('outputs/backend-review/test.txt'))]):
            args = live_cpp.parse_args()
        with patch.object(live_cpp, 'select_system_loopback', return_value=Mock(name='fixture')), \
             patch.object(live_cpp, 'start_whisper_server', side_effect=RuntimeError('model failed')):
            with self.assertRaisesRegex(RuntimeError, 'model failed'):
                live_cpp.run_live(args)


if __name__ == '__main__':
    unittest.main()
