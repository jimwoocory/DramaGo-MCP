# DramaGo MCP V1 — Relocation architecture decisions

> **Historical relocation intake record.** The contracts/fact/composition work described as future in this P0 document has now landed in the integrated DramaGo-MCP relocation baseline. See [P1-INTEGRATED-STATUS.md](P1-INTEGRATED-STATUS.md) for current implementation status. P0 invariants remain authoritative where not superseded.


Status: architecture and contract obligations for a bounded relocation. This branch contains contracts/docs/scripts/tests only; no Drama application, persistence or dispatcher implementation is delivered. Source selection and historical evidence are separated in [P0-SOURCE-BASELINE.md](P0-SOURCE-BASELINE.md).

Authority: the relocation `salvage-manifest.md` identified in that baseline supersedes the original documents' USVDS-hosted placement. Preserve their domain and recovery invariants, not their old repository topology or closure claims.

## ADR-001 — One product; new repository owns composition

DramaGo-MCP is the new product repository and composition root, built on the existing hardened Media foundation at `8f33226`. Users should see one DramaGo MCP entry and one project Workbench, not separate Story and Media products. This is a target release shape, not an endpoint delivered by this branch.

USVDS is an **external, frozen, read-only capability source**. Do not copy `dsh-plugin`, `core/usvd-v9`, host packaging, generated distributions or their build systems into the target. Stable stage/tool identifiers retain compatibility; retaining identifiers does not import the legacy host. Generic Media stays local and generic; do not duplicate it in a second implementation.

External capability consumption must eventually identify the exact source/artifact version and digest through an adapter. Floating branches, developer-machine absolute paths and direct imports from a mutable checkout are forbidden. Private source packages are not proof of published, verified release artifacts.

## ADR-002 — Composition and dependency direction

The future entry is `apps/dramago-mcp` **in the new DramaGo-MCP repository**, not in USVDS. It owns transport/lifecycle, authenticated context, scope and object authorization, input validation, explicit tool registration, dependency assembly, error mapping and observability. Handlers must not implement story logic, write domain tables directly or call Provider SDKs.

```text
Workbench / MCP client
  -> DramaGo composition root
     -> Drama application -> Drama repository ports
     -> local generic Media application adapter -> Media Core / workers / providers
     -> external frozen USVDS capability adapter
```

| Target boundary | Responsibility | Status in this contracts branch |
| --- | --- | --- |
| `packages/dramago-contracts/contracts` | Immutable fact schemas, examples and declarative catalog | Contract intake scope; package `@dramago/contracts` |
| `apps/dramago-mcp` | Single app/composition root | Future; selected source is only an internal dispatcher |
| `packages/dramago-application` | Domain commands, version/approval gates, orchestration | Future intake from `975464f` |
| `packages/dramago-persistence` | Domain repositories, transactions, projections and migrations | Future intake from `e3bcbf0` plus required baseline lookup merge |
| `packages/dramago-usvds-adapter` | Fixed-identity external capability boundary | Future port; no stage invocation here |
| `packages/story-development` | New-repository Story ownership | Reserved future; no P2 implementation |
| Existing Media packages | Generic application/core, contracts, storage, persistence, workers and providers | Hardened foundation retained at `8f33226` |

Same-process Media service assembly is preferred; workers may run separately. An internal MCP-over-MCP proxy is not required. Future app workspace membership and ESM package exports need deliberate setup. TypeScript project references do not validate unreferenced JavaScript; retain separate Node tests for selected ESM application/dispatcher code.

Generic Media packages must not import Drama application, Story, Canon, approvals, baselines or USVDS. Drama contracts do not become required fields on generic Media records. `@dramago/contracts` remains distinct from `@xiaoshuren/contracts`; `./contracts/*` and `./catalog` are JSON asset exports, not server registration.

## ADR-003 — Creative domain ownership and external stages

