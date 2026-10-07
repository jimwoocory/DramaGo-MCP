# P2 Story Development runtime

DramaGo-MCP owns this package. US-Vertical-Drama-Studio is external/read-only;
there are no Media or USVDS runtime imports. The package stops at Story proposals
and planning-review evidence. Screenplay, production, external stage execution,
UI and crash-resumable scheduling are outside its scope. Model PASS is not
approval: the existing P1 ApprovalService is the sole formal approval path.

## Published contracts and composition

Import `StoryDevelopmentService` and its interfaces from
`@xiaoshuren/story-development`, injecting the existing tenant-bound Drama
repository (Memory, Journal or PostgreSQL). No new store or migration is needed.
All three ports are required; missing callables, identities or configuration
refs fail closed in the constructor:

- `StoryGenerationPort`: writer identity, exact `configuration_ref`, and
  `generate(frozen_input, signal)` returning `{ proposals: ArtifactVersion[] }`.
- `PlanningReviewPort`: distinct reviewer identity, exact `configuration_ref`,
  and `review(frozen_input, signal)` returning the same proposal-bundle shape.
- `ResearchContextPort`: `resolve_snapshot({ workspace_id, project_id,
  snapshot_ref }, signal)` returning the exact persisted research ArtifactVersion.
  It is an offline resolver, not a network client. Omitted research does not call it.

Ports receive detached, deeply frozen inputs, never repository or approval
capabilities. Identities, configuration refs and callables are captured at
construction; later host mutation cannot switch roles. The host must provide
authentic identities and trustworthy implementations.

Both commands require `project_id`, `expected_revision`, `idempotency_key` and
an exact `context_ref`; `runStep` also requires `step`. Workspace ownership comes
from the tenant-bound project, not a caller label. The immutable run context
binds operation, project revision, declared planning scope, executor identity
and configuration, typed bindings, source refs and explicit research selection.
The command response is only `{ creative_run_id }`; status lives in the durable run.

The checked-in `story-development-policy.v1.json` is authoritative. Runtime and
fixture conformance use the same published Story schemas and semantic validator.
`STEP_POLICIES` is derived from that policy, not maintained separately:

| Step | Required bindings | Outputs | Research |
|---|---|---|---|
| direction | idea | direction | optional |
| adaptation | idea, direction | story_foundation | required |
| bible | story_foundation | story_bible | required |
| master_outline | story_foundation, story_bible | master_outline | required |
| season_architecture | story_foundation, story_bible, master_outline | season_architecture | required |
| episode_outlines | story_foundation, story_bible, master_outline, season_architecture | ordered episode_outline records, application-assembled episode_outline_set | required |
| planning_review | direction, story_foundation, story_bible, master_outline, season_architecture, episode_outline_set | planning_review_evidence | required |

Validation includes role-specific content, causal predecessor order, season
movement membership and coverage, selected-Bible promise references, exact
adaptation source equality, and ordered episode coverage. Actual port outputs
and persisted facts pass through the same schema/semantic path as fixtures.

## Research provenance

Canonical `dramago.research-snapshot/v1` content contains `data_class`, `as_of`,
`territories`, `question`, `sources`, `claims` and `limitations`. Each source
retains a stable `source_id`, locator, title, capture timestamp, content digest
and nonblank excerpt. Each claim has a unique ID, statement and nonempty source
IDs that resolve within that snapshot. Invalid dates, capture after `as_of`,
model-memory locators, unsupported claims and legacy `evidence: null` fail closed.

Observed evidence is required by default. Synthetic fixtures require the trusted
host-only `allowSyntheticResearch: true` option (`allow_synthetic_research` is
also accepted); commands cannot opt in. This is structural provenance validation,
not certification of source truth or freshness. No market data is invented.

Structured `market_claim_ids` throughout inputs and outputs must be unique and
supported by the selected exact research snapshot. Without research, claim lists
must be empty. Research-port responses cannot substitute different bytes or refs.

## Dependencies and authorship

The service resolves exact transitive refs, including parents and configuration
records, with cycle rejection and a 4096-artifact bound. Ownership and body
digests are checked for every record, including historical revisions. The
manifest retains deterministic direct inputs; transitive bytes remain in the
frozen artifact graph. Outputs bind `run_context_ref` and exact `dependency_refs`.
Episode sets additionally bind every member outline.

Current selections come from semantic context bindings. Historical source and
parent refs do not replace current selections. Conflicting selected dependencies
fail regardless of traversal order. Revision parents retain artifact identity
and cannot substitute content or episode identity.

`authorship.ts` establishes service-generated authorship only through an actual
successful durable Story run keyed by the exact context, matching project and
workspace, recomputed manifest and full ordered refs, generating stage, successful
attempt and exact persisted output membership. Episode-set members must belong
to that same successful attempt. A copied output, caller label or matching digest
alone is not an authorship proof.

Reviewer independence covers every transitive creative ancestor, not just the
immediate subjects. Imported ideas and sources with unknown authorship fail
closed unless the optional trusted host `StoryAuthorshipPort.attest` returns
that exact `artifact_ref` and a nonempty list of independent `author_identities`.
The host must obtain these identities from authenticated import/creation metadata,
never from caller-supplied `generated_by` labels. Any reviewer coauthorship is
rejected. Structural metadata and canonical evidence do not establish creative
authorship; their creative dependencies still require verification.

## Admission, replay, publication and approval

Every call, including replay, is authorized. Admission uses the repository's
transactional idempotency lookup before mutable CAS prerequisites. An identical
payload replays the same run ID without calling ports; changed payloads conflict.
New admissions validate exact inputs, scope and provenance, then durably reserve
a running CreativeRun and the idempotent response before generation/review.

Output publication atomically checks fresh versions and project CAS, persists
outputs, finishes the run by run CAS and appends an audit event. Competing contexts
may compute, but only one project revision wins. Failure publishes no proposals
and records a sanitized error. A process crash can leave a durable running run;
there is no automatic resume queue. Do not wrap service calls in another transaction.

Port calls have a 30-second default timeout, configurable from 1 to 60000ms,
with AbortSignal and late-result discard. Ports must be cooperative, offline and
side-effect-free; JavaScript timers cannot preempt blocking synchronous code.
Invalid admission inputs and research resolution errors write nothing.

Planning-review evidence has exact `subject_refs` and `inspected_refs`, reviewer
and writer identities, structured findings and blocker finding IDs in order.
PASS requires no blockers; FAIL/BLOCKED require blockers and remain evidence,
not approval. Only separately authorized P1 human approval can create a formal
PlanningBaseline. Review itself creates neither approval nor baseline facts.

## Verification

    corepack pnpm run test:story-runtime
    corepack pnpm vitest run tests/dramago/story-research.test.ts tests/dramago/story-authorship.test.ts tests/dramago/story-content-validation.test.ts tests/dramago/story-runtime-conformance.test.ts
    corepack pnpm run test:dramago-story-contracts
    corepack pnpm typecheck
    git diff --check

The suites cover actual persisted runtime conformance, research and authorship
negatives, exact revisions and episode sets, journal reopen, CAS/idempotency,
independent review and the unchanged P1 approval boundary. Real PostgreSQL
integration remains a separate environment-dependent deployment gate.
