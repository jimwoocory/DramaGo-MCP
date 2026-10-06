# DramaGo MCP V1 — Relocation, migration and rollback policy

> **Historical relocation intake record.** The fact layer and composition described below as future work have now landed in the integrated DramaGo-MCP relocation baseline. See [P1-INTEGRATED-STATUS.md](P1-INTEGRATED-STATUS.md) for current implementation status. P0 invariants and exclusions remain authoritative where not superseded.


Status: bounded contract intake and future operational runbook. No database migration, cutover, runtime transplant or rollback has been executed by this documentation change. This branch delivers contracts/docs/scripts/tests, not Drama application/persistence/dispatcher or P2 runtime.

## 1. Source selection is not implementation

Use the exact role pins in [P0-SOURCE-BASELINE.md](P0-SOURCE-BASELINE.md) and the relocation salvage manifest. The target already contains hardened Media `8f33226`: retain it in place. Transplant contracts from `8ef5218`; later application selection is `975464f`, later persistence selection `e3bcbf0`. Neither selected P1 branch is a complete substitute for the other.

The new DramaGo-MCP repository owns composition. USVDS is external frozen read-only capability source. Do not copy `dsh-plugin`, `core/usvd-v9`, legacy integration client, host packaging, UI bundles, generated distributions, caches, dependencies or dirty archives. DROP in the salvage manifest means exclude from target intake, not delete from external USVDS. No bulk cherry-pick of either P1 branch is authorized by this document.

Local worktree paths are evidence locations only. A future immutable release manifest must identify accepted commits, packages/artifact digests, external capability identity, schema/policy/migration versions, compatible reader/writer/worker set and rollback target. Historical dirty ledgers and closure records are reference-only, not accepted target payload or current validation results.

## 2. Bounded intake now; targeted merge later

### Current contracts batch

1. Retain the hardened Media foundation without overwriting unrelated workspace/lockfile changes.
2. Copy the complete selected contracts tree to `packages/dramago-contracts/contracts`, preserving schema IDs/versions, references, example identities/digests and canonical tool names.
3. Introduce independent `@dramago/contracts` metadata (`>=22`, `./contracts/*`, `./catalog`); do not merge Drama facts into `@xiaoshuren/contracts`.
4. Adapt only the three selected static scripts, relocated Node contract test and seven migration documents. Drop legacy source-intake/No-UI/distribution gates from target acceptance.
5. Run the target commands in [P0-ACCEPTANCE-GATES.md](P0-ACCEPTANCE-GATES.md) and record results before acceptance. This runbook does not assert they passed.

### Later fact-layer/composition intake obligations

| Selection | Preserve and adapt | Prohibited shortcut |
| --- | --- | --- |
| Application from `975464f` | Authenticated actor/evidence checks; real review artifacts/exact subjects; effective Planning approval before Script approval; exact predecessor/ownership revocation; frozen run resolution/digests; artifact envelope rejection; authorization denial throws | Do not substitute older persistence-branch services or reintroduce project-only workbench masquerading as complete projection |
| Persistence from `e3bcbf0` | Replay serialization, READ COMMITTED lookup after transaction-scoped advisory lock, same-transaction fact/replay/audit/outbox, nested transaction rejection, JSON-safe storage, exact revocation target and serialized stale journal-lock recovery | Do not overwrite hardened adapters with application-branch versions |
| Mandatory cross-source merge | Add `getBaselineByVersion(versionId, projectId)` from application source to memory and PostgreSQL adapters; journal inherits memory behavior | Do not drop baseline-resolution regressions or assume D/P separate passes prove combined behavior |
| Dispatcher from application source | Internal descriptors/listTools/callTool, explicit handler allowlist and `declared_unimplemented` behavior; adapt catalog location | Not an executable MCP server; do not advertise workbench/P2 or expose createRun/updateRun merely because internal methods exist |
| Local Media adapter | Correct auth argument order, outer DTO translation with nested request unchanged, deliberate public output/access projections and error semantics | Do not copy `integrations/media-mcp`, invent asset/access results or inherit legacy auto-confirm as authority |
| External USVDS boundary | Fixed source/artifact identity, read-only adapter port | No developer-worktree imports, stage invocation or external 01/02 edits in this relocation batch |

Later package/workspace wiring and separate ESM Node tests must be explicit. Future Story Development remains reserved in the new repository; it is not a migrated external stage tree. Preserve Media's full cumulative hardening including `beforeCreate`; Drama persistence cannot fill the unfinished durable MediaApplicationStore gap.

