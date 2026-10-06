# P2 Story Development contracts

DramaGo-MCP is the product and composition root. US-Vertical-Drama-Studio is an
external, read-only reference: no edits, vendoring, runtime imports or absolute
paths to it are introduced. Story Development owns fuzzy Idea through direction,
foundation/Bible, a complete causal master outline, season architecture, complete
ordered episode outlines, review evidence and an approval-ready Planning Baseline.
Formal screenplay (`dramago_script_draft`, Stage 03/04) and Production 05–09 are
outside P2. Model generation and review are never formal approval;
`dramago_planning_baseline_approve` remains the sole formal planning approval path.
Generic Media packages remain generic and unchanged.

## Status and assets

Base: `95a715725f8cb71f5b67a2fd15966d8d5c2579a5`. This branch owns contracts,
documentation and offline tests only. It does not implement Story services,
persistence writes, an approval path, provider integrations, UI, Remote MCP or a
queue. Existing fact-layer services are not replaced.

`@dramago/contracts/contracts/story-development.schema.json` is a Draft 2020-12
**definition library**. Validate a named `#/$defs/<name>`, not the unconstrained
library root. Its new stable ID is
`https://schemas.dramago.invalid/p2/v1/story-development.schema.json`.
`story-development-policy.v1.json` freezes `story-development/v1`, its ports,
step input bindings and output content types. Both are offline assets available
through the existing package wildcard export. No dependencies are added.

Existing P0 schema IDs and schemas are unchanged. In particular:

- Every persisted proposal uses the existing `artifact-version.schema.json`.
- Every reference uses `common.schema.json#/$defs/artifact_ref` verbatim.
- Scope reuses `drama-project.schema.json#/properties/planning_range`.
- Episode entries reuse the existing Planning manifest's `ordered_episodes`.
- Runs and their input manifests reuse `creative-run.schema.json`.
- `baseline_candidate` is a reference to the existing Planning **manifest** shape,
  not a second baseline envelope and not a published baseline.

The catalog's frozen authorization, mutability, idempotency, CAS and async result
metadata is unchanged. A content-schema branch does not justify promoting a
runtime implementation status. The separate Story policy declares
`implementation_status: contract_only`; the historical catalog is not a claim
that existing P1 fact-layer services are absent.

## Content types and artifact kinds

A content `schema_version` and its artifact `kind` MUST both match the following
mapping. The machine-readable `content_kinds` map is normative. Generic
`other_drama` alone does not identify a Story type and is not sufficient validation.
This uses the existing reserved extension kind instead of widening a frozen generic
fact enum or introducing another envelope. It does not change Media contracts.

| Content definition | `content.schema_version` | Existing artifact kind |
| --- | --- | --- |
| idea | `dramago.story-idea/v1` | other_drama |
| direction | `dramago.direction/v1` | other_drama |
| story_foundation | `dramago.story-foundation/v1` | story_foundation |
| story_bible | `dramago.story-bible/v1` | story_bible |
| master_outline | `dramago.master-outline/v1` | master_outline |
| season_architecture | `dramago.season-architecture/v1` | season_architecture |
| episode_outline | `dramago.episode-outline/v1` | episode_outline |
| episode_outline_set | `dramago.episode-outline-set/v1` | other_drama |
| research_snapshot | `dramago.research-snapshot/v1` | other_drama |
| run_context | `dramago.story-run-context/v1` | other_drama |
| planning_review_evidence | `dramago.planning-review-evidence/v1` | review_report |

Idea is an immutable human/imported input; it is not an invented generation step.
The foundation embeds applicable adaptation decisions. `adaptation.mode=adapted`
requires exact source refs; `original` records the explicit original-work decision.
There is no separate adaptation envelope. Bible reserves characters, relationships,
Story Engine, Canon rules and promise/payoff planning. Master outline includes
opening, ending, character arcs and ordered cause/action/consequence beats with
stable predecessor IDs. Season architecture maps movements and promise payoffs to
stable episode IDs. Episode outlines retain hooks, causal beats, character turns
and incoming/outgoing continuity, not screenplay dialogue or scene execution.

