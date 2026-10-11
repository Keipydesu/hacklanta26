#!/usr/bin/env bash
# One-command local manual app: PostGIS, product API, real routing and Expo.
set -euo pipefail
exec python3 "$(dirname "$0")/dev.py" "$@"
