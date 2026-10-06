# DramaGo MCP V1 — P0 Tool Catalog Freeze

Status: contract freeze only. This change adds no handlers, transport, persistence,
approval service or other P1 business runtime. The machine-readable authority for
names and per-tool policy metadata is
`packages/dramago-contracts/contracts/tool-catalog.v1.json`; this document explains its limits
and provides a local validator. Neither file is a runtime registration list or a
complete MCP input/output JSON Schema. Planned tools must not be advertised as
callable until their implementations and acceptance gates pass.

## 1. Sources, scope and precedence

DramaGo-MCP is the primary repository and composition root, on Media foundation
`8f33226`. Contracts are selected from `8ef5218`; see
[P0-SOURCE-BASELINE.md](P0-SOURCE-BASELINE.md). USVDS is an external, frozen,
read-only capability source (reference-only), not the product host.

Catalog `sources` metadata preserves historical pins `93bf3ba` / `a1f3af1`,
the meeting consensus, `integrations/media-mcp/index.js` and
`dsh-plugin/stage09-review-tool.js`. These are historical evidence only, not
local imports, target acceptance gates or newly wired handlers. Do not copy
those runtimes or generated distributions. Generic Media stays local and must
not acquire Story, Canon, screenplay approval or adoption dependencies.
Stage 08 stays creative Production compilation through the future external
adapter, not a Provider adapter. New Story ownership is in the new repository;
no external USVDS stages are modified by this intake.

Final meeting consensus section 7 is authoritative and supersedes role briefs.
The four canonical names are:

- `dramago_planning_review`
- `dramago_script_draft`
- `dramago_production_generation_prepare`
- `dramago_production_generate`

P0 registers no aliases (`registered_aliases` is empty); alternate brief names
are not public tools. No `media_*` synonyms are added. The meeting's
`dramago_production_step_run` and `dramago_production_package_approve` remain
explicit commands so production preparation does not hide plan execution or
creative approval inside a generic mutator.

## 2. Metadata interpretation

Every tool record includes `domain`, `maturity`, `mutability`,
`idempotency_required`, `expected_revision_required`, `authorization_class`,
`async_result_kind`, `invariant`, plus its group and implementation status.

Maturity is evidence/scope classification, not a deployment claim:

- `existing_contract`: a pinned consumer/local tool contract exists. For the five
  Media tools this is the V10 narrow client port, not proof of MCP handlers.
  Stage 09 is an existing opt-in local DSH tool, not a unified Remote MCP service.
- `planned_p0`: the five additional Media names are reserved by the Media P0
  specification, but are planned/not yet proven implemented as public MCP tools.
  The Media P0 milestone is distinct from this consolidation P0 freeze.
- `planned_p1`: all new Drama commands are post-P0 runtime work. This coarse label
  covers later Story/Production waves as well; it does not compress the meeting's
  P1/P2/P3 schedule into P1 or claim any new runtime is delivered here.

`mutability` is exactly `read` or `write` and describes domain side effects,
not authorization or the absence of token costs.
Story/Script reviews are writes because the new contracts create durable runs,
evidence and fixed candidate manifests. Stage 09 retains its existing read-only
review contract; its current input has no `idempotency_key` or
`expected_revision`, and P0 does not add either.

For new Drama writes, `idempotency_key` is required. Identical retries recover the
original semantic result; a changed normalized payload under the same key
conflicts. Namespace new keys by Workspace/project/command, except initial
project creation, which uses Workspace/command scope. All writes against existing
Drama aggregates require `expected_revision`; project creation has no existing
project revision. Even a first artifact revision belongs to an existing project
aggregate and must CAS its relevant pointer. Freeze and revoke append decisions
or change aggregate pointers, never mutate baseline contents.

Media writes retain the spec's `idempotency_key` requirement (16–128 characters)
and optional `workspace_id`; no Media tool acquires a public Drama
`expected_revision` field. Internal Media concurrency/CAS remains a separate
concern, not an excuse to alter these public contracts.

Authorization classes are normative P0 policy names, not evidence of implemented
OAuth or scope enforcement. The Media classes are the spec's exact scope strings.
Drama classes identify domain permissions rather than final OAuth scope spellings.
Resolve the actor from authentication, validate Workspace and project/object
ownership, and check the explicit approval/adoption/spend authority. Workspace
membership alone is not any of those authorities. Reads must enforce object
visibility too, including historical executions and signed asset URLs.

