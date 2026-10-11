# 026. One-command local manual app

- Status: Accepted
- Date: 2026-10-10

## Decision

At the operator's request, `./infra/dev.sh` prepares and starts the manual app with one command:
PostGIS, product API, Valhalla and the Expo development server. Automation remains optional.
The launcher layers `infra/docker-compose.dev.yml` over the existing Compose file and preserves
its `infra` project identity, product database volume and existing secrets (decision 007).

Generate ignored, mode-600 credentials only for a new local database. Never replace existing
credentials or reset data to repair authentication. Build missing campus tiles in a separate
preparation step using the existing validation/promotion script; reuse tiles on normal startup.
A successful start requires persistent API health, a real route and a phone-addressed Expo manifest.

Expo runs as a non-root container with the locked development dependencies and verified fonts.
Only public API/Metro addresses enter it; no database or publication credentials. Detect the host
LAN address, allow `LAN_IP` override, and advertise it instead of a Docker network address.
This is local Expo Go development, not a signed app or hosted web dashboard. Re-run the command
after source changes to rebuild the image. Stop preserves volumes and leaves optional services alone.

## Rejected

A second Compose project that silently switches databases; regenerating passwords on each launch;
automatic data deletion; putting backend secrets in Expo; rebuilding tiles on every API startup;
requiring automation for manual operation.

## Supersedes

No production deployment decision. Adds a local development entrypoint; the base Compose profiles
and Vultr workflow remain available independently.
