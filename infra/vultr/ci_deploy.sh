#!/usr/bin/env bash
# Called only after CI succeeds; preserve failure status even if recovery succeeds.
set -euo pipefail
TARGET="${1:?usage: ci_deploy.sh HOST COMMIT}"
SHA="${2:?usage: ci_deploy.sh HOST COMMIT}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected an exact commit SHA' >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
# Recheck after credential setup: never let an old queued run overwrite a newer main release.
git fetch --quiet origin main
if [ "$SHA" != "$(git rev-parse origin/main)" ]; then
  echo 'Skipped superseded main commit.'
  exit 0
fi
if "$HERE/deploy.sh" "$TARGET" "$SHA" --profile routing; then
  echo "Deployed $SHA"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf 'Deployed `%s` to Vultr; HTTPS and real-route probes passed.\n' "$SHA" >> "$GITHUB_STEP_SUMMARY"
  fi
else
  echo 'Deployment failed; attempting to restart the last known-good release.' >&2
  "$HERE/rollback.sh" "$TARGET" --current --profile routing || {
    echo 'Recovery failed; inspect the host and restore the application manually. Database was not rolled back.' >&2
  }
  exit 1
fi
