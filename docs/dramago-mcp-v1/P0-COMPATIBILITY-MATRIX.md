# DramaGo MCP V1 — Relocation compatibility matrix

> **Historical relocation intake record.** The fact layer and composition described below as future work have now landed in the integrated DramaGo-MCP relocation baseline. See [P1-INTEGRATED-STATUS.md](P1-INTEGRATED-STATUS.md) for current implementation status. P0 invariants and exclusions remain authoritative where not superseded.


Status: historical P0 compatibility requirements and attributed source observations, not production runtime certification. The integrated DramaGo-MCP baseline now includes the relocated Drama application, persistence, and internal dispatcher; current status is recorded in [P1-INTEGRATED-STATUS.md](P1-INTEGRATED-STATUS.md).

## 1. Boundary and provenance

The new DramaGo-MCP repository owns composition on hardened Media `8f33226`. Contracts were selected from `8ef5218`; application `975464f` and persistence `e3bcbf0` were the relocation sources and have now been integrated into the current baseline. USVDS remains external frozen read-only; its host, canonical stage tree and generated distributions are not target dependencies to copy.

Historical observations below are preserved from the six P0 source documents and relocation salvage manifest, not newly executed behavior. Old `93bf3ba` / `a1f3af1` catalog metadata describes naming and original consumer evidence. It is not current acceptance, a dependency path or a claim that public handlers run. Preserve IDs without preserving the former product placement.

## 2. Compatibility matrix

| Surface | Reference behavior or identity | Target requirement | Refusal / acceptance evidence |
| --- | --- | --- | --- |
| Contract package and JSON assets | Source `core/dramago-mcp/contracts/` defines offline schema IDs, versions, relative refs, examples and declarative tools | Relocate to `packages/dramago-contracts/contracts`; independent `@dramago/contracts`, exports `./contracts/*` and alias `./catalog`; keep IDs and example identities/digests | No collision with `@xiaoshuren/contracts`; no remote schema fetch or runtime registration inferred from exports |
| Legacy `APPROVED`, `PASS`, `CLEAR`, `LOCKED` | Stage text is professional evidence, not authenticated Approval | Preserve raw text, provenance and diagnostics; absent formal evidence import as `legacy_unverified`; new approval binds exact candidate/hash and real evidence | No fabricated actor/date, baseline, spend authority or adoption from old strings/model/UI text |
| `us-vertical-drama-workbench/v1` | Legacy episode production reader handles assets/videos/shots/tasks and some shot-only shapes; importer can infer readiness/prompts | Keep production subview in a future project envelope; retain original data/unknown additive fields alongside normalized projections | Parsed `ready_to_generate`, `independent` and synthetic prompts are not server eligibility; unsupported readers become read-only or refuse |
| `media_executions` / `review_required` | V10 uses `usvd.media-execution/v1` and keeps creative state distinct from execution | Pair compatible readers/writers; retain execution ID, request key, revision, source/target, Quote/Job/Asset links and status; absent optional old array remains readable | No lossy writeback, dropped history, or mapping review-required to approved/ready/draft |
| Legacy project identities | EP/CHAR/LOOK/SET/PROP/VIDEO/SHOT and Job/Asset IDs precede formal project records | Add owned project-scoped mappings and immutable imports; retain source bytes/history and exact IDs/keys | Reject ambiguous Workspace/project ownership; no mass rebinding to `latest` or repeat-import executions |
| Existing five Media names | V10 narrow consumer contract, not proof of target MCP server | Preserve DTO/error/async behavior for media-only clients; no Drama fields or `media_*` aliases | Separate real handler/auth/scope tests; generic results cannot change Drama approval |
| Additional five Media names | Catalog reserves models, upload/confirm and cancellation operations | Preserve declarations and per-tool policy; enable only separately implemented/accepted handlers | Internal methods or design docs do not establish public MCP registration |
| 01–09 stages/controller | External professional skills retain stable IDs, 02 A/B modes, 03/04 writing review and 05–09 production | Adapter supplies fixed-version projections and gates; new Story coverage lives in reserved new-repository work | No edits to external 01/02, copied stage tree, self-approval or Stage 08 Provider submission |
| Stage 09 reviewer | Local opt-in Production contract; source presence historically did not mean No-UI registration | Preserve machine PASS, explicit trigger, bounded read-only reviewer and local result meaning | Not Story review, not durable Run by implication, not a callable target handler in this branch |
| Future application/persistence | Security source and hardened persistence are complementary selections | Merge baseline-version lookup requirements without losing persistence locking/recovery; keep `dramago` SQL ownership | Separate target tests required; selecting sources is not migration completion |
| Hardened Media | Target already starts at `8f33226`, including application/Core boundary | Retain in place; generic dependencies and quote/spend/client binding policy remain intact | Do not downgrade Core or call reference in-memory Media store durable |

## 3. Five-tool wire floor and adapter obligations

The source client accepted direct result objects or SDK `structuredContent`. Keep the public contract, not the legacy implementation dependency. A new local adapter belongs beside the future composition root; `integrations/media-mcp` remains reference-only and is not copied.