## 3. Additive fact migration and one writer

### Database ownership and migration mechanics

Future Drama SQL remains under the selected **`dramago` schema**. Share the host PostgreSQL pool by injection, not generic tables or unrestricted repositories. Tenant-bound authorization is mandatory; a `workspace_id` text field alone is not access control. Journal is development/reference-only, not production durability.

Add fields/tables/indexes compatibly; do not rewrite applied migrations, old IDs, baselines or history. Before baselining an existing database compare actual schema to committed expectation and reject unexplained drift. Require ordered migration ledger, checksums, deployment lock, connection ownership and explicit pre/postconditions, plus repeat/concurrent-deploy tests. The selected Drama SQL has explicit `BEGIN`/`COMMIT`; do not feed it into the generic Media pool.query scanner and assume one transaction/connection. Use a deliberately connection-bound path.

Drama owns Project, immutable versions, decisions, Planning/Script Baselines, Creative Run and creative bindings. Media owns Quote/budget/execution facts, Job, ProviderExecution, Asset and archival. Queue is delivery only; object storage holds media and hash-bound immutable large documents. Shared infrastructure never grants cross-domain business write permission.

### Legacy import

Preserve raw bytes/text, source location, import version/digest, diagnostics and historical gate claims. Keep EP/CHAR/LOOK/SET/PROP/VIDEO/SHOT, Job/Asset IDs, original request keys and execution relations exactly. Add owned project-scoped mappings; reject ambiguous/foreign ownership instead of guessing.

Use stable import identity scoped to project, original identity/source and content digest so retries add neither duplicate history nor paid work. Missing formal evidence yields `legacy_unverified`: useful historical material, not automatically failed or deleted, but not new Planning/Script approval. No parsing APPROVED/PASS, filename, model text, inferred UI readiness or membership into authority.

To enter new mode, create immutable versions, resolve coverage/provenance/ownership, review the complete predeclared planning scope and authorize the fixed candidate. Revisions create new candidates. Revocation appends exact-target decisions/impact events and blocks new downstream release; a new baseline does not itself revoke the old. Neither action erases historical jobs/costs.

### Project cutover

1. Select a canary and compatibility-verified reader/writer/worker set. Snapshot source, authoritative facts, object references and unresolved execution/cost links.
2. Freeze legacy writes and prove they cannot race import; reads may continue. Import a fixed snapshot without media submission.
3. Verify IDs, exact references, hashes, scope/ownership and execution/cost associations. Failure keeps read-only containment or the prior authority, never two writers.
4. Record authority transition and route new commands to the database-backed application only after denying old manifest writes.
5. Treat Workbench/chat/Markdown as projections or candidate commands, not alternate authoritative state. An edit creates a versioned command, not a direct fact overwrite.
6. Compare counts/digests/projections and audit cutover. Read-only shadow comparison is allowed; mutable manifest/database dual-write is forbidden.

Future writes require persistent idempotency and existing-aggregate `expected_revision`. Authorization, frozen reference resolution, append/CAS and Audit/Outbox must share a short transaction-bound repository. Never await external models/services or humans inside that transaction.

## 4. Execution and cost invariants

Migration, retry, refresh, disconnect and unrelated edits are not regeneration requests. Preserve original execution ID/key/hash/revision/source/target, Workspace/Project association, Quote, Job, provider task/ProviderExecution, Asset links and cost observations. Never recalculate old `usvds:q:` / `usvds:g:` keys or batch-resubmit in-flight work.

For future new-mode writes, persist versioned Workspace/Project/operation/fixed-input/explicit-attempt intent and original submission key before external submission. Quote/submit outside the Drama transaction, then bind the result transactionally. Crash after Job creation but before linkage must recover the original Job with the same intent/key. Explicit regeneration requires a new `generation_attempt` and renewed fee authorization; a changed manifest cannot manufacture it.

Keep conservative whole-workbench stale guards until a validated replacement exists. Target-level digests may be deferred; prevention of duplicate payment may not. Historical Job query/reconciliation must remain available even when creative writeback is refused.

Model review, creative approval, Quote/budget authorization, archived internal Job success and adoption are separate facts. Default is explicit cost confirmation; bounded auditable Workspace preauthorization is the only automated alternative. Preserve estimated/reserved/reported/reconciled cost distinctions and provenance. Unknown cost is not zero cost; application rollback cannot fabricate cancellation/refund/settlement.

