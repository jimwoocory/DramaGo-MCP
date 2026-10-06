# P2 Story Development runtime

DramaGo-MCP owns this package. US-Vertical-Drama-Studio is external/read-only;
there are no USVDS runtime imports. This package stops at Story proposals and
planning review evidence. It does not implement screenplay, Stage 03/04,
Production 05–09, Media semantics, tools/catalog, UI, remote MCP or a queue.
`dramago_planning_baseline_approve` / the existing P1 ApprovalService remains
the only formal planning approval path. Model PASS is not approval.

## Composition

Build with `pnpm build`, then import `StoryDevelopmentService` and its port
interfaces from `@xiaoshuren/story-development`. Inject the existing tenant-bound
Drama repository (Memory, Journal or PostgreSQL); no new store or migration is
introduced. Inject all three ports:

- `StoryGenerationPort`: a named writer; `generate(request, signal)` returns
  only `{ proposals: [{ role, data, episode_id? }] }`.
- `PlanningReviewPort`: a different named reviewer; `review(request, signal)`
  returns only `{ outcome, subject_refs, context_refs, findings, blockers }`.
- `ResearchContextPort`: `resolve(request, signal)` returns an exact existing
  research ArtifactVersion ref or `null`. The host must import research using
  the existing fact-layer artifact API before calling this service. This port
  is an offline context resolver, not a network client.

The runtime imports only Node crypto and the local Drama application canonical
hash/error helpers. Ports receive frozen detached inputs, never repository or
approval capabilities. The host owns authentic identities and implementations;
separate objects, callables and identities prevent accidental role reuse, not
malicious adapters lying about their identity. A reviewer cannot review any
resolved input bearing its writer identity, including historical dependencies.

## Commands and policies

Both methods require `project_id`, `workspace_id`, `expected_revision` and
`idempotency_key`. `runStep` additionally takes `step`, nonempty unique
`input_refs`, and optional `research_ref`. An idea is an existing `other_drama`
artifact containing fuzzy text; project/range declaration uses the existing P1
fact services. Explicit artifact refs are used throughout; there is no latest
version lookup.

| Step | Mandatory input roles | Output roles | Research |
|---|---|---|---|
| direction | at least one idea/context ref | direction | optional |
| adaptation | direction | adaptation | required |
| bible | direction | story_foundation, story_bible | required |
| master_outline | story_foundation, story_bible | master_outline | required |
| season_architecture | master_outline | season_architecture | required |
| episode_outlines | story_bible, master_outline, season_architecture | every episode_outline, then episode_outline_set | required |

`STEP_POLICIES` is frozen and versioned by `STORY_POLICY_VERSION`. Missing
research is allowed only for exploratory direction; that absence and policy are
recorded explicitly. Research artifacts use the existing `other_drama` kind:

    content.schema_version = "dramago.research-snapshot/v1"
    content.snapshot_version = an immutable source snapshot/version label
    content.captured_at = timestamp
    content.sources = [{ uri, retrieved_at }, ...]
    content.evidence = JSON evidence

The resolver returns only an exact ref or `null`; false/empty values are invalid.
If `research_ref` is present it must be an exact ref, not `null` or a selector.
The resolver's ref must match `research_ref` when one was requested. Ownership,
exact ref, body digest, version label, source records and timestamps are checked.
No data is invented and the runtime does not certify source truth or freshness.
Tests use labelled synthetic evidence, not claims about current markets.

`planningReview` takes `planning_scope` with direction, foundation, Bible,
master outline, season architecture, episode-outline-set and ordered individual
outline refs (see `PlanningScope`), plus optional `research_ref`. It requires
research, resolves the entire declared scope and verifies episode IDs, order,
set membership, kinds, digests and coherent dependencies. Missing, duplicate,
reordered or foreign episode refs fail before reviewer invocation. Project scope
must be revised through the fact layer first; a writer cannot revise it.

Dependencies are recursively resolved with an iterative 4096-artifact bound;
all resolved artifacts and the fixed project/context snapshot enter the manifest.
Outputs retain this full provenance in `dependency_refs`, while
`direct_dependency_refs` identifies selected inputs before ancestor expansion.
Coherence checks use those selected refs so a revised direction may retain its
historical predecessor without making regenerated downstream work unreviewable.
Direct refs must be unique exact members of full provenance and their ancestor
closure must cover it; all historical bodies still undergo ownership/digest checks.
Legacy artifacts without direct refs retain conservative coherence validation.
Foundation/Bible outputs revised together may retain historical sibling inputs
only when the selected pair shares the same frozen input-manifest digest and
proposal envelope; mixing generation cohorts or stale downstream versions fails.
The runtime validates structural completeness and exact causal dependencies,
not literary merit. Narrative/causal quality remains the writer/reviewer ports'
responsibility, evidenced by structured findings.

