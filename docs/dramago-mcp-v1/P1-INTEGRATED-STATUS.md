# DramaGo MCP V1 — Integrated relocation status

Status: historical P1 integrated relocation baseline, not production release approval. The subsequent local P2 [Story Development runtime](../../packages/story-development/README.md) and [context-ref composition adapter](../../apps/dramago-mcp/README.md) have landed. Story generation and planning review are callable when their explicit roles are injected; Workbench, Script/Production execution and external USVDS stage invocation remain unimplemented. The capabilities and verification below record the P1 baseline.

## Repository ownership

- Main product repository: `jimwoocory/DramaGo-MCP`.
- Integrated branch under review: `feat/dramago-mcp-integration`.
- Hardened Media foundation: `8f33226`.
- Relocated contracts commit: `d26c568` (source workstream `0ad95fe`).
- Relocated fact-layer commit: `ac8122e` (source workstream `eb2c2fa`).
- Relocated composition/USVDS-port commit: `e275ffc` (source workstream `6b68c14`).
- Integrated workspace lockfile commit: `d4532b9`.

The US-Vertical-Drama-Studio repository is not part of this repository's runtime tree and remains an external read-only capability source.

## Landed capabilities

### Drama contracts
- DramaProject, ArtifactVersion, ApprovalDecision, PlanningBaseline, ScriptBaseline, CreativeRun and MediaExecutionLink schemas.
- Frozen 32-tool catalog with generic Media compatibility preserved.
- Static and semantic fixture validation.

### Drama fact layer
- Project and immutable version facts.
- Planning/Script Baseline publication and approval facts.
- Approval revocation history.
- CreativeRun facts.
- In-memory and development Journal repositories.
- PostgreSQL repository/migration source with CAS/idempotency semantics.

### Composition
- Internal DramaGo dispatcher/composition root.
- Generic Media tool wiring.
- Explicit USVDS external adapter/port package.
- Creative/P2 tools remain declared-unimplemented unless a corresponding implementation is injected.

### Media
- Existing generic Media Core, providers, queue/storage/security packages remain intact.
- Hardened Media application remains generic and does not import Drama semantics.

## Verification on the integrated branch

Observed locally after integration:

- Drama contract validator: PASS — 8 schemas, 9 example files / 24 instances, 32 tools.
- Python contract fixtures: 21 PASS.
- Drama integrated Node/Vitest suites: PASS.
- Generic Media suite: 132 PASS, 3 PostgreSQL-environment tests explicitly skipped because `POSTGRES_URL` is not configured.
- Typecheck: PASS.
- Build: PASS.
- Offline frozen-lockfile installation: PASS.
- `git diff --check`: PASS.

These results do not prove deployed Remote MCP transport/OAuth, real PostgreSQL migration/concurrency behavior, queue/storage deployment, paid Provider E2E, or production rollback rehearsal.

## Next development boundary

The next phase may build Story Development runtime and explicit USVDS capability integration on top of this repository, without changing repository ownership:

```text
Idea -> Story Development -> approved Planning Baseline
     -> USVDS adapter -> formal screenplay / later production stages
     -> generic Media execution
```

Any future modification to the external USVDS repository requires a separate explicit decision; it is not implied by work in DramaGo-MCP.
