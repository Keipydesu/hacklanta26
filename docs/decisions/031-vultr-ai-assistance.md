# 031. Optional Vultr photo drafts and grounded route explanations

- Status: Accepted
- Date: 2026-10-10
- Supersedes: Decision 002's frozen endpoint set for the additive AI endpoints only;
  decision 023's category-only report draft now also supports an optional editable description.

The operator requested implementation of the proposed AI features using a model through Vultr.
This authorizes the coordinated A/C/0/G changes: canonical contracts, generated consumers,
product backend, mobile controls, private inference configuration and this documentation.
Existing reporting, routing, location, provenance and automation boundaries remain intact.

Use Vultr Serverless Inference, with backend-only credentials, configurable model and no GPU
provisioning. `qwen3.8-27b` advertises vision and JSON-schema output in the live catalog on this
date. Actual inference requires a private Inference key; catalog verification is not a smoke test.

Add GET `/v1/ai/status`, POST `/v1/ai/analyze-photo`, POST `/v1/ai/explain-route`. Photo analysis
never publishes: the rider reviews, optionally applies/edits a suggestion, then submits through
the unchanged manual endpoint/queue with a fresh location. Photos are transient, size-bounded
JPEGs; strip header metadata before forwarding. No inferred severity or AI routing scores.
Blank-key deployments hide optional controls. Failure is explicit and never interrupts manual work.

Route input is the displayed numeric comparison, omitting endpoints, geometry and hazard text.
The model chooses emphasis; local templates render the actual facts. This constrained generation
was selected over free-form output to prevent invented numbers, hazard causes or safety promises.
Cancel/ignore stale responses when photo/draft/comparison changes. Rate/concurrency limits and
bounded time/body/output keep this optional paid upstream independent of product health.

See [backend AI runbook](../../backend/AI.md) for capability sources, dependency review, configuration,
verification commands and outstanding live inference/device rehearsal.
