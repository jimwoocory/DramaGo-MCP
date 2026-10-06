# DramaGo P0 core contracts

P2 adds `story-development.schema.json` (named content/port definitions) and
`story-development-policy.v1.json` (step/port/kind policy), without changing the
P0 schemas or generic envelopes described below. See
[the P2 Story contract](../../../docs/dramago-mcp-v1/P2-STORY-CONTRACTS.md) and
[offline acceptance](../../../docs/dramago-mcp-v1/P2-CONTRACT-ACCEPTANCE.md).
These additions are contracts/tests only, not Story runtime implementation.

## Scope and evidence

This directory freezes **P0 contract decisions**, not P1 business runtime. It adds
no server, repository, approval service, orchestration engine, provider call or
Media state transition. DramaGo-MCP is the primary repository and composition
root, built on hardened Media foundation `8f33226`. USVDS is an external,
frozen, read-only capability source (reference-only), not the composition root.
No `media-core` types are imported.

The complete contracts tree is selected from `8ef5218` and relocated to
`packages/dramago-contracts/contracts`. Package `@dramago/contracts` exposes
`./contracts/*` and `./catalog` as assets without registering runtime tools.
Historical catalog source metadata is retained, not asserted as current pins.
See `docs/dramago-mcp-v1/P0-SOURCE-BASELINE.md` for source roles and limitations.

Historical decision source: `meeting-consensus.md` in the local
`reviews/dramago-mcp-consolidation-v1` review set, especially sections 4.5, 7,
9.2–9.5 and 11. Backend report section 3 distinguishes `Job.version` from
content versions. Existing behavior is evidenced by the unchanged
`integrations/media-mcp/README.md` and adapter at the source baseline:

- Existing V10 narrow port: `quote_create`, `generate_image`, `generate_video`,
  `job_get`, `asset_get`; stable request-key and revision checks; successful
  ready results become `review_required`, never automatically approved.
- New P0 decisions here: Drama identities, immutable artifact references,
  Planning/Script manifests, formal decisions, Creative Runs and Drama-owned
  media execution links. Existing adapter records are not retroactively these
  new records.
- Unified transport/authentication, durable Quote/Budget authorization,
  persistence/CAS and production approval enforcement remain future work.
  A design document is not evidence that a Media MCP handler exists.
  FakeMediaMcpClient tests are not real Remote MCP E2E.

## Schema inventory and identity

All schemas use JSON Schema draft 2020-12. `$id` values under
`https://schemas.dramago.invalid/p0/v1/` are stable **offline identifiers**, not
URLs to fetch or a deployed schema service. Resolve all relative `$ref` values
from this directory. `common.schema.json` is a definition library, not an
instance schema. Every record and embedded frozen manifest has a fixed explicit
`schema_version`; a breaking shape change requires a new version and schema ID.
Unknown envelope/reference properties are rejected rather than silently ignored.
Artifact `content` is deliberately domain-specific JSON/text, not a fully typed
Story, screenplay or review payload schema in P0.

| File | Contract |
| --- | --- |
| `common.schema.json` | IDs, exact references, digests, actor and review evidence |
| `drama-project.schema.json` | Workspace/project identity and declared ordered planning range |
| `artifact-version.schema.json` | Immutable Drama content version, optional episode/parent reference |
| `approval-decision.schema.json` | Append-only authorized decision against exact target versions |
| `planning-baseline.schema.json` | Published full-range frozen planning manifest plus approval references |
| `script-baseline.schema.json` | Published per-episode frozen script manifest plus approval references |
| `creative-run.schema.json` | Fixed input manifest, separate creative status, steps and attempts |
| `media-execution-link.schema.json` | Drama execution intent linked to external quote/job/asset IDs |

Drama artifact IDs use `art_...`; immutable version IDs use `av_...`. They are
opaque identities, not numeric revisions. All content-version references contain
exactly `artifact_id`, `version_id`, `content_digest` (lowercase `sha256:` plus
64 hex characters). No `latest`/`head`/`current` version alias, numeric/stringified
Job version or generic `version` substitute is accepted. Renaming a Media state
counter to `av_...` is still invalid: resolution must find a real Drama version.

Project revision and attempt counters are not content versions. Existing EP,
CHAR, VIDEO, SHOT and Media IDs are not renamed; episode identity is scoped by
project. External Media IDs are opaque strings, not typed Drama references.
Baseline/approval IDs are stable record lookup identities. Whenever a baseline
or decision is used as a versioned dependency, its artifact reference is also
required; the ID-to-version mapping must be immutable and verified on resolution.

## Frozen manifests and approval cycle

A Planning manifest freezes workspace/project, a predeclared range ID and its
exact `range_definition_ref`, story foundation, Bible, master outline,
season/episode architecture, ordered episode-outline entries, PASS review
references with exact subjects, and policy version. Story foundation contains
direction and applicable adaptation decisions; Bible/architecture versions hold
characters, relationships, Story Engine, Canon and promise/reveal/continuity
planning. Those content responsibilities are not separate Media models.

