# 028. Automatically deploy passing main commits to Vultr

- Status: Accepted
- Date: 2026-10-10

The operator requested that Vultr follow every push to `main`. `Lane checks` therefore runs on
all pushes while retaining component-level path filters. A separate `Deploy Vultr` workflow runs
only after a successful same-repository push to main finishes those checks. It checks out that
run's exact SHA and validates contracts before loading deployment credentials, so the separate
Contracts workflow cannot race the deploy gate.

The deployment workflow is serialized with cancellation disabled. Validation runs still cancel
when superseded. Stale deployment candidates are skipped if they no longer equal main when the
job starts or immediately before deploy. A deployment already underway finishes before the next
one starts; newer passing main eventually replaces it. No PR workflow or artifact is trusted with
deployment credentials.

Use a dedicated SSH key in the GitHub Actions secret `VULTR_DEPLOY_SSH_KEY`, append its public half
to the deploy user's authorized keys, and pin the previously verified server host key through
`VULTR_KNOWN_HOSTS`. The operator's personal key stays local. Deploy access remains privileged:
the existing deploy user can manage Docker. Secret values never belong in git or job output.

Reuse the existing release script, pre-deploy database backup and HTTPS/route acceptance probes.
If deploy fails, explicitly restart `current` through rollback.sh; always report the job as failed,
even when recovery succeeds. Database migrations are not reversed. Do not run demo writes or resets
on every push. This deploys the hosted API stack; Expo Metro and phone installation remain separate.

No new actions or dependencies: reuse the repository's existing checkout v4 and setup-uv v6.
The workflow_run event and concurrency behavior follow the
[GitHub event reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
and [concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
