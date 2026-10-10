"""Run the real demo startup script without starting containers or touching local tiles."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

INFRA = Path(__file__).resolve().parents[1]


class RoutingDemoTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name in ('start_routing_demo.sh', 'lib.sh'):
            shutil.copy2(INFRA / name, self.root / name)
        tiles = self.root / 'valhalla/custom_files'
        tiles.mkdir(parents=True)
        for name in ('valhalla.json', 'valhalla_tiles.tar'):
            (tiles / name).write_text('test placeholder')
        (self.root / '.env').write_text(
            'PRODUCT_DB_PASSWORD=test-password\nAUTOMATION_PUBLISH_KEY=test-key\nAPI_PORT=8000\n')
        self.script('docker', '''
printf '%s\n' "$*" >> "$TEST_ROOT/docker.log"
case " $* " in
  *" port api 8000 "*)
    test "${PORT_LOOKUP_FAIL:-0}" = 0 || exit 1
    printf '%s\n' "$PUBLISHED_ADDRESS" ;;
esac
''')
        self.script('check_stack.sh', 'printf "%s\\n" "$*" >> "$TEST_ROOT/probes.log"')
        self.env = dict(os.environ, TEST_ROOT=str(self.root),
                        ENV_FILE=str(self.root / '.env'),
                        PATH=str(self.root) + os.pathsep + os.environ['PATH'],
                        PUBLISHED_ADDRESS='0.0.0.0:18000', API_PORT='18000')

    def script(self, name, body):
        path = self.root / name
        path.write_text('#!/bin/sh\n' + body + '\n')
        path.chmod(0o755)

    def run_demo(self, **env):
        return subprocess.run(['bash', str(self.root / 'start_routing_demo.sh')],
                              env=dict(self.env, **env), text=True, capture_output=True)

    def test_probe_uses_published_port_instead_of_dotenv_port(self):
        result = self.run_demo()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / 'probes.log').read_text().strip(),
                         'http://127.0.0.1:18000 --expect-routing valhalla --probe-route')
        self.assertIn('EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:18000', result.stdout)
        calls = (self.root / 'docker.log').read_text().splitlines()
        self.assertIn('--profile routing up -d --build --wait db valhalla api', calls[0])
        self.assertIn('--profile routing port api 8000', calls[1])
        self.assertNotIn(':8000', result.stdout)

    def test_specific_bind_is_used_for_probe_and_phone(self):
        for address in ('192.0.2.7:18001', '[2001:db8::7]:18002'):
            with self.subTest(address=address):
                result = self.run_demo(PUBLISHED_ADDRESS=address)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(f'http://{address} --expect-routing',
                              (self.root / 'probes.log').read_text())
                self.assertIn(f'EXPO_PUBLIC_API_URL=http://{address}', result.stdout)

    def test_ipv6_wildcard_probes_ipv6_loopback(self):
        result = self.run_demo(PUBLISHED_ADDRESS='[::]:18003')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('http://[::1]:18003 --expect-routing',
                      (self.root / 'probes.log').read_text())
        self.assertIn('EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:18003', result.stdout)

    def test_loopback_does_not_claim_phone_connectivity(self):
        for address in ('127.0.0.1:18004', '[::1]:18004'):
            with self.subTest(address=address):
                result = self.run_demo(PUBLISHED_ADDRESS=address)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('loopback only', result.stdout)
                self.assertNotIn('EXPO_PUBLIC_API_URL=', result.stdout)

    def test_failed_lookup_never_probes_or_reports_ready(self):
        result = self.run_demo(PORT_LOOKUP_FAIL='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('could not resolve', result.stderr)
        self.assertFalse((self.root / 'probes.log').exists())
        self.assertNotIn('ready', result.stdout)

    def test_invalid_endpoint_never_falls_back_to_default_port(self):
        for address in ('', 'not-an-address', '0.0.0.0:0', '0.0.0.0:8000\n[::]:8000'):
            with self.subTest(address=address):
                result = self.run_demo(PUBLISHED_ADDRESS=address)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('could not resolve', result.stderr)
                self.assertFalse((self.root / 'probes.log').exists())
                self.assertNotIn('ready', result.stdout)


if __name__ == '__main__':
    unittest.main()