| Tool / narrow port | Preserved request semantics | Preserved response semantics |
| --- | --- | --- |
| `quote_create` / `quoteCreate` | Write idempotency, optional `workspace_id`, `public_model_id`, generic `request` | Quote ID, request hash, defined cost/expiry/pricing/confirmation facts; not creative approval |
| `generate_image` / `generateImage` | Write idempotency, optional Workspace, `quote_id`, `request_hash`, `confirm_quote: true`, image request | Asynchronous Media `job_id`/status and Quote/request references; not an image returned synchronously or creative adoption |
| `generate_video` / `generateVideo` | Same quote/confirmation boundary, preserving video mode/prompt/duration/ratio/resolution/input assets | Asynchronous Media Job, not a Creative Run |
| `job_get` / `jobGet` | Optional Workspace and `job_id` | Real Job status, `output_asset_ids`, errors/retry facts/timestamps; never interpreted as `dramago_run_get` |
| `asset_get` / `assetGet` | Optional Workspace, `asset_id`, optional `include_access_url` | Authorized identity/readiness/metadata and optional expiring URL; URL refresh never regenerates |

Media write keys retain the contract's 16–128 character idempotency rule; no public Drama `expected_revision` is added. Optional `workspace_id` does not make authentication or tenant/object ownership optional. Preserve same-key/different-payload `IDEMPOTENCY_CONFLICT` and structured error semantics.

Preserve Job states `queued`, `submitting`, `submitted`, `running`, `unknown`, `reconciling`, `cancel_requested`, `cancelled`, `succeeded`, `failed`. Do not turn uncertain submission into ordinary paid retry. Provider success is not internal success before archival; internal success is not adoption. Cancellation requested is not cancellation confirmed or a refund.

Future wiring must translate dispatcher `(input, auth)` to application `(auth, input)` with positional IDs for reads. Map outer snake_case fields to camelCase while retaining the nested request unchanged for hashing. Serialize Dates and omit private/undefined fields; never expose internal storage keys. Authorized asset access/output projections must be real, not fabricated. Preserve Media envelopes and thrown errors rather than passing them through the Drama error mapper.

## 4. Preserve legacy safeguards without inheriting their limits as policy

- `target_model` is a creative/display label. Generation requires a separately explicit `public_model_id`; the label cannot silently choose a Provider route.
- Old keys use episode, target, whole-workbench revision, request hash, operation and model. They omit Workspace/Project; preserve `usvds:q:` / `usvds:g:` historical bytes, never recompute them during migration.
- Manifest-local reuse is not persistent idempotency. Whole-workbench edits can change old keys; new durable intents must prevent unrelated edits from creating another paid attempt.
- Legacy stale checking can reject before `jobGet`, using `STALE_WORKBENCH_REVISION` or `TARGET_STATE_CHANGED`. Preserve writeback protection, but implement later historical query/reconciliation independently so stale jobs remain observable.
- Succeeded jobs need ready archived Assets before candidate binding; image/video targets become `review_required`. Never overwrite an approved target or automatically adopt a result.
- The source helper's direct `confirm_quote: true` is historical behavior, not the new spending boundary. Require explicit confirmation or valid bounded auditable Workspace preauthorization, separate from creative approval.
- Supplied-manifest revision comparison is not database CAS. New fact-layer authorization, expected revisions, transaction/Audit/Outbox and recovery need independent implementation and tests.

## 5. Historical DSH packaging is not a target gate

The old selected No-UI profile was `dramago-p0-no-ui/v1`, package `@jimwoocory/dsh-us-vertical-drama-studio@0.4.0-v9-preview.1`. Historical exports `.` / `./media-mcp` and absence of `./client` described a DSH artifact, not the new contract package. The old exact peers and Node `>=24`, UI bundle expectations, selected plugin/marketplace generation and deferred direct-upload/Tabbit/MediaGo surfaces remain source evidence only.

Do not import `dsh-plugin` or its host peers, client bundles, model-routing host wiring, Cordis patch, generated distributions or distribution synchronizers. Do not run `test:p0:no-ui`, source-intake ledger or old compatibility closure as target acceptance. A future project Workbench needs its own shipped artifact/reader/endpoint evidence; No-UI source closure cannot establish it.

The historical dirty ledger and closure documents describe a different checkout and accepted profile. This document does not carry their counts, PASS/FAIL results or closure into the target. External USVDS packaging changes require separate authorization. The target `@dramago/contracts` engine is `>=22`; old engine limitations are not inherited or retroactively waived for USVDS.

## 6. Evidence required on the target

Run and report the commands in [P0-ACCEPTANCE-GATES.md](P0-ACCEPTANCE-GATES.md): separate contract static/fixture and Node suites, existing Media test/typecheck/build, and whitespace checks. This document reports no execution result.

Later integration must prove exact-reference approval/revocation, reader round-trips without loss, typed import refusal, media-only DTO parity, authorization and stale writeback rejection, original-key recovery, migration/restart/rollback and truthful advertised handler allowlists. Fake client fixtures prove local contracts only; source-suite passes, PostgreSQL doubles and historical provider tests do not prove deployed transport, durable storage, real locking, authenticated Remote MCP or the Workbench adoption chain.