All generated content requires `run_context_ref` and exact `dependency_refs`.
Every accepted proposal becomes a new immutable ArtifactVersion; no replacement,
latest alias or auto-approval. Parent revisions use the existing `parent_ref`.
The application, not the model, validates identity, ownership, content schema,
digest, provenance and freshness of proposed version IDs before persistence.

## Step contracts

| Step | Required binding names, in manifest order | Outputs | Research |
| --- | --- | --- | --- |
| direction | idea | one direction | optional, explicit reason if omitted |
| adaptation | idea, direction | one story_foundation | required |
| bible | story_foundation | one story_bible | required |
| master_outline | story_foundation, story_bible | one master_outline | required |
| season_architecture | story_foundation, story_bible, master_outline | one season_architecture | required |
| episode_outlines | story_foundation, story_bible, master_outline, season_architecture | all episode_outline versions, then one episode_outline_set | required |
| planning_review | direction, story_foundation, story_bible, master_outline, season_architecture, episode_outline_set | one planning_review_evidence | required |

Only the first six are `dramago_story_step_run` steps. Planning review is a separate
tool/port. No subset of episodes, arbitrary step, Script or Production operation is
accepted. An original project still uses adaptation to crystallize its foundation.
Step bindings must be exactly the listed keys, with matching content types.
`source_refs` freezes additional adaptation/reference material; it is never an
unversioned URL or implicit prompt attachment. Foundation adaptation sources must
match its context's source refs. Revisions of shared inputs must be propagated:
selected Bible, master, season and outlines must depend on the same selected
foundation/Bible/master/season versions, not a mix of individually valid histories.

`step_request` requires `project_id`, `expected_revision`, `idempotency_key`,
`context_ref`, `step`. `review_request` has the same fields except `step`.
The immutable run context is prepared through existing artifact facilities before
submission. It contains operation, project revision, declared planning scope,
policy, instructions, exact input bindings, research selection and executor
configuration ref. The caller cannot change it during generation. Context scope,
revision and operation must agree with the request and current project on fresh
admission. Workspace and authorization are derived from trusted caller context;
executor configuration/identity must match the injected server-side port, not an
arbitrary client-supplied identity claim.

Both tools return `run_result = { creative_run_id }`, the existing durable
CreativeRun's `run_id`. Query the run for exact output refs; this response conveys
no review outcome, adoption or approval by itself.

## Injected ports and research boundary

Port names and schema definitions are recorded in the Story policy. They are
interface contracts, not implemented classes or provider SDK wrappers.

| Port / method | Input definition | Output definition | Responsibility |
| --- | --- | --- | --- |
| ResearchContextPort.resolve_snapshot | research_request | research_response | Resolve already frozen MarketEvidence |
| StoryGenerationPort.generate | frozen_input | proposal_bundle | Writer proposals for the selected step |
| PlanningReviewPort.review | frozen_input | proposal_bundle | Independent structured review evidence only |

`ResearchContextPort` is the explicit MarketEvidence port. Its input contains
workspace, project and an exact snapshot ref. The result must resolve that exact
ArtifactVersion, have the same ownership and digest, kind `other_drama` and content
`research_snapshot`. It MUST NOT silently refresh the snapshot, invent current
market observations or return a newer version. Acquisition of overseas/current
market evidence happens outside domain execution, through injected infrastructure,
and is persisted before the run is frozen. No domain code may directly invoke
web/browser tools, Hermes CLI, OpenAI or any provider SDK.

Research snapshots freeze an as-of time, territories, question, captured sources
with locators/excerpts/content digests, source-supported claims and limitations.
Source and claim IDs are unique within the snapshot; every claim's source IDs must
exist. Capture timestamps must not exceed `as_of`. Source content digests identify
retained source bytes (not merely the URL); snapshot `content_digest` separately
hashes its complete structured content. Research integrity/authenticity and
freshness policy remain infrastructure/review obligations, not facts established
by JSON Schema. A past `as_of` is not a claim of current data. Never fetch locators
implicitly while interpreting content.

