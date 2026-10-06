# DramaGo MCP V1 — Relocation source baseline

> **Historical relocation intake record.** The contracts/fact/composition work described as future in this P0 document has now landed in the integrated DramaGo-MCP relocation baseline. See [P1-INTEGRATED-STATUS.md](P1-INTEGRATED-STATUS.md) for current implementation status. P0 invariants remain authoritative where not superseded.


Status: source selection and contracts/docs intake record, not migration completion, runtime acceptance or release approval. This replaces the old USVDS checkout baseline for the new target; it does not rewrite historical evidence.

## 1. Immutable role pins

The following role lines are machine-checked independently. `target main` identifies the selected integration foundation, not a claim that a moving branch will always resolve to it.

target main=8f33226
contracts source=8ef5218
application source=975464f
persistence source=e3bcbf0
Media hardened source=8f33226

| Role | Full commit | Intake meaning |
| --- | --- | --- |
| Target main | `8f33226ae06875a1f79abebe3ce02ece0058c0d5` | Existing hardened Media foundation for the new DramaGo-MCP repository |
| Contracts | `8ef521800c6fbca01dc03d6bbd404029d92614ea` | Selected contracts, three contract scripts, contract tests and six documents; documentation placement and gates are substantively revised |
| Application | `975464ff5840ec9781430e7c47cc422b9a258fee` | Historical selected domain-security application source; its reusable fact-layer behavior is now integrated in the current DramaGo-MCP baseline |
| Persistence | `e3bcbf0ac4778285f7d65fc532d3caa3a0d9c1b9` | Historical selected hardened persistence source; the reusable adapters plus required baseline-version lookups are now integrated in the current DramaGo-MCP baseline |
| Hardened Media | `8f33226ae06875a1f79abebe3ce02ece0058c0d5` | Retain in place; do not recopy or downgrade generic Media |

At P0 selection time, a selected source was not yet a completed transplant. The application and persistence branches had complementary fixes rather than interchangeable implementations; their selected parts are now integrated and must continue to pass the combined target tests.

## 2. Review inputs and local evidence locations

Relocation authority for this intake: `C:/Users/Administrator/AgentDock/reviews/dramago-mcp-relocation/salvage-manifest.md`, especially source selection, sections 2A–2G, 3–5 and 7. Its proposed full salvage batch was broader than the original contracts-only workstream and has now been selectively integrated into the current baseline.

| Location | Use |
| --- | --- |
| `C:/Users/Administrator/AgentDock/worktrees/dramago-mcp-p0` at contracts pin | Read-only source; six same-named P0 documents and `core/dramago-mcp/contracts/` |
| `C:/Users/Administrator/AgentDock/worktrees/dramago-p1-fix-domain` at application pin | Selected future application/security source described in salvage manifest |
| `C:/Users/Administrator/AgentDock/worktrees/dramago-p1-fix-persistence` at persistence pin | Selected future persistence source described in salvage manifest |
| `C:/Users/Administrator/AgentDock/worktrees/dramago-p1-fix-media` at Media pin | Hardened Media source described in salvage manifest |
| `C:/Users/Administrator/AgentDock/worktrees/dramago-new-contracts` | Current target worktree, initially observed at the target main pin |

These absolute paths are inspection locations only. No deployment, package import, external capability lookup or runtime dependency may resolve a developer worktree. A later release must bind source commits, package versions and artifact digests, schema/policy/migration versions, compatible readers/workers and rollback target. No unpublished artifact digest is invented here.

## 3. Bounded intake and package identity

This branch is limited to contracts, docs, static scripts and contract tests. It does not land Drama application, persistence, dispatcher, USVDS adapter execution, Story Development, transport or Workbench runtime.

- Relocate the complete contract tree from `core/dramago-mcp/contracts/` to `packages/dramago-contracts/contracts/`. Keep schema `$id`, `schema_version`, relative references, tool names, example identities and digests unchanged. `schemas.dramago.invalid` is an offline identifier namespace, not a network retrieval endpoint.
- Use package `@dramago/contracts`, independently of generic `@xiaoshuren/contracts`. JSON assets are exposed through `./contracts/*`; `./catalog` aliases the tool catalog. Package exports do not register MCP tools.
- Adapt `scripts/validate-dramago-p0.mjs`, `scripts/dramago-schema-instances.mjs` and `scripts/dramago-tool-policy.mjs` to target paths/provenance. Keep fail-closed schema resolution, unsupported-keyword rejection, fixture checks and policy floors.
- Relocate the P0 Node regression to `tests/dramago/contracts.test.mjs`; do not copy the whole legacy test directory.
- Rewrite the six peer documents in this directory and create this baseline. Do not transplant dirty-intake or closure documents as target gates.
- The new package engine is `>=22`; the old USVDS package's `>=24` requirement is not inherited. This is a distinct package, not a claim that the historical DSH artifact supports Node 22.

