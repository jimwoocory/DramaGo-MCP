# DramaGo MCP V1 — Relocated contract acceptance gates

Status: required evidence for the contracts/docs branch and separate downstream releases. Target static/test results are recorded in P0-SOURCE-BASELINE.md. No owner approval or runtime completion is asserted here.

## 1. Scope and provenance gate

Use [P0-SOURCE-BASELINE.md](P0-SOURCE-BASELINE.md) and the relocation salvage manifest, not the old dirty-checkout ledger, as intake authority. Target/hardened Media is `8f33226`; contracts are selected from `8ef5218`; application `975464f` and persistence `e3bcbf0` are future source selections, not landed runtime.

Acceptance requires:

- New DramaGo-MCP repository owns composition. USVDS is external frozen read-only capability source; no `dsh-plugin`, `core/usvd-v9`, generated distributions or host packaging copied.
- Generic Media at the hardened target remains intact, including its `beforeCreate` boundary. No Drama/Story/Canon/approval/USVDS imports in generic Media.
- Changes stay within contracts/docs/scripts/tests/package wiring for this batch. No application, persistence, dispatcher, P2 orchestration, provider calls or paid work are implied by the catalog.
- The baseline independently records each selected role using exact role lines, full commit identities and scope limitations. Historical `93bf3ba`/`a1f3af1` catalog metadata is explicitly historical rather than accepted as relocation pins.
- Reviewers inspect real diffs and target results. Source review, contract validation and release approval are separate decisions.

## 2. Required target artifacts

The seven nonempty documents under `docs/dramago-mcp-v1/` are:

1. `P0-SOURCE-BASELINE.md`
2. `P0-ARCHITECTURE-DECISIONS.md`
3. `P0-ACCEPTANCE-GATES.md`
4. `P0-COMPATIBILITY-MATRIX.md`
5. `P0-MIGRATION-ROLLBACK.md`
6. `P0-TOOL-CATALOG.md`
7. `P0-USVDS-STAGE-MAPPING.md`

The contract inventory is rooted at `packages/dramago-contracts/contracts/`: README, `common.schema.json`, `drama-project.schema.json`, `artifact-version.schema.json`, `approval-decision.schema.json`, `planning-baseline.schema.json`, `script-baseline.schema.json`, `creative-run.schema.json`, `media-execution-link.schema.json`, `tool-catalog.v1.json`, `validate_contracts.py`, and the complete source examples tree. Schema IDs/versions, relative references and example identities/digests must be preserved.

Package `@dramago/contracts` is distinct from `@xiaoshuren/contracts`, exposes JSON via `./contracts/*` and catalog alias `./catalog`, and declares Node `>=22`. Require the three scripts `validate-dramago-p0.mjs`, `dramago-schema-instances.mjs`, `dramago-tool-policy.mjs` under `scripts/`, and `tests/dramago/contracts.test.mjs`. Missing artifacts fail; they are not a skipped success.

Do **not** require target copies of `P0-DIRTY-INTAKE.json`, historical compatibility/human closure, `check-p0-compatibility.mjs`, `check-p0-source-intake.mjs`, legacy No-UI package tests, UI bundles or generated plugin distributions. Those gates enforce the wrong product boundary here.

## 3. Current candidate commands

Run from the target repository root. Available documentation-task runtime was Node `v22.23.2` / Python `3.11.16`; the new contract package requires `>=22`, not USVDS's historical `>=24`.