`ordered_episodes` is the sole ordered episode manifest: every entry couples
`episode_id` with a mandatory complete `outline_ref`. There is no separate
optional outlines list or nullable completion placeholder. A missing outline
fails schema validation. The referenced range document must contain the frozen
workspace/project, range ID and complete `ordered_episode_ids` declared before
review; this is not inferred from however many outlines happen to be finished.

A Script manifest freezes one episode, `planning_baseline_id` and its exact
reference, the identical approved episode outline, screenplay, beat-to-scene
trace, continuity input/output, Doctor PASS evidence, Continuity CLEAR evidence
and policy version. Both review subjects must be the same exact screenplay.
Story Development ends at approved complete episode outlines; formal writing
starts in USVDS stage 03. Script approval may be per episode.

Baseline schemas describe **published immutable records**, not unapproved
candidates. Freeze candidate identity, manifest and digest first; review evidence
is already bound to exact input versions. An approval targets that manifest's
artifact reference. Publication attaches exact approval-decision references and
seals the whole record once. It must not replace candidate content. Approval
references are outside the manifest hash, avoiding a baseline→approval→baseline
hash cycle, but are immutable after publication. Revocation/supersession appends
separate records/events; it never edits the old manifest or its publication.
There is no writable baseline `approved` boolean.

An actor is `human` or `service_authorized`, with an exact authorization-evidence
reference. The service must derive actor identity from authenticated context,
not trust an input enum. A service actor requires an explicit applicable grant;
model review and Workspace membership confer no approval authority. Review PASS,
formal approval, budget authorization, Media success and creative adoption are
separate facts. Revocation requires `revoked_decision_ref` to the original exact
decision; approved/rejected decisions cannot use that field.

## Digest boundary

Normative digests are SHA-256 over UTF-8 RFC 8785 canonical JSON for these values:

- ArtifactVersion: `content` (including JSON quoting for string content).
- Planning/Script Baseline: the complete `manifest`, including its scope, schema,
  policy and review references; not the publication envelope/approval list.
- ApprovalDecision: the complete record except `artifact_id`, `version_id` and
  `content_digest`. Target and authorization references are therefore hashed.
- CreativeRun: `input_manifest`, stored as `input_manifest_digest`.
- MediaExecutionLink: `execution_intent`, stored as `intent_digest`.

The fixture checker enforces the fixture subset before using stdlib sorted
compact JSON (ASCII keys, valid Unicode strings, booleans, null, safe integers;
no floating-point values). Its JSON loader rejects duplicate keys and NaN/Infinity. This
subset has the same bytes as RFC 8785; the checker is **not** a general RFC 8785
implementation. Future writers must use a conforming canonicalizer and reject
non-I-JSON inputs, duplicate keys and invalid Unicode. Matching hash syntax alone
does not verify content. Artifact type, ownership, version identity and immutable
storage must also be verified; an equal hash does not confer permission.

## Creative execution and Media boundary

A Creative Run is not a Media Job. Its fixed input manifest is retained across
steps/attempts. Each attempt repeats that manifest digest; outputs are exact
artifact references. Changed inputs require a new Run, not mutation of the old
manifest. Step IDs and positive attempt numbers must be unique in their scope;
attempts are ordered. Status snapshots do not grant downstream approval.

A MediaExecutionLink is owned only by Drama. Its immutable intent binds the
project, precise target/production plan/Script Baseline versions, explicit
generation attempt, original request key/version, model and V10 workbench
revision. A prepared intent may omit quote/job/budget fields and has no assets.
A linked Job requires both Quote and separate budget-authorization evidence;
nonempty result asset IDs require a Job. The budget reference is a Drama-side
immutable receipt of the external authorization, not a creative approval or a
new Media budget authority. External receipt authenticity/limits/expiry and
Quote input digest must be checked by the future authorized service.

Retry/recovery must retain the original execution ID, intent and request key.
`v10-preserved` means the historical key is retained verbatim, never recomputed.
`dramago/v1` reserves the project/workspace-scoped future key domain; this schema
does not implement its generator or alter V10 behavior. Deliberate regeneration
requires a new execution intent/attempt and fresh cost authorization.

Quote/job/asset associations may be appended as facts arrive; the intent does
not change. There is deliberately no Media Job state/version setter, no success
inference, and no creative adoption status in this link. Result adoption belongs
to a separate authorized Drama decision/binding. Successful output is only a
candidate; stale results remain queryable without attaching to new versions.
Image-reference generation and video generation retain distinct production
gates; an image plan must not be forced through unfinished stages 06–09.

## Required semantic gates (not expressible by schema alone)

Conformance requires schema validation **and** record resolution/semantic gates.
Draft 2020-12 cannot compare arbitrary sibling arrays or dereference database
records. `uniqueItems` detects identical objects, not duplicate episode IDs with
different outlines. It cannot establish authentication, immutability or CAS.

Future application/persistence implementation must fail closed on:

1. Missing version, digest mismatch, wrong artifact kind or cross-workspace /
   cross-project / wrong-episode reference. Check every dependency, not just the
   baseline's outer ID.
