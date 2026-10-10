#!/usr/bin/env bash
# Add or remove the observation hostname from Caddy. The manual proxy configuration never
# contains it, so a stopped automation stack cannot break product HTTPS.
#   infra/enable_automation_proxy.sh on|off
set -euo pipefail
. "$(dirname "$0")/lib.sh"
case "${1:-}" in
  on)
    require_real_values OBSERVATION_HOSTNAME
    cp "$INFRA_DIR/caddy/automation.caddy" "$INFRA_DIR/caddy/enabled/automation.caddy" ;;
  off) rm -f "$INFRA_DIR/caddy/enabled/automation.caddy" ;;
  *) die "usage: $0 on|off" ;;
esac
if compose ps --status running --services 2>/dev/null | grep -qx caddy; then
  # Validate before reloading so a bad file never takes the product site down.
  compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null || die "Caddy configuration is invalid; not reloaded"
  compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
  note "Caddy reloaded"
else
  note "Caddy is not running; the change applies when the https profile starts"
fi