| Domain | Owns | Must not own |
| --- | --- | --- |
| Story Development | Direction, optional adaptation, audience/promise assumptions, relationships/Story Engine, planning Canon, complete causal master outline, season architecture and every episode outline in the declared scope, review and Planning Baseline | Formal screenplay, Job state or fee authorization |
| Script-USVDS integration | Stage 03 screenplay/Beat-to-scene trace; 04 Script Doctor, Mandatory Fail and accepted implementation continuity; per-episode Script Baseline | Unapproved planning changes, Provider operations or invented audience validation |
| Production | 05–09, CHAR/LOOK/SET/PROP locks, VIDEO/SHOT, directing/performance/cinematography, creative prompt compilation, QA, intent and result adoption | Media execution state, Provider SDKs or approval inferred from success |
| Generic Media | Model capabilities, Quote/Budget, Job, ProviderExecution, media Assets, security, storage, archival, reconciliation and cancellation | Drama stage orchestration, Canon, creative identities or adoption |

Story and Script share a DramaProject; Planning is an internal domain boundary, not a product handoff. Stage 01 remains conditional adaptation; stage 02 retains its Bible authority and legacy A/B behavior. New complete-outline coverage and Story orchestration belong to the new repository's reserved Story layer and adapter projections, **not edits or extensions to external 01/02**. A six-beat projection is not a complete causal outline.

Formal screenplay begins at 03 only after authorized complete-scope Planning approval; 03 consumes exact baseline/episode/outline/continuity versions, never `latest`. 04 retains Doctor-before-Continuity and Mandatory Fail precedence. 05–09 retain stable professional stage rules; 08 is a creative compiler, not a Media Provider Adapter. `target_model` and `public_model_id` remain distinct. Stage 09 controlled review is Production-only and does not become Story review.

Future `story-direction`, `story-master-outline` and `story-planning-review` skills are reserved new-repository work. Default execution is serial. Independent review evidence is required; a separate subagent is optional. Do not relax the frozen controller/01–08 ban on autonomous delegation. Later reviewers must be read-only, bounded in depth/time/budget, and unable to approve or submit media. Detailed gates are in [P0-USVDS-STAGE-MAPPING.md](P0-USVDS-STAGE-MAPPING.md).

## ADR-004 — Immutable baselines and five separate decisions

A Planning Baseline freezes the predeclared complete scope and ordered episode identities, direction/adaptation applicability, Bible/relationships/Story Engine/planning Canon, full master outline, season architecture, every episode outline, promise/reveal/continuity plan, exact artifact versions/hashes, schema/policy versions, review evidence and approval references. Reject missing/duplicate episodes, foreign/dangling references and unresolved blockers. Do not shrink scope retrospectively to pass.

A Script Baseline freezes one episode against the exact Planning Baseline, outline, screenplay hash, Beat-to-scene trace, Doctor/Mandatory Fail evidence, continuity input and accepted output, policy and authorized approval. Doctor PASS, Continuity CLEAR and approval must concern the same fixed candidate. An effective non-revoked Planning approval is required; a score or model answer cannot replace it.

Freeze the candidate manifest before approval. The approval transaction cannot exchange its contents. Revisions append new versions/baselines. Revocation appends an authorized decision and impact events for the exact owned predecessor; it does not mutate/delete content. A newer baseline does not automatically revoke an older one.

Keep these facts independently attributable and auditable:

1. Model review and evidence.
2. Authorized creative approval of the exact candidate/version/hash, with actor derived from authentication and explicit authority, not request text or Workspace membership.
3. Quote/fee/budget authorization: explicit confirmation or bounded, auditable preauthorization.
4. Provider success observation and internal Media Job success only after required archival.
5. Creative adoption/rejection of an exact ready candidate against a current authorized target.

**Review is not approval; creative approval is not cost authorization; Media success is not adoption.** Media success produces `review_required`, never automatic approval. Adoption writes Drama decisions/bindings, never Media Job state. A stale result retains Job/Asset/cost history without overwriting current creative content.

