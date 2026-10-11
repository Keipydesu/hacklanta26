# Vultr manual demo handoff

Verified 2026-10-11 UTC (2026-10-10 evening in Atlanta).

Public API: **https://144-202-21-20.sslip.io**. Check [/healthz](https://144-202-21-20.sslip.io/healthz);
the root path deliberately returns 404. This is the native app's backend, not a browser UI.

## Release and host

- Exact deployed main: `63d55281dc50a8c80693911f28f8ca68288b65c1`.
  [Contracts CI](https://github.com/Keipydesu/hacklanta26/actions/runs/38097662986) and
  [lane CI](https://github.com/Keipydesu/hacklanta26/actions/runs/38097662849) succeeded before deployment.
- Operator-provided Vultr host: `144.202.21.20`, Ubuntu 26.04.1 LTS, amd64,
  approximately 15 GiB memory and 203 GiB free disk before deployment.
- Profiles: `https`, `routing`. Services: API, PostGIS, Valhalla, Caddy. Automation is off.
- Host was already provisioned. Initial login worked as root; deployment prerequisites and the
  `deploy` user were configured over SSH. The cloud-init template itself was **not** exercised.
- Hostname uses sslip.io's IP-based DNS. Resolution and a trusted Let's Encrypt certificate were
  verified externally. This demonstration depends on that third-party DNS service and this IP.
- UFW permits SSH, HTTP, HTTPS TCP and HTTPS UDP. API publishes only on `127.0.0.1:8000`;
  database and routing ports have no host publication. No provider API token was needed.
- Secrets were generated on the host in `/opt/campus/shared/.env`, mode 600. SSH private keys remain
  on the operator's Mac. Do not commit personalized cloud-init keys or runtime environment files.

## Use the app

From a configured checkout with mobile dependencies installed:

```sh
EXPO_PUBLIC_API_URL=https://144-202-21-20.sslip.io npm start --prefix mobile -- --tunnel
```

Share the resulting Expo link/QR with a compatible Expo Go user. Expo tunnel delivery is a separate
step and was not started or verified in this deployment. It may require the Expo ngrok helper;
review any dependency before installation. The API runs independently of the laptop, but Metro/tunnel
must stay running until a native build is distributed. See [mobile setup](../mobile/README.md).

Routing covers the GSU campus extract, bbox `-84.40,33.74,-84.37,33.77`, not arbitrary cities.
Tiles built at `2026-10-11T01:03:49Z`; source Overpass OSM, SHA-256
`b24d5d090ad9e32aa83cc780ae7cee140d97e9776dcc2767fb8a8c98f228257b`.
Valhalla 3.9.1 validated a 0.588 km sample route before upload. Three clearly labeled deployment/live
update demo reports were created; they expire normally. No real ride traces were uploaded.

## Verified

- `deploy.sh ... --profile routing --demo`: public HTTPS, PostGIS health, hazard feed, unauthenticated
  publication rejection (401), root proxy boundary (404), real route, create/identical retry/read-back.
- The external Mac independently ran `check_stack.sh` with `--expect-storage postgis`,
  `--expect-routing valhalla` and `--probe-route`; all passed.
- Public WSS `/v1/live` connected, received the matching `hazards.changed` event after a report,
  disconnected, reconnected, and received a second matching report event.
- `backup.sh product /opt/campus/backups` and `restore_check.sh FILE` restored four application
  tables into a disposable database. The checked snapshot contained one report/hazard; two later
  WSS reports were created afterward. Backup stays on-host; no off-host disaster recovery is claimed.
- `rollback.sh ... --current --profile routing` passed in 2 seconds, retaining all three hazards.
  A separate real API process restart also retained the three hazards and returned healthy PostGIS.
  This verifies current-release recovery, **not** rollback between two different releases.
- External certificate verification succeeded; initial certificate expiry: 2027-01-09 00:08 UTC.

On the host, run operational commands with the runtime environment explicitly selected:

```sh
export ENV_FILE=/opt/campus/shared/.env
/opt/campus/current/infra/check_stack.sh https://144-202-21-20.sslip.io --expect-storage postgis --expect-routing valhalla --probe-route
/opt/campus/current/infra/backup.sh product /opt/campus/backups
/opt/campus/current/infra/restore_check.sh /opt/campus/backups/CHOSEN.dump
```

For a future release, use [deploy.sh](vultr/deploy.sh) with `deploy@144.202.21.20`, an exact passing
main SHA, and `--profile routing`. Load the matching private key in ssh-agent before using scripts.
The initial deployment used an external temporary SSH wrapper selecting that identity.
Retain release-specific routing tile snapshots; do not change the Compose project name `infra`.

## Host package review

Reviewed on 2026-10-11 before installation. Existing application manifests/images were retained;
no application dependency was upgraded. Host packages came from Docker's official HTTPS apt
repository, with signed metadata and signing-key fingerprint checked as
`9DC858229FC7DD38854AE2D88D81803C0EBFCD88`.

Installed exact packages:

| Package | Version |
|---|---|
| docker-ce, docker-ce-cli | `5:29.9.0-1~ubuntu.26.04~resolute` |
| containerd.io | `2.4.1-2~ubuntu.26.04~resolute` |
| docker-buildx-plugin | `0.37.1-1~ubuntu.26.04~resolute` |
| docker-compose-plugin | `5.5.1-1~ubuntu.26.04~resolute` |

Reviewed official [Ubuntu support/install instructions](https://docs.docker.com/engine/install/ubuntu/),
[Engine release/security changes](https://docs.docker.com/engine/release-notes/29/),
[containerd changes](https://github.com/containerd/containerd/releases/tag/v2.4.1),
[Buildx changes](https://github.com/docker/buildx/releases/tag/v0.37.1), and
[Compose changes](https://github.com/docker/compose/releases/tag/v5.5.1).
Engine 29.9.0 was selected for the documented HTTP/2 security fixes, including prior 29.8.2 registry
TLS verification fixes, rather than selecting an older vulnerable runtime. Containerd includes its
OCI index resource-exhaustion fix. Buildx and Compose use established patch releases; Buildx's patch
has no dependency changes. Release signatures/maintainers were consistent with official projects.
The downloaded Debian control scripts and dependency simulation were inspected: ordinary Docker
group/AppArmor/systemd integration, no extra installer downloads; five selected packages only,
with system libraries already present. Package artifacts/review material remain under
`/root/campus-package-review`; installation log is `/root/campus-docker-install.log`.

Runtime image digests recorded on the host:

| Image | Digest |
|---|---|
| Valhalla 3.9.1 | `sha256:4fd114eb1d26b8fc2f43bcb3df234c1b63a0bf13c277405e5943d5361dc575de` |
| Caddy 2.10.0 | `sha256:133b5eb7ef9d42e34756ba206b06d84f4e3eb308044e268e182c2747083f09de` |
| PostGIS 16-3.4 | `sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5` |

## Remaining

Physical two-phone rehearsal (including location denial/offline retry), Expo tunnel delivery,
previous-release rollback, automatic certificate renewal, off-host/scheduled backups and automated
hosting deployment remain unverified. The initial cloud-init template still targets Ubuntu 24.04;
this already-provisioned 26.04 host used Docker's supported 26.04 repository instead. Full metro
routing and automatic services were not deployed. A working HTTPS backend alone does not complete
the mobile acceptance gate.
