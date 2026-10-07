# P2 contract acceptance and handoff

DramaGo-MCP is the product. US-Vertical-Drama-Studio is external/read-only and is
not edited, vendored or imported. This contracts branch ends at approval-ready
planning; formal screenplay, Stage 03/04 and Production 05–09 remain outside P2.
Generation/review never approve; `dramago_planning_baseline_approve` is the sole
formal planning approval path. Generic Media packages are unchanged.

## Scope of evidence

- `p2-story-contracts.test.mjs`: new library ID, reuse of existing fact definitions,
  structured content, strict request shapes, policy step allowlist, required
  bindings/research, port role declarations, structured review outcomes and
  rejection of approval/screenplay fields.
- `p2-story-semantics.test.mjs`: a complete synthetic planning graph, exact
  cross-record refs and recomputed digests, required research, provenance links,
  declared ordered episode coverage, full review scope, writer/reviewer identity
  separation, blockers, fixed input/output dependencies and durable run linkage.
  Negative semantic fixtures are resealed to prevent a generic digest failure
  from masking a missing semantic check.
- The same semantic suite tests an **offline admission oracle**, not new handlers:
  fresh admission, stale CAS, identical replay returning the recorded run result
  even after head advancement, changed-payload conflicts and scoped receipts for
  both Story execution and planning review. It neither persists nor invokes ports.
- `p2-story-approval-compat.test.mjs`: the P2 fixture is stored in the existing
  InMemoryDramaRepository and passed through the existing P1 formal approval
  service. Generation/PASS/candidate assembly leave no baseline or approval;
  a model actor is rejected; an explicit authorized human decision can publish
  the exact candidate through that unchanged service, with readback verification.
  This uses synthetic authorization, not real external approval.

Compatibility detail: preserve `review_kind=planning`, `blockers` and the existing
core `subject_refs` required by P1 approval. Additional complete P2 inspection is
pinned in mandatory `inspected_refs` inside the immutable evidence artifact.
No change to the approval service, published baseline schema or generic envelope
is needed. The P2 application must enforce the additional P2 semantic gates
before handing an approval-ready candidate to the existing approval path.

## Reproducible checks

From this worktree, using the repository-pinned pnpm version:

```text
pnpm install --frozen-lockfile
pnpm check:dramago-contracts
pnpm test:dramago-contracts
pnpm test:dramago-story-contracts
pnpm typecheck
pnpm build
pnpm test:media
pnpm test:dramago
node --test tests/dramago/*.test.mjs tests/dramago/*.node.mjs
git diff --check
```

On this host the bare `pnpm` command was absent and the Corepack shim had a broken
path. `npx --yes pnpm@9.15.4` successfully ran the pinned package manager; it
installed the frozen lockfile without changing it. Use that prefix instead of
`pnpm` when reproducing in this environment. Node's built-in test runner can also
run the offline `.mjs` contract suites directly.

Verified before handoff:

- Integrated Node static/schema/catalog check passes; Python P0 checks: 21 passed.
- Contracts package script: 223 passed; dedicated P2 Story suite: 42 passed.
  The initial 39-test suite passed before closeout. Three added regression tests
  first failed with missing expected exceptions, then passed after adding gates
  for unknown direction claim IDs, claims with omitted research, and reordered
  episode run outputs. Sets also bind the exact same-attempt outline output refs.
- The Node Drama suite, including P0/P1, boundary/relocation tests and P2 contracts:
  388 passed, no skips. All original schema IDs and catalog policy fields remain
  unchanged. These totals overlap; they are not additive test counts.
- Typecheck and build pass. Independent read-only review found no blocking
  security or logic findings. Whitespace checks cover both staged and unstaged
  changes.
- Media suite: 132 passed, 3 live-Postgres integration tests skipped by the existing
  environment gate, matching the pre-change run. No live Postgres claim is made.
- Drama TypeScript port/wire suite: 5 passed.

The Python check retains its exact inventory assertion and explicitly permits the
new P2 definition library and policy. P0 schema/fixture semantics are not weakened.
The shared Node schema checker preflights the new library; P2 test cases select
named definitions explicitly. Existing package exports already expose both assets.

## Historical runtime handoff

The following was the contracts-only handoff checklist, not the current runtime status. The local [P2 Story runtime](../../packages/story-development/README.md) and [context-ref composition adapter](../../apps/dramago-mcp/README.md) now implement and test the offline planning path. Run `pnpm test:story-runtime` for the development, revision, content, conformance, research, authorship and actual-runtime composition suites. External providers, USVDS stage invocation, production recovery and real-database deployment verification remain separate gates; the historical counts above are not current runtime-suite totals.

The contracts-only handoff required:

- Authenticated admission and atomic concurrent CAS/idempotency, recovery and
  durable CreativeRun/output publication; immutable input snapshots across awaits.
- Injected ResearchContextPort, StoryGenerationPort and PlanningReviewPort, with
  trusted separate writer/reviewer identities and no aliased port invocation.
- Full reference closure and shared-lineage consistency, real evidence
  authenticity/freshness policy, synthetic-data exclusion from real-market runs,
  semantic/creative completeness and fail-closed timeouts.
- P2 content dispatch by both kind and schema version, strict proposal validation,
  full ordered episode-set assembly and optional candidate assembly without
  approval. A candidate builder only assembles existing exact refs/evidence.

No test helper is exported by a runtime package. The offline oracle is selected
conformance evidence, not a production validator or substitute implementation.
Do not import fixture helpers into application/persistence. No real LLM, browser,
network research, Workbench, multi-agent UI, queue or Remote MCP integration is
part of this branch. No push is performed.