Async result kinds are defined in the JSON. `creative_run_id` means durable
`run_id` polled through `dramago_run_get`; `execution_id` is the Drama production
intent polled through `dramago_production_execution_get`; `media_job_id` is a
Media Job polled through `job_get`. Snapshot kinds query existing work only.
`media_asset_id` denotes upload/import/processing tracked with `asset_get`.
`none` denotes a direct result, not a promise of success or absence of side effects.
`controlled_review_result` is the existing awaited local Stage 09 response with
its host `run_id`; it is not yet a durable creative Run and must not be routed to
`dramago_run_get` without a future explicit integration.

## 3. Frozen tool records

In the tables, Idem means `idempotency_key` required and Rev means
`expected_revision` required. Each invariant is normative, even when its runtime
is planned. Implementation status is specified separately from maturity in JSON.

### A. project/version/approval/run

| Tool | Domain | Maturity | Mutability | Idem | Rev | Authorization class | Async result kind | Invariant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dramago_project_create` | project | `planned_p1` | write | yes | no | `workspace.project_create` | `none` | Create one Workspace-owned project and declared planning scope; never equate Workspace with Project or manufacture approved baselines. |
| `dramago_project_get` | project | `planned_p1` | read | no | no | `project.read` | `none` | Return authorized project/episode scope, baseline references and blockers without advancing any stage. |
| `dramago_artifact_get` | version | `planned_p1` | read | no | no | `project.read` | `none` | Resolve an authorized artifact and requested immutable version; downstream execution pins version IDs and hashes rather than latest. |
| `dramago_artifact_revision_create` | version | `planned_p1` | write | yes | yes | `project.artifact_write` | `none` | Append a typed text/structured candidate or legacy_unverified import; CAS the existing project/target, never set approved, Job status or formal media bindings. |
| `dramago_baseline_get` | version | `planned_p1` | read | no | no | `project.read` | `none` | Return immutable Planning/Script manifests and evidence with separate validity events; revocation never rewrites a baseline. |
| `dramago_approval_get` | approval | `planned_p1` | read | no | no | `project.read` | `none` | Read formal approval/rejection/revocation decisions separately from model reviews, budget authorization and Media success. |
| `dramago_approval_revoke` | approval | `planned_p1` | write | yes | yes | `project.approval_revoke` | `none` | Append an authorized revocation and impact events; block new downstream release without mutating frozen content or erasing in-flight Job/cost facts. |
| `dramago_run_get` | run | `planned_p1` | read | no | no | `project.read` | `creative_run_snapshot` | Query a creative run with fixed inputs, steps, outputs and errors; never reinterpret a Media job_id as a creative run_id. |
| `dramago_workbench_get` | project | `planned_p1` | read | no | no | `project.read` | `none` | Return a server-derived project projection retaining the us-vertical-drama-workbench/v1 production subview; imported ready labels grant no execution authority. |

### B. story

| Tool | Domain | Maturity | Mutability | Idem | Rev | Authorization class | Async result kind | Invariant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dramago_story_step_run` | story | `planned_p1` | write | yes | yes | `story.execute` | `creative_run_id` | Run one allowlisted Story step and explicit scope on fixed inputs; never auto-advance, write a formal screenplay or approve its own output. |
| `dramago_planning_review` | story | `planned_p1` | write | yes | yes | `story.review` | `creative_run_id` | Review the full declared planning scope and freeze evidence/candidate manifest with baseline_id; incomplete/timed-out review is not PASS and PASS is not approval. |
| `dramago_planning_baseline_approve` | story | `planned_p1` | write | yes | yes | `story.approve` | `none` | Approve the exact reviewed candidate/hash only after complete outline coverage, correct ownership and no blockers; no missing/duplicate episodes or opportunistic scope shrink. |

### C. script