Reference-image generation requires an approved Script Baseline and reviewed/approved `asset_generation_plan`; it must not depend on unfinished 06–09. Video generation requires Script approval, asset locks, fixed 06/07, final 08 prompt, 09 QA and approved `video_production_package`. Neither plan grants spending authority.

## ADR-005 — Authority, persistence and projections

Professional USVDS rules remain authoritative only in the frozen external source. Generated distributions are derivations, not a second authoring source. New Story contracts/expansion belong in the new repository, without creating competing Bible authority. No external stage edit is authorized by relocation.

Future formal Drama facts use the **`dramago` schema**, preserving selected persistence SQL naming. Reuse the host PostgreSQL pool through injection, but do not merge Drama facts into generic Media tables. Media owns its execution/resource records; private object storage owns binary bytes; externalized large documents need immutable references/hashes. Queue delivery/acknowledgment is not business truth.

One project has one authoritative writer. Workbench, chat, Markdown, imported JSON and DOM snapshots are candidate inputs, projections or historical evidence. They cannot mint approvals or overwrite database facts. Preserve the `us-vertical-drama-workbench/v1` production subview inside a future project envelope; ship `review_required`/`media_executions` readers with compatible writers. Unsupported readers become read-only or refuse rather than discard facts.

Later writes require authenticated tenant/object authorization (denial throws), persistent idempotency, `expected_revision`/CAS, immutable appends and transaction-bound Audit/Outbox. Short transactions never await a model, human or external service. Shared infrastructure does not imply a universal repository/state machine: Workspace is not Project, Run is not Job, Baseline is not Job.version, planning Canon is not accepted script continuity, and CHAR/LOOK identity is not a file.

## ADR-006 — Media compatibility, cost and recovery

Preserve `quote_create`, `generate_image`, `generate_video`, `job_get`, `asset_get`: names, DTOs, errors and asynchronous meaning. No mandatory Drama fields and no `media_*` aliases. Additional declared Media tools require their own implementation/acceptance. `job_get` is not `dramago_run_get`.

The legacy `integrations/media-mcp` client is reference-only, not copied runtime. A future local adapter maps dispatcher `(input, auth)` to Media `(auth, input)` and positional read IDs. Convert outer snake_case DTO fields deliberately; preserve the nested request unchanged for hashing. Serialize Dates, omit private/undefined fields, and never expose storage keys. Output asset IDs and authorized access URLs need actual projections/services. Preserve Media error envelopes and thrown error semantics instead of applying a Drama error mapper to them.

Persist gate/input intent and original submission key first, quote/submit outside the Drama transaction, and bind the Job in a second transaction. A crash after submit but before binding must recover the original Job. Repeated clicks, disconnects and unrelated edits cannot cause another paid task. Explicit regeneration requires `generation_attempt` and fresh cost authorization. Preserve historical `usvds:q:` / `usvds:g:` keys unchanged; use versioned project-scoped domains for new intents.

Legacy auto-confirm and manifest-local reuse are not new budget authority or durable recovery. Keep conservative stale guards until a separately validated replacement exists. `unknown`/`reconciling` require original-task recovery, not normal resubmit. Expired URLs refresh access, never generation. Rollback preserves existing execution/cost facts and reconciliation; it is not provider cancellation or database time travel.

## ADR-007 — Delivery and production boundary

This branch neither implements nor certifies a runnable MCP server, Drama fact layer, DB migrations/CAS, Story skills, creative workflow, project Workbench, durable Media store or live provider chain. Selecting `975464f`/`e3bcbf0` does not complete those migrations. Retain hardened Media including the Core `beforeCreate` boundary; its reference in-memory application store is not a durable MediaApplicationStore.

No generic DAG, arbitrary state setter, agent swarm, recursive authoring, global identifier rename, multi-model compiler or host upgrade is introduced. Historical dirty ledgers, No-UI closure and source tests are not current acceptance. See [P0-ACCEPTANCE-GATES.md](P0-ACCEPTANCE-GATES.md) for static commands and separately blocked runtime/infrastructure/production gates; this document claims no test PASS.
