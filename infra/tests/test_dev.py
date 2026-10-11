"""Local startup must preserve credentials/data and report standalone port conflicts."""
import importlib.util
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('dev', Path(__file__).resolve().parents[1] / 'dev.py')
dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)


class DevTests(unittest.TestCase):
    def test_first_launch_generates_secrets_and_repeat_preserves_them(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / '.env'
            settings = dev.prepare_env(path)
            for key in ('PRODUCT_DB_PASSWORD', 'AUTOMATION_PUBLISH_KEY'):
                self.assertRegex(settings[key], r'^[a-f0-9]{64}$')
            self.assertNotEqual(settings['PRODUCT_DB_PASSWORD'], settings['AUTOMATION_PUBLISH_KEY'])
            before = path.read_bytes()
            dev.prepare_env(path, existing_database=True)
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_missing_credentials_with_existing_data_never_generate_replacements(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / '.env'
            with self.assertRaisesRegex(ValueError, 'database volume already exists'):
                dev.prepare_env(path, existing_database=True)
            self.assertFalse(path.exists())
            path.write_text('PRODUCT_DB_PASSWORD=replace-me\nAUTOMATION_PUBLISH_KEY=old-key\n')
            before = path.read_bytes()
            with self.assertRaises(ValueError):
                dev.prepare_env(path, existing_database=True)
            self.assertEqual(path.read_bytes(), before)

    def test_existing_configuration_is_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / '.env'
            path.write_text('PRODUCT_DB_PASSWORD=existing\nAUTOMATION_PUBLISH_KEY=existing-key\nAPI_PORT=9000\n')
            self.assertEqual(dev.prepare_env(path, True)['API_PORT'], '9000')
            path.write_text(path.read_text() + 'PRODUCT_DB_PASSWORD=duplicate\n')
            with self.assertRaisesRegex(ValueError, 'Duplicate'):
                dev.prepare_env(path)

    def test_standalone_port_conflict_has_actionable_error(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            with patch.object(dev.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', '')):
                with self.assertRaisesRegex(ValueError, 'Stop the standalone Expo'):
                    dev.check_port('127.0.0.1', sock.getsockname()[1], 'mobile', ['docker'], {})

    def test_compose_owned_port_is_reusable(self):
        with patch.object(dev.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '0.0.0.0:8081\n', '')):
            dev.check_port('0.0.0.0', 8081, 'mobile', ['docker'], {})

    def test_lan_override_rejects_localhost(self):
        with patch.dict(os.environ, {'LAN_IP': '127.0.0.1'}):
            with self.assertRaisesRegex(ValueError, 'phone-reachable'):
                dev.lan_address()
        with patch.dict(os.environ, {'LAN_IP': '192.0.2.10'}):
            self.assertEqual(dev.lan_address(), '192.0.2.10')


if __name__ == '__main__':
    unittest.main()
