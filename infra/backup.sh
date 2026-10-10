#!/usr/bin/env bash
# Dump one dataset from the running db container.
#   infra/backup.sh [product|observations] [OUTPUT_DIR]
# Writes <dataset>-<UTC time>-<commit>.dump (pg_dump custom format, mode 600) plus a .json
# sidecar. A backup only counts once infra/restore_check.sh has restored it.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
DATASET="${1:-product}"; OUT_DIR="${2:-$INFRA_DIR/backups}"
case "$DATASET" in product|observations) ;; *) die "dataset must be product or observations" ;; esac
mkdir -p "$OUT_DIR"; chmod 700 "$OUT_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
commit="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || cat "$REPO_DIR/RELEASE" 2>/dev/null || echo unknown)"
file="$OUT_DIR/$DATASET-$stamp-$commit.dump"
umask 077
compose exec -T db pg_dump --username product --format custom --no-owner "$DATASET" > "$file.partial"
[ -s "$file.partial" ] || { rm -f "$file.partial"; die "backup of $DATASET is empty"; }
mv "$file.partial" "$file"
printf '{"dataset":"%s","created":"%s","commit":"%s","bytes":%s}\n' "$DATASET" "$stamp" "$commit" "$(wc -c < "$file" | tr -d ' ')" > "$file.json"
echo "$file"