## 4. Historical metadata is not current provenance

The preserved catalog `sources` metadata names historical `93bf3baa22e1d462019aea17ab991febc17bd827` / `a1f3af18858b21aec09e85ddc99f71929befeead`, the old meeting consensus, `integrations/media-mcp/index.js`, and `dsh-plugin/stage09-review-tool.js`. They explain the original naming and consumer/local-review contracts. They are not today's target, contracts, application or persistence pins, live imports, or evidence that handlers are registered.

Likewise `core/usvd-v9`, `dsh-plugin`, `plugins/us-vertical-drama-studio-v9`, `direct-upload/v9`, `tabbit/v9` and `mediago/v9` describe external/historical authoring, host or generated distribution surfaces. They are not directories to transplant. USVDS remains external, frozen and read-only. Any change to its stages or distribution requires separate approval outside this migration.

The source `P0-SOURCE-BASELINE.md`, `P0-DIRTY-INTAKE.json`, `P0-SOURCE-COMPATIBILITY-CLOSURE.md`, `P0-HUMAN-REVIEW-CLOSURE.md`, and later source `P1-INTEGRATION-STATUS.md` are reference-only historical records. Their ledger counts, dirty checkout state, test results and closure conclusions are not target acceptance facts. Review evidence is not approval, either for a release or for a creative candidate.

## 5. Verification record and limitations

During this documentation task, read-only Git inspection resolved source HEAD to the full contracts pin and target HEAD to the full target/Media pin. The available executables reported Node `v22.23.2` and Python `3.11.16`. These observations establish source/runtime identity only.

Target verification during contracts relocation (Node v22.23.2, Python 3.11.16):

| Actual invocation | Result |
| --- | --- |
| `npm run check:dramago-contracts` | Exit 0: 18 JSON files, 8 schemas, 9 example files / 24 instances, 32 tools; Python 21 tests passed |
| `npm run test:dramago-contracts` | Exit 0: 181 Node tests passed, no skips, including package export resolution and documentation-table parity |
| `npm test` | Exit 0: Media Vitest 132 passed; 3 real PostgreSQL tests skipped because `POSTGRES_URL` is not configured |
| `npm run typecheck` | Exit 0 |
| `npm run build` | Exit 0 |
| `git diff --check` and `git diff --cached --check` | Exit 0 |

`pnpm` was not on PATH and the installed Corepack shim failed to resolve its
module. Dependency setup used `npm exec --yes --package=pnpm@9.15.4 -- pnpm
install --ignore-scripts --store-dir node_modules/.pnpm-store`. Package versions
were not upgraded; the only lockfile change is the empty Drama contracts importer.
Npm ran the same package scripts documented in the acceptance gates. Vitest now
explicitly excludes `tests/dramago/**`, preserving the existing Media suite while
Node owns the separate Drama tests. TypeScript build does not validate these ESM
scripts. Independent read-only review found no blocking security or logic errors.

The complete source inventory contains 20 files. Byte comparison against
`8ef5218` matched all 19 non-README files, including schemas, catalog, examples
and Python checker; only README placement/provenance/commands were rewritten.
No source USVDS files were changed. No migration, provider call, live MCP endpoint
or runtime release acceptance is implied. Source salvage results remain historical,
not target runtime evidence.

Known selected-source limits remain: the dispatcher source is an internal dispatcher, not a complete MCP server; combined domain/persistence behavior is unproven here; PostgreSQL doubles are not real locking/crash tests; durable MediaApplicationStore is unfinished despite hardened Media application behavior; Run validation alone is not append-only attempt history or a complete workflow engine. The existing Media in-memory transaction store and old quotes table must not be advertised as durable Quote/Budget acceptance.

## 6. Document map

- [Architecture](P0-ARCHITECTURE-DECISIONS.md): new composition ownership and immutable domain facts.
- [Acceptance](P0-ACCEPTANCE-GATES.md): current static gates versus later runtime/release gates.
- [Compatibility](P0-COMPATIBILITY-MATRIX.md): preserved contracts, historical package evidence and adapter obligations.
- [Migration and rollback](P0-MIGRATION-ROLLBACK.md): future fact-layer intake, one writer and cost-preserving recovery.
- [Tool catalog](P0-TOOL-CATALOG.md): complete contract declaration, not registration.
- [Stage mapping](P0-USVDS-STAGE-MAPPING.md): frozen external 01–09 and new-repository reserved Story responsibilities.