| Tool | Domain | Maturity | Mutability | Idem | Rev | Authorization class | Async result kind | Invariant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dramago_script_draft` | script | `planned_p1` | write | yes | yes | `script.write` | `creative_run_id` | Stage 03 writes the target episode from an approved planning_baseline_id, outline and required continuity versions; no latest substitution or invented unapproved core planning. |
| `dramago_script_review` | script | `planned_p1` | write | yes | yes | `script.review` | `creative_run_id` | Stage 04 binds Doctor/Mandatory Fail evidence to the screenplay hash, then checks continuity after PASS; freeze a candidate, never grant formal approval. |
| `dramago_script_baseline_approve` | script | `planned_p1` | write | yes | yes | `script.approve` | `none` | Freeze an episode Script Baseline for the same screenplay with Doctor PASS, Continuity CLEAR and authorized approval; CAS continuity and retain the immutable Planning reference. |

### D. production

| Tool | Domain | Maturity | Mutability | Idem | Rev | Authorization class | Async result kind | Invariant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dramago_production_step_run` | production | `planned_p1` | write | yes | yes | `production.step_execute` | `creative_run_id` | Execute only an allowlisted 05-09 step with fixed upstream versions and per-step gates; Stage 08 stays creative compilation, not Provider submission or arbitrary state mutation. |
| `dramago_production_package_approve` | production | `planned_p1` | write | yes | yes | `production.package_approve` | `none` | Approve an exact reviewed asset_generation_plan or video_production_package under distinct gates; neither can impersonate the other or authorize spending. |
| `dramago_production_generation_prepare` | production | `planned_p1` | write | yes | yes | `production.prepare_quote` | `execution_id` | Validate an approved typed plan and Script Baseline, persist execution intent, obtain Quote and return input digest/cost/expiry; never submit a Provider job. |
| `dramago_production_generate` | production | `planned_p1` | write | yes | yes | `production.execute_spend` | `execution_id` | Submit only an existing execution_id after gate and Quote/budget authorization checks; repeat/recovery retains the original key/Job, while deliberate regeneration needs a new attempt and authorization. |
| `dramago_production_execution_get` | production | `planned_p1` | read | no | no | `project.read` | `execution_snapshot` | Query existing Job/Asset links, source versions, costs, stale and binding facts even when writeback is barred; no retry, regeneration or implicit adoption. |
| `dramago_production_result_review` | production | `planned_p1` | write | yes | yes | `production.result_adopt` | `none` | Adopt/reject a precise ready-media candidate after project/source/version/current-state checks; append Drama binding/decision only, never mutate Media Job or overwrite stale/approved targets. |
| `dramago_stage09_review` | production | `existing_contract` | read | no | no | `production.controlled_review` | `controlled_review_result` | Preserve opt-in, machine-QA PASS and explicit request/subjective-question trigger; one focused tool-free read-only reviewer, no parallel review, Story review, approval or media submission. |

### E. media

| Tool | Domain | Maturity | Mutability | Idem | Rev | Authorization class | Async result kind | Invariant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `quote_create` | media | `existing_contract` | write | yes | no | `media.quotes.create` | `none` | Preserve Quote request/response and idempotency contract; Quote/budget reservation is not creative approval or proof that a Quote service is implemented. |
| `generate_image` | media | `existing_contract` | write | yes | no | `media.generate.image` | `media_job_id` | Keep generic image request, Quote confirmation and Media Job semantics without required Drama fields; generation never mutates Drama approval state. |
| `generate_video` | media | `existing_contract` | write | yes | no | `media.generate.video` | `media_job_id` | Keep generic video request, Quote confirmation and Media Job semantics without required Drama fields; generation never mutates Drama approval state. |
| `job_get` | media | `existing_contract` | read | no | no | `media.jobs.read` | `media_job_snapshot` | job_get means Media Job, not creative Run; report actual status/output_asset_ids, and never turn unknown/reconciling into permission to resubmit. |
| `asset_get` | media | `existing_contract` | read | no | no | `media.assets.read` | `media_asset_snapshot` | Read a generic Media Asset and optional access URL, not a Drama creative identity; URL expiry triggers URL refresh, never regeneration or approval. |
| `models_list` | media | `planned_p0` | read | no | no | `media.models.read` | `none` | Planned/not yet proven implemented: list permitted image/video capabilities, availability and pricing versions; catalog presence is not generation success. |
| `models_get` | media | `planned_p0` | read | no | no | `media.models.read` | `none` | Planned/not yet proven implemented: read public_model_id capability/input schema/limits; no Story/Canon dependencies or fabricated availability. |
| `asset_create_upload` | media | `planned_p0` | write | yes | no | `media.assets.write` | `media_asset_id` | Planned/not yet proven implemented: create a scoped upload/import with controlled URL, inline bytes or upload session; no assumed chat attachment bridge or automatic Drama binding. |
| `asset_confirm` | media | `planned_p0` | write | yes | no | `media.assets.write` | `media_asset_id` | Planned/not yet proven implemented: confirm an owned upload receipt and initiate validation/processing; confirmation is neither guaranteed ready nor creative adoption. |
| `job_cancel` | media | `planned_p0` | write | yes | no | `media.jobs.cancel` | `media_job_id` | Planned/not yet proven implemented: request cancellation of an owned Media Job; cancel_requested is not terminal cancellation, refund or Drama approval revocation. |

