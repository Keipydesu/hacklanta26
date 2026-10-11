# Local Expo container runtime review

Reviewed 2026-10-10 for the local Compose development server. No npm package versions or lockfiles
change. The existing SDK 57/MapLibre/font dependency reviews still apply.

The new runtime is official `node:24.21.0-bookworm-slim`, pinned to multi-platform digest
`sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553`.
It was already installed on the operator's machine; `node --version` confirmed v24.21.0.

Sources reviewed:

- [Node 24.21.0 release and commit list](https://nodejs.org/en/blog/release/v24.21.0):
  September 8 LTS release; includes OpenSSL 3.5.8 and Undici 7.29.1 updates. Reviewed the
  runtime/dependency changes, including certificate, crypto, DNS and buffer fixes.
- [Node security announcements](https://nodejs.org/en/blog/vulnerability) and
  [July 29 security fixes](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases):
  the latest listed security release for this line is 24.18.1, preceding this selected release.
  This is a check of published advisories, not a claim that every dependency is vulnerability-free.
- [Official Docker build recipe](https://github.com/nodejs/docker-node/blob/main/24/bookworm-slim/Dockerfile):
  Node project image provenance, project release-key verification and SHA256 verification of the
  downloaded Node archive; Debian packages and signed Yarn distribution setup. No third-party
  image publisher or new npm maintainer is introduced. No ownership transfer was apparent in
  these official release/image sources.

Rationale: an established LTS runtime compatible with the locked Expo engine requirements,
with the published security fixes and a reproducible image digest. It runs as the existing
`node` user; no Docker socket, host node_modules or server credentials are mounted. Fonts use
our existing Python checksum verifier in a separate build stage. No new application dependency,
install script or transitive npm version is added; `npm ci --include=dev` installs the existing lock.
Existing npm audit findings remain a separate follow-up (the earlier host install reported 22).

The container serves development bundles on the local LAN. It is not part of the production
HTTPS deployment. Validate manifest addresses and a native bundle when changing this image;
phone interaction remains a physical-device check.
