"""Exercise release selection and failure recovery without contacting a real host."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'vultr' / 'ci_deploy.sh'
SHA = 'a' * 40

class DeployCI(unittest.TestCase):
    def invoke(self, *, current=SHA, deploy_status=0, rollback_status=0):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copy(SOURCE, root / 'ci_deploy.sh')
            scripts = {
                'git': '#!/bin/sh\nif [ "$1" = rev-parse ]; then echo "$CURRENT_SHA"; fi\n',
                'deploy.sh': '#!/bin/sh\nprintf "deploy %s\\n" "$*" >> "$CALL_LOG"\nexit "$DEPLOY_STATUS"\n',
                'rollback.sh': '#!/bin/sh\nprintf "rollback %s\\n" "$*" >> "$CALL_LOG"\nexit "$ROLLBACK_STATUS"\n',
            }
            for name, content in scripts.items():
                p = root / name
                p.write_text(content)
                p.chmod(0o700)
            log = root / 'calls'
            env = dict(os.environ, PATH=f'{root}:{os.environ["PATH"]}', CURRENT_SHA=current,
                       CALL_LOG=str(log), DEPLOY_STATUS=str(deploy_status),
                       ROLLBACK_STATUS=str(rollback_status))
            result = subprocess.run(['bash', str(root / 'ci_deploy.sh'), 'campus-vultr', SHA],
                                    env=env, capture_output=True, text=True)
            return result, log.read_text().splitlines() if log.exists() else []

    def test_success_deploys_exact_sha_without_rollback(self):
        result, calls = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, [f'deploy campus-vultr {SHA} --profile routing'])

    def test_superseded_commit_never_touches_host(self):
        result, calls = self.invoke(current='b' * 40)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(calls, [])

    def test_failed_deployment_recovers_current_and_stays_failed(self):
        result, calls = self.invoke(deploy_status=1)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(calls[-1], 'rollback campus-vultr --current --profile routing')

    def test_failed_recovery_remains_visible(self):
        result, calls = self.invoke(deploy_status=1, rollback_status=1)
        self.assertEqual(result.returncode, 1)
        self.assertIn('Recovery failed', result.stderr)
        self.assertEqual(len(calls), 2)