2. Planning episode IDs not exactly equal, in order, to the frozen declared
   range; any duplicate, omitted or added episode; unresolved planning blockers.
   A newly narrowed range needs its own authorized declaration and review; it
   cannot silently replace the original range to conceal incomplete work.
3. Review evidence whose subjects/outcome do not match the frozen manifest;
   Doctor Mandatory Fail or Continuity not CLEAR; outline not from the selected
   Planning Baseline; mismatched continuity input/accepted output or stale CAS.
4. Approval reference resolving to a non-approval or non-approved decision,
   changed target digest, inappropriate/expired/revoked actor grant, policy
   mismatch, missing review evidence, or revoked upstream approval. Baseline IDs
   and artifact refs must resolve to the same records.
5. Changed Run input manifest, duplicate step/attempt identities or invalid
   workflow transitions. Status snapshots cannot prove valid execution history.
6. Wrong production-plan kind/gate, stale target revision, substituted budget
   receipt, mismatched/expired Quote, changed submission key, cross-workspace
   Job/Asset, or an attempt to treat media completion as creative adoption.

The local checker demonstrates coverage, reference/digest consistency, same-
screenplay evidence and exact approval targeting against a closed synthetic
fixture bundle. It is not a production validator, authorization verifier,
transactional store, general workflow engine or full semantic gate implementation.
No baseline immutability/CAS or real Media service is claimed tested here.

## Compatibility and local validation

These are additive contracts. Do not add required Drama fields to generic Media
tools, import Media Core, rewrite V10 records, recalculate old keys, or promote
legacy APPROVED/PASS text to formal decisions. Legacy content without evidence
stays legacy/unverified outside the published-baseline schemas. New readers must
be version-aware; unsupported new records are read-only or rejected, not silently
downgraded to legacy approval. No migration/runtime is implemented in this change.

From the repository root, with locally available Node (package engine >=22)
and Python 3.11+. Both checks use built-ins/standard library only:

```text
node scripts/validate-dramago-p0.mjs
python -B packages/dramago-contracts/contracts/validate_contracts.py
node --test tests/dramago/*.test.mjs
git diff --check
```

No installation or network access is performed. Responsibilities are separate:

1. **Static inventory**: the Node gate checks required documents, JSON parsing,
   schema metadata/IDs and baseline episode/version/digest/immutability declarations.
   It also enforces an independent Tool Catalog policy floor: each tool's
   mutability, authorization, idempotency, revision, maturity and async result,
   domain allowlists, and preserved five-media-tool contract statements. This is
   contract policy validation, not deployed authorization enforcement.
2. **Current-schema instance validation**: `scripts/dramago-schema-instances.mjs`,
   called by the same Node gate, selects schemas by each record's `schema_version`,
   not its filename. Every example and every supporting-artifacts array element
   is validated. Supported assertions/applicators are `$ref`, `type`, `properties`,
   `required`, `additionalProperties`, `const`, `enum`, `pattern`, `format`
   (`date-time`, asserted as RFC 3339 calendar/timezone syntax), `minLength`,
   `maxLength`, `minItems`, `uniqueItems`, `items`, `allOf`, `not`, `minimum`,
   `if`/`then`/`else`, and `dependentRequired`. Unicode lengths and JSON structural
   equality are used. `$defs` is traversed as a schema container.
   Preflight scans all schema locations, including unused definitions and
   unselected branches; unsupported keywords/formats, malformed supported
   keyword values and unresolved refs fail closed. Only `$schema`, `$id`,
   `title`, `description`, `$comment`, `readOnly`, and `x-immutable` are accepted
   as non-assertion metadata; new annotations require explicit review too.
   References resolve only within the loaded local schema set (file/ID and JSON
   Pointer), never via network. Nested `$id` resources and other dialects are
   rejected; same-instance reference cycles fail rather than invert through `not`.
   This covers all currently used schema keywords, **not the entire Draft 2020-12
   vocabulary or its meta-schema**. Future schema features require validator and
   regression-test changes before the gate can pass.
3. **Cross-record semantic fixture tests**: Python retains a limited structural
   smoke walker plus exact reference/digest resolution, frozen range coverage,
   same-screenplay evidence and approval-target checks against synthetic records.
   It does not replace Node instance validation or fully implement semantic gates.
4. **Future production runtime**: authenticated authorization, durable approval,
   immutable persistence/CAS, MCP transport and real Media execution remain
   unimplemented/unverified by these offline checks.

Negative fixture vectors cover aliases/Job counters/missing digests, missing
outlines, partial/duplicate/reordered/foreign coverage, stale screenplay subjects,
model actors, mismatched approval targets, changed Run inputs and illicit
Media/adoption state fields. Passing these checks does not establish production
schema conformance or authorization.

`examples/` contains project, artifact, planning baseline, script baseline,
approval, script approval, Run and media-link records, plus
`supporting-artifacts.json` (an array whose elements each validate against
`artifact-version.schema.json`). The minimal fields describe a two-episode
range so a dropped episode is testable. All IDs, creative text, reviews,
authorizations, quotes/jobs/assets and model names are explicit synthetic
fixtures, not existing production facts, performed approvals or provider output.