```sh
pnpm check:dramago-contracts
pnpm test:dramago-contracts
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

If `pnpm` is not directly available, use `corepack pnpm` with the same command name. Do not silently install/change dependencies as part of documentation work; integration must report any missing tool/dependency blocker. Existing Media commands must retain their meaning.

| Command | Required interpretation |
| --- | --- |
| `pnpm check:dramago-contracts` | Node static gate plus `python -B` fixture checker; both must execute and succeed, not merely parse JSON |
| `pnpm test:dramago-contracts` | `node --test tests/dramago/*.test.mjs`; separate Node regression, not assumed discovered by Vitest |
| `pnpm test` | Existing Media Vitest regression, separately evidenced |
| `pnpm typecheck` / `pnpm build` | Existing Media TypeScript checks; do not claim they validate unreferenced JavaScript or future runtime packages |
| `git diff --check` | Whitespace/error check; not semantic or execution evidence |

Record commit/worktree identity, executable versions, exact invocation and exit status. If a command cannot run, record BLOCKED; if it fails, record FAIL. Source-suite counts, a static PASS, or a diagnostic on another checkout cannot become a target runtime PASS. Executed target commands and their bounded results are recorded in [P0-SOURCE-BASELINE.md](P0-SOURCE-BASELINE.md); runtime gates below remain separate.

## 4. Static/schema/catalog gate obligations

The migrated harness must retain substantive validation rather than replacing it with JSON parsing:

1. Required docs/catalog exist and are nonempty; recursively parse contract JSON with duplicate/identity checks as supported by the harness.
2. Validate schema `$schema`, unique `$id`, title and valid root type/composed-library shape. Resolve only permitted local pointers/files/loaded IDs; fail closed on missing, remote or unsupported schema constructs. Never fetch `schemas.dramago.invalid`.
3. Validate current examples/supporting instances and semantic fixtures, including negative cases. Preserve unsupported-keyword rejection and local reference safety; do not hide malformed inputs behind permissive fallbacks.
4. Require the exact 32 unique canonical tools independently of input catalog content, the A–E grouping and per-tool policy floors. Every tool has domain, maturity, implementation status, mutability, idempotency/revision flags, authorization class, async kind and invariant. Preserve `runtime_registration: false` and empty aliases.
5. Reject generic `stage_run`, `approval_decide` (including Drama-prefixed forms), universal baseline approval and arbitrary state setters. Domain-specific allowlisted Story/Production commands remain permitted.
6. Enforce required episode identity, frozen version references and content/version digests in baseline schemas. Schema/policy versions or manifest hash alone are not content-version evidence. Optional containers, unused definitions, prose and conditional alternatives cannot stand in for unconditional fields. Follow required paths through `allOf`, array items and supported local references.
7. Require root baseline immutability declaration; treat it as schema annotation, not storage enforcement. Fixture validation is not proof of persistent append-only semantics, complete cross-record ownership, real digest authority or authenticated approvals.
8. Validate the new baseline's exact role lines; old source pins in catalog metadata must not satisfy current provenance by accident. Preserve package/namespace/export separation and target path resolution.

Contract/schema owners still review precise semantics. Synthetic fixtures are test inputs, not invented production facts. Static success alone does not prove every rejection case is enforced in runtime services.

## 5. Human contract acceptance

Architecture, domain, Media and QA reviewers must explicitly inspect:

- Exact-reference immutable Planning scope, complete episode coverage, no retrospective scope shrink; Script approval binds the same screenplay/reviews/continuity and an effective Planning approval.
- Review versus approval, approval versus cost authority, Provider versus archived Job success, and Job success versus adoption. Actors come from authentication; Workspace membership alone grants neither approval nor spend rights.
- Story belongs to reserved future new-repository work. External 01/02 are consumed through adapters, not modified. Formal screenplay begins at 03; 04 retains Mandatory Fail and continuity ordering; 05–09 remain Production and 08 is not a Provider adapter.
- Preserved five Media DTO/error/async contracts, no mandatory Drama fields/aliases, and truthful catalog maturity versus registration. A selected internal dispatcher is not a deployed MCP server.
- Reader compatibility for `review_required`, `media_executions`, stable IDs and old request keys; imports without formal evidence remain `legacy_unverified`.
- Additive migration, single authoritative project writer, transaction/CAS/idempotency/Audit/Outbox responsibilities and recovery with no duplicate payment or stale overwrite.
- Historical DSH/No-UI/UI provenance remains reference-only. A source closure or old ledger does not approve this target.

Passing these reviews permits bounded downstream development only. Approval must be recorded by the responsible owners; this document does not supply it.

## 6. Future application/persistence gates — not part of this branch

Before accepting a combined fact layer, verify the selected domain-security application plus hardened persistence, including `getBaselineByVersion(versionId, projectId)` in memory/PostgreSQL and inherited journal behavior. Keep authorization denial throwing; resolve real review artifacts and exact subjects; reject inappropriate artifact envelopes and foreign/dangling/stale references.

Require real PostgreSQL tests for transaction-scoped advisory replay locks, READ COMMITTED lookup after lock acquisition, same-transaction fact/replay/audit/outbox writes, nested transaction rejection, tenant-bound authorization, exact revocation target and migration connection ownership. Strict JSON-safe persistence and serialized stale journal-lock recovery need regression evidence; journal remains development/reference-only. PostgreSQL doubles are not proof of database locking, deployment or crash recovery.

Exercise restart recovery, concurrency/CAS, immutable version/baseline storage, approval/revoke predecessor correctness, continuity races, frozen run inputs/digests, and append-only attempt history/workflow transitions. No model/Agent should be needed to test freeze/approve/revoke. P2 entry depends on accepted P1 Drama facts, not on paid Media tests; that dependency does not waive later Media acceptance.

## 7. Future Media/composition/production gates

- Wire a real local Media adapter with correct auth argument order, outer DTO mapping and untouched nested request hashing; serialize public outputs deliberately and preserve errors. Do not invent output assets/access URLs or expose storage keys.
- Prove persistent execution intent, owned/unexpired matching quotes, cost authority/budget refusal, original-key recovery after submit-before-bind crash, and no duplicate cost after repeated clicks/disconnects/unrelated edits. Intentional regeneration requires an explicit new attempt and authorization.
- Demonstrate separate reference-image/video gates, success-to-`review_required`, exact authorized adoption, stale/retired-worker fencing, and history queries even when writeback is blocked. URL expiry must not trigger regeneration.
- Complete durable MediaApplicationStore and quote/client-binding/spend/idempotency behavior; existing old quotes tables and Drama persistence do not close that gap.
- Test real PostgreSQL, queue/private storage, archival idempotency, uncertainty reconciliation, cancellation and in-flight rollback. Production requires one authenticated Remote MCP endpoint with discovery, transport, lifecycle, scopes/object authorization and honest handler allowlists, followed by Workbench adoption/restart coverage.
- Any real provider/paid test requires separate environment and cost authorization. Fake/local adapter tests and historical provider results are not Remote MCP E2E.

Until those independently recorded gates pass, production and P2-ready claims remain NO-GO. See [P0-MIGRATION-ROLLBACK.md](P0-MIGRATION-ROLLBACK.md) for containment and phase-entry criteria.