## 4. Domain gates and forbidden shortcuts

### Story and Script

`dramago_story_step_run` accepts only `direction`, `adaptation`, `bible`,
`master_outline`, `season_architecture`, or `episode_outlines`. Execute one
explicit step/range, not an arbitrary stage name, plugin, JSON action or hidden
advance-to-next-stage loop. Original material can make adaptation not applicable.
Story owns planning through approved complete episode outlines. Formal screenplay
writing begins in USVDS Stage 03, through `dramago_script_draft`.

`dramago_planning_review` checks direction/Bible/master outline/season architecture
and every episode outline in the predeclared scope. Its completed run exposes
review evidence and a fixed candidate `baseline_id`. Approval binds that exact
candidate, item versions, hashes and evidence; the transaction cannot replace
candidate items. Missing or duplicate episodes, invalid ownership, unresolved
blockers or retroactively shrinking scope cannot produce an approved plan.

Script writing pins `planning_baseline_id`, `episode_id`, the approved outline
version and necessary preceding continuity versions. Stage 04 review applies
Script Doctor and Mandatory Fail rules, then continuity only after PASS. Script
approval requires Doctor PASS, Continuity CLEAR and an authorized decision for
the same screenplay, with continuity CAS. Planning and per-episode Script
Baselines are immutable Drama records, not Media Job versions.

`dramago_artifact_revision_create` is a typed candidate/import command, not a
backdoor state patcher. Imported `APPROVED` prose is `legacy_unverified`, not a
formal decision. Do not expose generic `stage_run`, `approval_decide`,
`baseline_approve`, `state_set` or arbitrary object-state writes.

### Production preparation, execution and adoption

Keep these separate: production step execution, typed creative package approval,
Quote preparation, cost-authorized submission, Job observation and creative
result adoption. `dramago_production_generation_prepare` means persist an execution intent
and obtain a Quote, not execute stages or silently approve a package. Quote
creation can reserve budget under Media policy; prepare is not a read-only price
peek and must never submit a Provider job.

The `dramago_production_step_run` allowlist is `05`, `06`, `07`, `08`, `09`, with
stage-specific prerequisites. It is not a general stage/state mutator. Stage 09
machine QA does not automatically delegate: the controlled reviewer remains
opt-in with its existing eligibility policy.

Two plan types avoid a reference-image dependency cycle:

- `asset_generation_plan`: approved Script Baseline plus reviewed, formally
  approved asset-generation plan; no requirement that unfinished 06–09 already
  exist just to generate Stage 05 reference images.
- `video_production_package`: approved Script Baseline, asset locks, fixed 06/07
  director package, Stage 08 final Prompt, Stage 09 QA, and formal production
  package approval.

Execute uses an existing `execution_id`, rechecks current gates and Quote
ownership/expiry/request digest, and requires explicit cost confirmation by
default. Automation is allowed only under valid bounded auditable Workspace
preauthorization. Model review and creative approval never imply spending
permission. Recovery, disconnects, unrelated edits and duplicate clicks retain
the original intent/submission key. `unknown`/`reconciling` must not trigger a new
paid submission. Deliberate regeneration requires a new explicit
`generation_attempt` and renewed authorization, without recalculating historical
request keys.

Media success plus ready archived Assets yields candidates in `review_required`,
not approved creative results. Before candidate binding or adoption, recheck
Workspace/project, exact source/target versions, revision, current approvals and
worker validity in the authoritative transaction. Stale results remain queryable
with Job/Asset/cost history but cannot overwrite the current version or an
already approved target. Result review can adopt/reject only the precise candidate;
it writes Drama decisions/bindings, never Media Job state. A generic Media result
must first acquire an authorized candidate relationship before it can be adopted.
Revocation prevents new downstream release; it does not erase charges or stop
in-flight reconciliation/archival by pretending the Job never existed.

### Existing Stage 09 exception

