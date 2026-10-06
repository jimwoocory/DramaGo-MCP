# P1 fact-layer security boundary

Relocated to the Media-hosted DramaGo workspace from domain/security
`975464ff5840ec9781430e7c47cc422b9a258fee`. The ESM JavaScript implementation
(`domain.js`, `index.js`, `services.js`) is unchanged from that pin.
Import `@xiaoshuren/dramago-application`; inject a tenant-bound repository
whose authorization policy throws on denial. No USVDS or plugin runtime is used.

The application services record facts only. They do not execute P2 creative generation or infer approval from review outcomes.

## Formal decisions

- The trusted repository authorization policy must grant the requested action on the project. Authorization evidence is not a grant by itself.
- A new approval or revocation must attribute its actor to `AuthContext.subjectId`. Only `human` and `service_authorized` actors are accepted. P1 has no trusted delegation port: caller-supplied delegation or a different actor ID is not accepted, including on idempotent retries.
- `authorization_ref` resolves an immutable `authorization_evidence` artifact in the same project/workspace, binding the actor and decision policy version.
- Approval reads and revocations verify decision ownership against the authorized project. A revocation resolves the exact prior approved decision and must preserve its exact target.
- A Script Baseline requires an existing, exact Planning Baseline and an approved decision not revoked by an exact decision reference. A baseline's `approval_refs` alone is not evidence of effective approval. Revocation does not mutate historical baselines.

## Evidence and digests

Review summaries in manifests are assertions to verify, not authority. The referenced immutable `review_report` must agree on review kind, outcome, and the entire set of exact subjects. Planning review must have no blockers; Script Doctor must have `mandatory_fail: false`; continuity must bind the exact input/output ledger references.

Hashes follow the P0 `validate_contracts.py` digest bodies, using the application's canonical JSON implementation:

- Artifact: canonical `content`.
- Planning/Script Baseline: canonical `manifest`.
- Approval/revocation: canonical decision body excluding `artifact_id`, `version_id`, and `content_digest`.

Supplied digests are checked, never silently repaired. Resolved artifact content and the Planning Baseline used by script approval are checked again at the application boundary. Repository writers are trusted infrastructure, not a public authorization bypass.

## Frozen CreativeRun facts

Run creation and updates validate the canonical input-manifest hash. Every input reference must resolve to a same-project/workspace artifact or baseline with an exact identity and truthful digest. Each attempt must carry the frozen manifest digest; steps are unique and attempt numbers are positive, unique, and increasing. Run identity, ownership, domain and frozen inputs cannot be patched. Updates remain CAS-protected.

The complementary persistence-review adapters retain their concurrency and
journal hardening. The only additional adapter change from this domain pin is
an additive read port:

    getBaselineByVersion(versionId, projectId)

The existing contract stores only an artifact reference in a run input, not a baseline ID. This port is necessary to resolve it without inventing ID conventions, duplicating baseline records into artifact storage, or keeping a process-local index. Memory/journal and PostgreSQL implement the read; the PostgreSQL query also binds tenant ID. No migrations or persistence write behavior are changed. Custom stores lacking this method fail closed for unresolved baseline inputs.

## Workbench availability

`createDramaApplication` intentionally does not bind `getWorkbench`. Consumers
requiring only the project fact can use `getProject`. Returning `{ project }` is
not a complete workbench projection. MCP dispatch, discovery and transport are
outside this package and this relocation; application methods such as
`createRun`/`updateRun` do not register public tools.

## Offline verification

    pnpm test:dramago
    pnpm test
    pnpm typecheck
    pnpm build
    git diff --check

Security regressions use real in-memory repository transactions and the existing P0 fixtures, including same-tenant cross-project attacks, forged authority, immutable evidence mismatches, false digests, revoked Planning approval, frozen run inputs and application workbench unavailability. The PostgreSQL lookup test checks parameterized query construction with a test double; it is not a live database integration test. Test-only JSON examples are isolated in `tests/dramago/fixtures`, with a resolver that prefers the separately owned `packages/dramago-contracts` when present. No schemas or fixture copies are embedded in this fact package. See `tests/dramago/README.md` for selection and limits.