`data_class=synthetic` is explicitly for offline fakes/tests; it MUST NOT be
presented or accepted as observed market evidence in a real-market execution.
`observed` likewise does not prove a source is truthful. Missing research is valid
only for direction, with `research.status=omitted` and a nonblank reason; it forbids
current-market claims (`market_claim_ids` must be empty). All other steps, including
final review, require a supplied immutable snapshot. Direction claim IDs must exist
in its frozen research snapshot. No fallback to model memory is market evidence.

`frozen_input` contains the context ref, the existing run manifest/digest and
resolved ArtifactVersions. The resolved artifact set is exactly the transitive
closure of the manifest's refs, once per immutable version, including referenced
contexts/configuration/source/outline records. Verify all owner/kind/ref/digest
pairs, reject cycles, unresolved refs and unused extra records, and deep-snapshot
inputs before an async port boundary. Ports have no repository writes or approval
capability. Provider/model/template/settings used by a port are frozen in its
configuration artifact; credentials never belong in these content records.

The writer returns ArtifactVersion proposals in a `proposal_bundle`, but for
`episode_outlines` it returns only the complete ordered episode proposals. The
application seals them and assembles the set from those exact persisted refs;
that set is the final run output. The reviewer receives the complete scope and
returns one review-report proposal, not rewritten Story content. The reviewer
port/invocation and trusted executor identity must be distinct from the writer
port and every writer of the reviewed subjects. Sharing a model backend does not
permit reusing a writer invocation/result as review. Configuration validation must
reject aliased writer/reviewer ports; caller-provided labels alone are not proof.

## Fixed manifests, replay and durable facts

Use existing canonical digest rules: SHA-256 over RFC 8785 canonical UTF-8 JSON.
Artifact digests hash `content`; run digests hash `input_manifest`; candidate
digests hash the unchanged Planning manifest. A syntactically valid digest is not
verification: recompute stored bytes and resolve every reference triple.

One P2 run performs one operation. Its fixed `input_manifest.input_refs` are,
in this order, with duplicate exact refs removed keeping the first occurrence:

1. The run context ref.
2. Declared planning range definition ref.
3. Executor configuration ref.
4. Required bindings in the table/policy order.
5. Context `source_refs`, in their declared order.
6. Supplied research snapshot ref, if present.
7. For planning review, every outline ref from the set in declared episode order.

The context pins all non-reference inputs, including policy, instructions,
operation, project revision and explicit research absence. Manifest policy equals
context policy. No in-run substitution of refs, settings or research is allowed.
Generated dependency refs equal this list. The assembled episode set additionally
appends its exact outline refs; these are outputs of the same run, not retroactive
run inputs. Step attempts repeat the same input digest. All persisted generated
versions must be linked to durable run outputs. Immutable versions cannot be
reused as newly generated output; changed content or inputs require new versions
and a new logical run. A schema's immutability declaration alone does not enforce
storage immutability.

Admission rules for the future application/persistence implementation:

1. Authenticate/authorize (`story.execute` or `story.review`), validate the request,
   and scope idempotency to workspace + project + tool + key.
2. Hash the complete normalized request object, including `expected_revision`,
   exact context ref, step when present, and idempotency key. No trimming or alias
   repair; JSON member order is immaterial, array order is not.
3. An existing receipt with the same payload digest returns its identical recorded
   `creative_run_id`/result without invoking a port, minting output versions or
   advancing revision, even if the project head has since advanced. A changed
   payload conflicts; it is not a new run. Authorization still precedes replay.
4. With no receipt, enforce expected-revision CAS and exact context revision/scope.
   Stale CAS and invalid dependencies fail before calling a writer/reviewer.
