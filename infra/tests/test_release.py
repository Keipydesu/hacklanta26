"""Exercise the real remote deploy/rollback bodies with host commands stubbed out."""
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest

INFRA = Path(__file__).resolve().parents[1]


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for directory in ('shared/custom_files', 'releases', 'bin'):
            (self.root / directory).mkdir(parents=True)
        settings = (INFRA / '.env.example').read_text()
        settings = settings.replace('replace-with-local-development-password', 'test-password')
        settings = settings.replace('replace-with-local-development-publisher-key', 'test-key')
        settings = settings.replace('PRODUCT_HOSTNAME=localhost', 'PRODUCT_HOSTNAME=example.test')
        settings = settings.replace('API_BIND=0.0.0.0', 'API_BIND=127.0.0.1')
        settings = settings.replace('VALHALLA_URL=', 'VALHALLA_URL=http://valhalla:8002')
        (self.root / 'shared/.env').write_text(settings)
        self.script('bin/stat', 'echo 600')
        self.script('bin/df', 'printf "Avail\\n10G\\n"')
        self.script('bin/sleep', ':')
        self.script('bin/docker', '''
printf '%s\n' "$*" >> "$TEST_ROOT/docker.log"
case " $* " in *" ps "*) echo db ;; esac
''')
        self.env = dict(os.environ, TEST_ROOT=str(self.root),
                        PATH=str(self.root / 'bin') + os.pathsep + os.environ['PATH'])

    def script(self, path, body):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text('#!/bin/sh\n' + body + '\n')
        target.chmod(0o755)

    def remote(self, script, *args):
        body = (INFRA / 'vultr' / script).read_text().split("<<'REMOTE'\n", 1)[1]
        body = body.rsplit('\nREMOTE', 1)[0]
        body = body.replace('ROOT=/opt/campus', 'ROOT=' + shlex.quote(str(self.root)))
        body = body.replace('/tmp/campus-probe', str(self.root / 'campus-probe'))
        return subprocess.run(['bash', '-c', body, script, *args], env=self.env,
                              text=True, capture_output=True)

    def deploy(self, commit, tiles, fail=False):
        upload = self.root / 'releases' / (commit + '.new')
        (upload / 'infra/valhalla').mkdir(parents=True)
        (upload / 'RELEASE').write_text(commit)
        shutil.copy(INFRA / 'docker-compose.yml', upload / 'infra/docker-compose.yml')
        self.script(str(upload.relative_to(self.root) / 'infra/backup.sh'), 'echo backup.dump')
        self.script(str(upload.relative_to(self.root) / 'infra/check_stack.sh'),
                    'test ! -f "$TEST_ROOT/fail-probe"')
        for filename in ('valhalla.json', 'valhalla_tiles.tar', 'manifest.json'):
            (self.root / 'shared/custom_files' / filename).write_text(tiles)
        marker = self.root / 'fail-probe'
        if fail:
            marker.touch()
        else:
            marker.unlink(missing_ok=True)
        result = self.remote('deploy.sh', commit, '--profile', 'https', '--profile', 'routing')
        self.assertEqual(result.returncode == 0, not fail, result.stdout + result.stderr)
        return (self.root / 'current').resolve() if not fail else None

    def rollback(self):
        (self.root / 'fail-probe').unlink(missing_ok=True)
        result = self.remote('rollback.sh', 'auto', '--profile', 'https', '--profile', 'routing')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_rollback_uses_previous_tiles_after_staging_changes(self):
        first = self.deploy('aaaaaaaaaaaa', 'tiles-A')
        self.deploy('bbbbbbbbbbbb', 'tiles-B')
        (self.root / 'shared/custom_files/valhalla_tiles.tar').write_text('tiles-C')
        self.rollback()
        self.assertEqual((self.root / 'current').resolve(), first)
        self.assertEqual((first / 'infra/valhalla/custom_files/valhalla_tiles.tar').read_text(), 'tiles-A')
        last_command = (self.root / 'docker.log').read_text().splitlines()[-1]
        self.assertIn(str(first / 'infra/docker-compose.yml'), last_command)

    def test_failed_same_commit_redeploy_preserves_current_tiles(self):
        first = self.deploy('aaaaaaaaaaaa', 'tiles-A')
        self.deploy('aaaaaaaaaaaa', 'tiles-B', fail=True)
        self.assertEqual((self.root / 'current').resolve(), first)
        self.rollback()
        self.assertEqual((self.root / 'current').resolve(), first)
        self.assertEqual((first / 'infra/valhalla/custom_files/valhalla_tiles.tar').read_text(), 'tiles-A')

    def test_successful_same_commit_redeploy_retains_previous_snapshot(self):
        first = self.deploy('aaaaaaaaaaaa', 'tiles-A')
        second = self.deploy('aaaaaaaaaaaa', 'tiles-B')
        self.assertNotEqual(first, second)
        self.assertEqual((self.root / 'previous').resolve(), first)
        self.rollback()
        self.assertEqual((self.root / 'current').resolve(), first)

    def test_default_compose_keeps_existing_volume_and_project_override(self):
        for override, expected in (([], 'infra'), (['-p', 'custom-project'], 'custom-project')):
            result = subprocess.check_output(
                ['docker', 'compose', '--env-file', str(INFRA / '.env.example'),
                 '-f', str(INFRA / 'docker-compose.yml'), *override, 'config', '--format', 'json'],
                text=True)
            config = json.loads(result)
            self.assertEqual(config['name'], expected)
            self.assertEqual(config['volumes']['product-data']['name'], expected + '_product-data')


if __name__ == '__main__':
    unittest.main()
