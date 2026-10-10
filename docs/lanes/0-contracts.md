# Lane 0: Contracts and independent skeletons

## Purpose and baseline

Freeze a usable boundary so every lane can develop without a live upstream. This plan follows
[the architecture](../../ARCHITECTURE.md), [roadmap](../ROADMAP.md), and
[delivery workflow](../decisions/001-mvp-delivery-workflow.md).
Stage 0 is implemented on [PR #1](https://github.com/Keipydesu/hacklanta26/pull/1), pending merge
at the time of this plan. Its APIs use memory, routes are fixtures, and the detector is a no-op.
Those skeletons are not persistence, navigation, sensing, or completion of milestones 1–2.

**Owns:** `contracts/`, `backend/app/schemas.py`; initial cross-lane scaffolding only until handoff.
After handoff, consumers belong to their lanes. Generating files in their paths requires a coordinated
change. Internal helper names below are proposed implementation seams, not new public APIs.

## Structure and dependency direction

```text
contracts/
  openapi.yaml                 canonical product HTTP schema
  automatic.openapi.yaml       canonical observation HTTP schema
  ws-messages.md               change hints and reconnect/refetch behavior
  fixtures/                    valid, invalid and lifecycle examples
  scripts/validate.py          offline specification and fixture checks
  scripts/publish_fixture.py   standalone HTTP bridge probe
  package.json                 reproducible TypeScript generation
backend/app/schemas.py         Python product request/response models
```

Product types are generated into `mobile/src/api/schema.d.ts` and
`automatic/service/product-api.d.ts`; observation types into
`automatic/collector/src/api/schema.d.ts`. The manual app carries its own generated types and
fixture copies and has no runtime dependency on `automatic/`. Python schemas must remain aligned
with OpenAPI; implementation validation supplements JSON Schema where cross-field constraints
cannot be expressed conveniently. Lane D owns its observation models; Lane B owns detector types.

Data flows from specification → validator/fixtures → checked-in generated types → independent
consumers. No consumer becomes the source of truth by changing its local model first.

## Boundary responsibilities

| Interface | Required behavior and verification |
|---|---|
| `POST /v1/reports` | UUID submission identity; new 201, identical retry 200, conflict 409, invalid 422. Omitted description normalizes to empty text. Preserve observation time and body across retries. |
| `PUT /v1/automatic/hazards/{external_id}` | Server-only bearer auth; stable public ID; positive increasing revisions; identical revision/body duplicates; stale or conflicting revision rejects. Resolution uses a complete higher-revision payload. |
| `GET /v1/hazards?bbox=` | Active unexpired polygons from both sources; source, evidence, counts and timestamps survive round trips. Bbox is `minLon,minLat,maxLon,maxLat`. |
| `POST /v1/route` | Origin/destination objects use lat/lon; response contains shortest and safest kinds, with lower-risk UI wording. Unavailable alternative duplicates shortest with `safest_available: false`; routing outage is 503. |
| `WS /v1/live` | `hazards.changed` is a refetch hint after committed change, not a delete instruction. Clients debounce visible-bounds refresh and refetch on reconnect. |
| Observation events/points | Separate base URL; limits 500 events/2000 points; stable UUIDs; identical items count as duplicates; conflicts reject the whole batch. Point identity includes its ride path. |
| Health | Product health depends on its API/database, independently of automation and routing availability. |

Object coordinates use `lat`/`lon`; GeoJSON uses `[lon, lat]`. Times are timezone-aware, observation
measurements finite and nonnegative, and future observations over five minutes are rejected.
Manual expiry is observation plus 24 hours; expired queued reports may be accepted but stay off the
active map. Automatic publications retain their supplied valid lifecycle. Manual and automatic
records never merge or overwrite one another. Unknown sensor speed stays internal until the
collector has contract-valid measurements. Public endpoints expose aggregates, never ride traces.

## Methods and how to implement them

The existing stage-0 scripts remain the entrypoints. Refactor helpers only when it makes a needed
contract change easier to verify; do not rewrite working scaffolding as a separate milestone.

| Proposed helper | Responsibility and method |
|---|---|
| `load_spec(path) -> dict` | Parse YAML and validate OpenAPI structure; report the file and invalid schema path. No network resolution during routine checks. |
| `validate_fixture(spec, schema_name, payload) -> list[error]` | Resolve local schema references and validate a fixture against the named request/response schema. Valid fixtures must pass; negative fixtures must fail for their intended field. |
| `validate_fixture_set(manifest) -> None` | Associate each fixture with API/schema and expected validity. Check every listed example, failing on missing files or accidental untested additions. A manifest can stay in validator code until its size warrants a file. |
| `assert_schema_parity(openapi, model_schema) -> None` | Compare required fields, enums, nullability and bounds for Python models; exercise runtime-only timestamp/geometry rules in the owning API tests. |
| `prepare_publication(template, run_time) -> payload` | Shift related timestamps together once for a fresh demo invocation; retain an immutable body for retries. Never shift an in-flight retry. |
| `publish_lifecycle(client, external_id, payload) -> result` | Execute create, identical retry, newer update, stale rejection, and resolution; assert status and stable hazard ID through HTTP. Keep key in environment and redact it from output. |

Fixtures should include manual create/retry/conflict/expired/invalid, automatic
create/retry/update/stale/conflict/resolved/expired/invalid, combined feed, route response, and
observation duplicate/conflict/invalid cases. Use the fixed GSU fixture clock for offline checks;
live/demo clients shift time once at the run boundary. Route lines remain labeled illustrations.
Deterministic fixture comparison must not confuse example IDs with server-assigned public IDs.

## Ordered delivery slices

1. **Adopt the stage-0 boundary (milestone 0).** Review PR #1 schemas, fixtures, scripts and generated
   consumers together; use its contract decision and handoff after merge. Verify the commands below.
   Exit when each lane can run its fixture path independently. Do not recreate the existing stubs.
2. **Hand off consumers.** Record product versus observation URLs, generated destinations and
   commands, fixture clock, error cases and remaining device checks. A/C own manual queue and DB;
   B/D own detector and worker; G owns real deployment. Exit when there is no implied Lane 0
   implementation responsibility for later milestones.
3. **Support milestones 1–2 without broadening the API.** Reproduce a consumer mismatch against
   a fixture and the canonical schema. If the implementation is wrong, hand it to the owner. If the
   contract is insufficient, write a concrete cross-lane proposal covering affected requests,
   responses, compatibility and fixtures; obtain coordinated approval before changing the boundary.
4. **Support milestones 3–4 similarly.** Verify the fixture publisher proves the bridge before real
   sensing. Any accepted boundary change updates specs, Python schemas, fixtures, generated outputs
   and affected plans in the same coordinated change; downstream owners review their outputs.

Keep each future change small. A proposed helper or richer fixture is not an instruction to build
an unused testing framework. Contract stability and useful examples are the deliverables.

## Verification and handoff

After stage 0 is available, run from the repository root:

```sh
uv sync --project contracts --frozen
uv run --project contracts python contracts/scripts/validate.py
npm ci --prefix contracts
npm run generate --prefix contracts
git diff --exit-code -- mobile/src/api/schema.d.ts automatic/collector/src/api/schema.d.ts automatic/service/product-api.d.ts mobile/src/fixtures automatic/collector/src/events.json automatic/collector/src/points.json
python3 contracts/scripts/publish_fixture.py --dry-run
```

Generation writes consumer paths: coordinate ownership and hold the stick in a shared room.
For live verification use a dedicated demo API with `AUTOMATION_PUBLISH_KEY` in the server and
CLI environments, then `python3 contracts/scripts/publish_fixture.py --lifecycle`; use a fresh
external UUID for a fresh run. Never commit the key or put it in Expo configuration.

Schema checks alone cannot prove transactions, expiry races or revision ordering. The owning API
and mobile behavior tests cover those invariants, including delayed viewport responses and an
expiry notification racing with reactivation (stage-0 decision 003). CI checks generation drift;
run local checks only for the boundary being changed.

A handoff states what works, exact commands and results, upstream PR dependencies, schema changes
(if any), and what remains stubbed. No DB, sensor, outbox, routing-engine or deployment work is
assigned to Lane 0 after handoff. Physical-device verification remains an explicit Lane A/B task.