Keep `dramago_stage09_review`'s current inputs: `qa_gate=PASS`, `qa_summary`,
`trigger` (`user_requested` or `subjective_open_question`), `review_question`,
`stable_refs`, `required_evidence`. Output remains `provider`, host `run_id`,
`estimated_tokens`, `review_status`, `defects`, `return_to_stage`, `evidence`.
One focused read-only tool-free reviewer; no broad project inspection, parallel
review, autonomous stage execution or approval authority. Failed/unavailable
review is not PASS. This tool is Production-only, not Story review. Future
persistent evidence binding must preserve this local contract rather than
silently changing it into a generic asynchronous Drama state writer.

## 5. Media and adapter compatibility floor

The exact five preserved names are `quote_create`, `generate_image`,
`generate_video`, `job_get`, `asset_get`. The other five are expressly
planned/not yet proven implemented: `models_list`, `models_get`,
`asset_create_upload`, `asset_confirm`, `job_cancel`.

Existing narrow wire expectations remain:

| Tool | Existing request shape | Existing response meaning |
| --- | --- | --- |
| `quote_create` | `idempotency_key`, optional `workspace_id`, `public_model_id`, `request` | Quote including `quote_id`, `request_hash`; spec additionally defines cost, expiry, pricing and confirmation fields |
| `generate_image` / `generate_video` | `idempotency_key`, optional `workspace_id`, `quote_id`, `request_hash`, `confirm_quote: true`, `request` | Accepted Media `job_id`, status and Quote/request references; not a creative Run or adopted result |
| `job_get` | optional `workspace_id`, `job_id` | Media status, `output_asset_ids`, errors and timing; preserve unknown/reconciling/cancel states |
| `asset_get` | optional `workspace_id`, `asset_id`, optional `include_access_url` | Generic asset metadata/status and optional expiring access URL, not a creative identity |

These summaries do not replace the pinned contracts or narrow them to just the
fields consumed by V10. Preserve their input/output, error and async semantics,
including `IDEMPOTENCY_CONFLICT` for same-key/different-payload requests. Do not
require `project_id`, `planning_baseline_id`, Canon or other Drama inputs on any
generic Media tool. Generation may produce standalone media but can never mutate
Drama approval state. Provider success, internal archival success, Media Job
success and creative adoption remain distinct facts.

V10 already maps the five names, projects requests, derives stable request keys,
checks workbench revision and rejects stale/approved-target writeback. Success
moves creative targets only to `review_required`. Preserve those wire/error semantics in a future local Media adapter; do not
transplant the historical V10 client implementation.

V10 currently quotes and sends `confirm_quote: true` in one submit helper, using
manifest-based execution links and a workbench hash. It does not yet provide the
planned persistent prepare/execute split, project-scoped key isolation,
transactional CAS, full production gates or server-enforced budget authorization.
Its stale-sync refusal is not the planned historical execution query. Those are
later extensions, not claims about current behavior. Do not recompute old keys or
replace the adapter to make the frozen future catalog appear implemented.

The Media P0 spec's Quote is Workspace cost transparency/reservation, not a
consumer payment order. It must not be relabeled as consumer payment authorization.
No actual HTTP/MCP handler, OAuth/scope enforcement, durable Quote service or
Remote MCP end-to-end result is established by this catalog. Internal Media
Job/Provider/Asset code and historical Provider tests do not prove those services.
`FakeMediaMcpClient` tests are local adapter/contract regression evidence only.

## 6. Local validation and later acceptance

The mandatory unified check is `node scripts/validate-dramago-p0.mjs`. It now
enforces the frozen per-tool policy classes (including Drama authorization,
mutability, idempotency and revision), domain allowlists, maturity/async metadata,
and preserved five-media-tool invariants/boundary statements. Negative Node tests
exercise policy weakening; catalog presence still does not prove a live handler.

Run the independent target gates from the repository root:

```sh
pnpm check:dramago-contracts
pnpm test:dramago-contracts
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

The Node regression also checks documentation-table parity. No legacy DSH,
No-UI, source-intake or Stage 09 host tests are required by this target gate.
Results must be recorded from this checkout, not copied from source reports.
See [P0-ACCEPTANCE-GATES.md](P0-ACCEPTANCE-GATES.md) for the limits of these checks.

Later acceptance must separately demonstrate exact candidate/hash approval and
revocation, full-outline and Script gates, cross-project/Workspace denials,
revision conflict refusal, durable original-key recovery without duplicate
charges, stale-result isolation, five-tool DTO/error parity, genuinely wired
handlers and a single authenticated MCP endpoint. Static P0 validation does not
prove transport, durable storage, live Provider or Workbench end-to-end behavior.