## Facts, replay, failure and approval

Each command authorizes with `story.execute` or `story.review`, including replay.
Inside one existing repository transaction it takes the repository's idempotency
reservation, checks the payload hash, validates the expected project revision,
resolves inputs, invokes exactly one writer OR reviewer, and saves:

1. An immutable `other_drama` run-context ArtifactVersion, freezing the full
   project snapshot, command, role identities and research selection/policy.
2. A CreativeRun with fixed manifest refs/digest and one terminal attempt.
3. Immutable output ArtifactVersions with exact dependency refs and manifest
   digest inside their content-hashed proposal envelope.
4. The original result in existing idempotency facts and a run audit event.
5. One project CAS revision increment (empty patch; no approval/head selection).

All commits are atomic. CAS/storage failure rolls back the complete command.
A stale revision is rejected before ports run. Identical committed replay returns
the same run/result before resolving research or calling a model, even after
service/repository restart. Changed payload conflicts. Different-key PostgreSQL
contenders may both compute, but the final CAS permits only one committed result.

The synchronous offline port calls have a 30-second default timeout each,
configurable within 1–60000ms, with AbortSignal and late-result discard. There is
no background retry. Writer/reviewer throws, timeout or malformed output commit
a failed CreativeRun, no output proposals, a sanitized error code and replay;
a new attempt needs a new command/key/revision. Invalid inputs or missing research
fail before a run is accepted and write nothing. Research resolution errors also
write nothing. A process crash before transaction commit leaves no accepted run;
there is no crash-resumable queue or precommitted in-flight run in P2. Injected
ports must be cooperative, offline and side-effect-free; JS timers cannot preempt
blocking synchronous code. Do not wrap service calls in another transaction.

Existing P0 ArtifactVersion kinds remain unchanged: direction, adaptation,
episode-outline-set, research and run context are versioned `other_drama` content
schemas/roles; foundation/Bible/master/season/individual outlines retain their
existing kinds. All model outputs have `content.status = "proposal"`. The
repository's existing CreativeRun revision field is retained.

Review evidence is an immutable `review_report` with `review_kind = "planning"`.
Core `subject_refs` match P1's exact baseline subjects (range, foundation, Bible,
master, season, every ordered outline). `context_refs` additionally bind direction,
episode set and research. Both lists must be acknowledged by the reviewer. Every
finding binds reviewed refs; blockers exactly list blocker finding codes. PASS
requires no blockers; FAIL and BLOCKED require at least one. A valid FAIL or
BLOCKED review is a successful evidence-producing run, not approval readiness.

No candidate builder is needed: a caller assembles the existing P1 planning
manifest from these exact refs and evidence. The integration test passes that
manifest and a separately authorized human decision to the unchanged P1 approval
service. Review never creates a baseline or approval fact, and P1 rejects FAIL
and BLOCKED reports. Direction/research/set context stays transitively bound through the
review artifact digest without changing the frozen P1 manifest shape.

## Verification

    pnpm test:story-runtime
    pnpm typecheck
    pnpm build
    pnpm test:media
    pnpm test:dramago

The focused suite covers six-step execution, journal reopen durability, P1
approval interoperability, stale/concurrent CAS, replay/conflict, rollback,
foreign refs, digest tampering including transitive bodies, caller mutation,
research policy, role separation, exact scope, blockers and no self-approval.
Journal is a local development/reference backend; real PostgreSQL deployment
integration remains the existing separate environment-dependent gate.

### Closeout verification

Verified on the P2 runtime worktree based on `main@95a7157`:

- `pnpm test:story-runtime`: 89 passed (including direction and paired Bible revisions).
- `pnpm test:dramago`: 94 Vitest tests and 346 Node tests passed; the 94 include Story.
- `pnpm check:dramago-contracts`: static P0 and Python contract validation passed.
- `pnpm test:media`: 132 passed; 3 real PostgreSQL tests skipped because
  `POSTGRES_URL` is not configured. No local PostgreSQL/Docker executable was available.
- `pnpm typecheck --force`, `pnpm build --force`: passed.
- Frozen offline lockfile installation, built ESM workspace import, static
  security scan, independent code review and diff whitespace checks: passed.

The environment's pnpm shell shim was unavailable; commands used the installed
Corepack entry with Node and pnpm 9.15.4. Workspace package globs already include
Story; its TypeScript project reference and lockfile importer are explicit.

Deferred: real PostgreSQL deployment integration, host/MCP handler wiring,
production writer/reviewer/research adapters, and crash-resumable scheduling.
Screenplay and external stage execution remain outside P2. Formal PlanningBaseline
approval remains exclusively in the existing P1 service.
