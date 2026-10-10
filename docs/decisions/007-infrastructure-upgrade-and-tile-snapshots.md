# 007. Preserve database identity and release-specific routing tiles

- Status: Accepted
- Date: 2026-10-10

## Decision

Keep the default Compose project named `infra`, including its existing
`infra_product-data` volume. Explicit project-name overrides must remain consistent
across upgrades. Main already persists reports; changing the project name would
silently select a new empty database.

Each deployment attempt receives a unique release directory and copies its serving
routing files from the shared upload staging directory. Even a redeployment of the
same commit keeps the prior release intact. Rollback selects that release's tile
snapshot as well as its code and proxy configuration. Uploads must finish before
deployment; retained releases require disk space for their own tile copies.

## Rejected

Renaming the default Compose project without migration; sharing a mutable routing
tile symlink across releases; replacing a known-good release on same-commit retry.

## Verification

`python3 -m unittest discover -s infra/tests -v` checks rendered Compose identity,
custom project overrides, tile isolation after later uploads, failed same-commit
redeployment, and successful same-commit rollback using the real remote shell
bodies with host commands mocked. Real Vultr/TLS deployment remains unverified.

## Supersedes

None.