5. Atomically claim the request and persist the fixed CreativeRun/receipt before
   expensive execution; retain the same run identity during recovery. Seal valid
   outputs and terminal run evidence durably, with no silent partial success.
   Revalidate the project CAS on publication; stale generated proposals must not
   silently attach to a revised project. No background queue is required.

A successful review invocation can produce FAIL or BLOCKED. Run `succeeded`
means execution completed, not that creative quality passed. A failed/timed-out
review is never PASS; record a failed run or an explicit BLOCKED evidence report
if complete, valid structured evidence exists. A partial outline set must not be
reported as a successful complete set.

## Complete review and candidate assembly

Project scope is authoritative. Set scope, season scope, output episode IDs,
outline envelope/content episode IDs and candidate episodes must agree exactly
with the project's declared ordered scope, with no omission, duplicate, addition
or reordering. `uniqueItems` cannot enforce identity uniqueness across different
objects: resolution/semantic validation is mandatory. Changing scope requires an
explicit prior project revision and newly frozen range/context/review, never a
smaller range inferred from completed work.

For compatibility with the existing approval service, `review_kind` is exactly
`planning`, and `subject_refs` (also used in the baseline review wrapper) are:
range definition; foundation; Bible; master outline; season architecture; every
individual outline in declared order. The required `inspected_refs` records the
broader P2 scope, in order: range definition; direction; foundation; Bible; master
outline; season architecture; episode set; every individual outline; research
snapshot. These extra refs are hashed into the evidence content, not added to the
legacy core-subject wrapper. The review must inspect this whole
scope, including causal completeness, episode coverage, Canon/continuity,
promise/payoff planning, source support and unresolved blockers. Inputs include
all transitive dependencies; no sample-only or selected-episode PASS is valid.

Evidence records exact subjects/inspected refs/scope, reviewer identity, sorted unique actual
writer identities, structured findings (`finding_id`, code, severity, subject refs,
message, remediation), ordered blocker IDs and outcome. Finding IDs are unique;
finding subjects are a subset of the exact `inspected_refs`. `blockers` must
be exactly the blocker-severity findings in finding order. PASS requires no
blockers. FAIL/BLOCKED require at least one blocker with a reason/remediation.
PASS may retain nonblocking warnings. Reviewing a writer's own work under the
same executor identity is rejected; identities come from trusted execution facts.

A candidate builder, if later implemented, only assembles existing exact refs:

- Reuse the existing Planning manifest definition and field names.
- Bind current declared range, foundation, Bible, master, season and every outline.
- Include immutable PASS review wrappers whose exact evidence subjects match all
  selected planning versions. Direction, research and episode set remain pinned
  through mandatory evidence `inspected_refs` and content dependencies; no lossy
  new optional baseline fields are needed.
- Resolve every evidence artifact and its actual outcome/blockers. A wrapper that
  says PASS cannot conceal a BLOCKED or unrelated report.
- Allocate/freeze the existing baseline lookup identity (`planning_baseline_id`),
  artifact/version identity and manifest digest before approval, outside the
  manifest hash. The `baseline_candidate` definition describes the assembly's
  manifest payload only; existing baseline identity/publication conventions still
  apply. Do not invent a competing generic candidate fact envelope.
- Do not add `approval_refs`, `approved`, a decision, or a published-baseline claim
  to the manifest. Only the existing authorized
  `dramago_planning_baseline_approve` path can publish the baseline with genuine
  approval references. A model, review PASS, assembled manifest or successful run
  cannot call that path implicitly or supply its own approval authority.

## Verification boundary

See `P2-CONTRACT-ACCEPTANCE.md` for commands and evidence. Schemas check shape;
the test-only conformance oracle checks selected cross-record invariants over a
synthetic full planning graph. Neither is a production runtime validator or proof
of authenticated authorization, durable transactions, concurrent replay/CAS,
port isolation, live research authenticity, or real LLM quality. Those remain
acceptance work for the P2 application/persistence owners. Do not import the
fixture helpers into product runtime packages.