Provider success must still archive before internal success. Ready archived output becomes `review_required`, not adopted. Stale/revoked/unapproved-source results retain Job/Asset/cost history but cannot attach silently to latest or overwrite an approved target. `unknown`/`reconciling` requires original-task recovery; no ordinary new-key retry. Cancellation is separately authorized and verified. URL expiry refreshes access, never media.

## 5. Future rollback runbook

Precondition: release manifest identifies a compatible rollback reader/application and retained schema/workers. If no older binary can read new states safely, rollback means read-only containment with compatible reconciliation, not forced data downgrade.

| Order | Action | Required observation |
| --- | --- | --- |
| 1 | Disable new paid submission, generation attempts and baseline publication | No new dispatch/baseline releases; query/recovery continue |
| 2 | Freeze affected creative writes and adoption; record project routing cutoffs | No old writer reopens alongside DB authority; snapshot intents/quotes/jobs/tasks/assets/outbox/cost checkpoints |
| 3 | Fence retired writers/workers; retain compatible polling, reconciliation, webhook/ingest and archive workers | Submitted work remains observable/archiveable; queued-but-unsubmitted dispatch is paused separately |
| 4 | Recover uncertain/submitted tasks by original keys/IDs | No new-key resubmit; stale/revoked-source tasks remain findable; archive without automatic adoption |
| 5 | Retain additive schema, versions/baselines, decisions, audit, migration/replay ledger and object/media links | No destructive down-migration, erased approval or lost provider-cost evidence |
| 6 | Route only to compatibility-proven application/readers | Unsupported states/projects stay read-only/refused; no lossy media_executions or review_required coercion |
| 7 | Reconcile database, Media and Provider facts and safe pending delivery | Idempotent archive/replay; original task/Asset/Quote/cost relationships remain intact; no candidate auto-adoption |
| 8 | Resume only after integrity/cost review and explicit operator authorization | One writer, no duplicate charges or stale overwrite; unknown tasks/costs stay visible and block unsafe operations |

Do not use database point-in-time restore as ordinary application rollback: it can erase evidence of external work that continues incurring cost. Disaster recovery is separate and approved, retains external evidence, reconciles post-restore operations using original IDs/keys, and blocks writes until gaps are accounted for. Never regenerate to fill a database gap.

Rehearsal must prove: a pre-cutover submitted job survives; completion during rollback archives once without adoption; uncertain submit recovers without another charge; old reader refuses unsupported state without loss; newer decisions/history remain readable. None of these drills are claimed executed here.

## 6. Phase-entry and release NO-GO gates

### Contract acceptance / downstream development

NO-GO if provenance roles or bounded scope are missing, schemas/catalog/invariants contradict each other, old DSH package/dirty ledger is treated as target acceptance, generic Media gains Drama dependencies, external USVDS is copied/modified, or static/tests/reviews are failed/unrecorded. Tool declaration must not be misreported as registration. Require identity/reader/key preservation, additive migration, one writer and in-flight rollback policy before implementation relies on them.

### P2 Story/Script entry

Requires accepted P1 Drama fact layer, not simply selected application/persistence source. NO-GO without durable versions/baselines, authenticated authorization, idempotency/CAS, exact coverage/ownership, frozen run input resolution, effective Planning approval, same-version Doctor PASS + Continuity CLEAR + Script approval, continuity race rejection and restart recovery. Test freeze/approve/revoke without an Agent. Paid Media E2E is not required to start an isolated Story/Script loop; no exemption follows for eventual production.

### Production release

NO-GO without real unified transport/lifecycle/discovery/auth/scopes/object authorization and genuinely wired handlers; durable Media quote/spend/idempotency store; owned matching unexpired quote/cost checks; no duplicate payment; archival/reconciliation/fencing; compatible project Workbench and adoption; migration locking/recovery; and rehearsed in-flight rollback on actual database/queue/private storage. Generic media generation cannot bypass authorized creative adoption.

Fake fixtures, PostgreSQL doubles, source branch passes, old closure and historical provider tests are not those results. Real provider tests require separate environment and expense authorization. Architecture/domain/Media/persistence/QA owners must record target-specific evidence before enabling their surface. Current commands and their limited interpretation are in [P0-ACCEPTANCE-GATES.md](P0-ACCEPTANCE-GATES.md).
