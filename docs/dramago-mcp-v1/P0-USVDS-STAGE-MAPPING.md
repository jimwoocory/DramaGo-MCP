# DramaGo MCP V1 — External USVDS stage mapping

> **Historical relocation intake record.** The fact layer and composition described below as future work have now landed in the integrated DramaGo-MCP relocation baseline. See [P1-INTEGRATED-STATUS.md](P1-INTEGRATED-STATUS.md) for current implementation status. P0 invariants and exclusions remain authoritative where not superseded.


Status: contract and adapter policy, not creative execution. This branch contains no stage invocation, Story runtime, Drama application/persistence or dispatcher. The new DramaGo-MCP repository owns composition; USVDS remains an external frozen read-only capability source.

## 1. Authority and interpretation

This mapping substantively revises the six-document source at contracts pin `8ef5218` under the relocation salvage manifest. See [P0-SOURCE-BASELINE.md](P0-SOURCE-BASELINE.md) for exact roles and source paths. Historical stage descriptions below are inherited source evidence, not newly executed stage validation.

External source paths `core/usvd-v9/skills/*/SKILL.md`, `core/usvd-v9/contracts/` and the controller identify upstream rules only. They are not local links or instructions to vendor/edit those files. Keep stage names, identifiers and professional restrictions. Any future change to external USVDS requires separate approval; this relocation does not extend stages 01/02 or regenerate their distributions.

Story Development is reserved future ownership in new-repository `packages/story-development`. Additional planning artifacts, full-scope checks and orchestration must be implemented there and in the Drama application/adapter boundary, not by changing external 01/02. Consume the existing Bible authority without creating a competing editable Bible inside Media. Story and Script share a DramaProject; a Planning Baseline is an internal transition, not a second product handoff.

## 2. Exact 01–09 mapping

| Stage / retained skill name | Domain | Frozen external capability | New-repository adapter/domain obligation |
| --- | --- | --- | --- |
| 01 / `usvd-01-adaptation` | Story Development | Story Promise, functional-equivalent adaptation, reconstructed social logic; Adaptation Brief and US Project Contract, not Bible/screenplay | Conditional adaptation. Original work may record reasoned `not_applicable`, but still needs its project contract. Preserve input/output identity and provenance. Do not expand external 01 or treat its APPROVED text as formal approval. |
| 02 / `usvd-02-story-architecture` | Story Development | Mode A creates Bible; mutually exclusive mode B creates target episode Beat Sheet from BIBLE APPROVED. Includes relationships/Story Engine, Canon, season/arc ladder and promise/reveal/state changes | Retain A/B unchanged. Future Story layer owns complete causal master/episode outlines and declared-scope coverage outside USVDS; adapter derives traceable legacy Bible/Beats views from fixed owned versions. Six beats alone do not prove completeness or mint Planning approval. |
| 03 / `usvd-03-screenwriter` | Script-USVDS | Approved Bible/target Beats, target duration and applicable prior continuity; screenplay draft, Beat-to-scene trace, runtime estimate and Continuity Delta; no self-PASS | Formal screenplay starts only after complete approved immutable Planning Baseline. Supply exact episode/outline/Bible/continuity slice with version/hash provenance, never mutable latest or invented missing planning. |
| 04 / `usvd-04-review-continuity` | Script-USVDS | Script Doctor first; Mandatory Fail overrides scores. REWRITE/REJECT/BLOCKED stop; only PASS proceeds to continuity. Blocked continuity is proposed, not accepted | Bind all evidence to the same screenplay version/hash. Accept continuity with CAS; publish per-episode immutable Script Baseline only after Doctor PASS, Continuity CLEAR and separate authorized approval with effective Planning approval. |
| 05 / `usvd-05-asset-lock` | Production | Stable CHAR/LOOK/SET/PROP, Asset Creation Pack, approval/lock discipline; no VIDEO/SHOT splitting or final video prompt | Pin approved Script provenance. Separate asset-plan approval, generated candidate references and adoption. Media Asset remains a file resource, not creative identity; historical lock text is evidence only. |
| 06 / `usvd-v9-06-storyboard` | Production | Model-independent source coverage, VIDEO/SHOT plan, timing closure, continuity, shot/audio events; no final model prompt | Bind fixed script/assets/upstream versions. Importer-inferred prompts, independent/ready flags do not authorize execution. Preserve stable identities and professional coverage. |
| 07 / `usvd-v9-07-performance-cinematography` | Production | Blocking, eyeline, performance, composition, camera/focus/light/cut motivation; preserves 06 timing/dialogue/identity, no final prompt | Keep fixed storyboard references and exact-package review. Legacy VIDEO audio fallback must be evidence-constrained; ambiguous ownership blocks/reviews rather than duplicates audio by guess. |
| 08 / `usvd-v9-08-seedance-2-mini-adapter` | Production | Compiles 06/07 into Seedance 2.0 Mini English VIDEO master / SHOT delta prompts with verified endpoint capability profile, budgets and degradation records | Creative compiler only, never Media Provider Adapter or direct submission. Explicitly distinguish creative `target_model` from routing `public_model_id`. Preserve stable refs/capability evidence; no multi-model compiler framework in this batch. |
| 09 / `usvd-v9-09-prompt-qa` | Production | Machine checks and human checklist, stable defects, targeted return to 06/07/08/upstream; optional bounded reviewer after machine PASS, no silent upstream rewrites | Bind QA to exact production package. `dramago_stage09_review` remains Production-only. QA PASS cannot replace Script/package approval, fee authorization or result adoption, and cannot review Story. |

The external skill directories are `01-adaptation`, `02-story-architecture`, `03-screenwriter`, `04-review-continuity`, `05-asset-lock`, `06-storyboard`, `07-performance-cinematography`, `08-seedance-2-mini-adapter`, `09-prompt-qa`. Their source metadata does not grant permission to copy `core/usvd-v9` or `dsh-plugin`.

## 3. Reserved Story flow and exact baseline references

Future Story flow is direction, conditional adaptation, Bible, complete master outline, season/episode architecture, complete episode outlines, independent planning review, then authorized Planning approval. Each command specifies a single step/scope; no hidden auto-advance. New-repository `story-direction`, `story-master-outline`, `story-planning-review` are reserved future skills, not implementations in this branch or patches to external stages.

Planning freezes the predeclared complete season/scope and ordered episode IDs, direction/adaptation applicability, Bible/Canon/engines, full master outline, architecture, all complete outlines, promise/reveal/continuity planning, version IDs/content hashes, schema/policy versions and exact review/approval references. Reject missing/duplicate episodes, foreign/dangling references, unresolved Canon/blockers and retrospective scope shrink.

Script freezes per episode: Planning Baseline, outline, screenplay version/hash, Beat-to-scene trace, Doctor/Mandatory Fail evidence, continuity input/accepted output, policy and formal approval. Review evidence must resolve real artifacts and the exact subject. An old review cannot approve revised content. Candidates are fixed before approval; new versions append rather than mutate either baseline. Revocation appends decisions/impact events for the precise owned predecessor and does not erase history or costs.

Planning Canon is intended story fact; accepted Script continuity is implementation fact. Neither belongs in generic Media. Audience assumptions, market claims, craft scores, runtime estimates or dialogue heuristics cannot replace evidence or be presented as a complete deterministic duration verifier. Independent review is required; a separate subagent is optional and cannot approve its own output.

## 4. Production gates and separate cost authority

Keep two typed plans to avoid a Stage 05 reference-image dependency cycle:

- `asset_generation_plan`: approved Script Baseline plus reviewed and formally approved asset plan. Reference-image generation must not require unfinished 06–09.
- `video_production_package`: approved Script Baseline, required asset locks, fixed 06/07 director plans, final 08 prompt, 09 QA and formal package approval.

Preparation persists intent and obtains a Quote without Provider submission. Execution rechecks current versions/gates, owned unexpired matching Quote and explicit fee confirmation or valid bounded auditable Workspace preauthorization. Creative approval is not spending permission. Recover the original intent/Job/key after interruption; unknown/reconciling is not a new-generation button. Deliberate regeneration requires an explicit new attempt and authorization.

Media success with ready archived Assets yields `review_required`, not approval. Separate authenticated Drama adoption checks exact candidate/project/source/target/revision and appends a binding/decision without mutating the Job. Stale outputs remain observable with costs/history but cannot overwrite newer or approved targets. Standalone Media tools need no Drama fields and cannot confer Drama authority.

## 5. Controller and controlled review

Keep `usvd-controller` as the frozen single-next-stage router, not a database workflow engine. Preserve `writing-only` versus `full-production`; do not force 05–09 on writing-only work. New-mode writing completion additionally requires formal Script Baseline; legacy completion stays labelled legacy.

Controller and 01–08 must not autonomously delegate, parallel-spawn or recursively invoke subagents. The 09 exception remains opt-in after machine PASS, for explicit request or recorded subjective question: one focused, tool-free, read-only reviewer, depth one, bounded 6000-token context and time/budget. No project mutation, further delegation, approval or media submission. Unavailable/failed review is `REVIEW NOT RUN`, never fabricated PASS.

Preserve local Stage 09 input `qa_gate=PASS`, `qa_summary`, `trigger` (`user_requested` / `subjective_open_question`), `review_question`, `stable_refs`, `required_evidence`; preserve output `provider`, host `run_id`, `estimated_tokens`, `review_status`, `defects`, `return_to_stage`, `evidence`. Host `run_id` is not automatically a durable Creative Run. Source code presence and catalog declaration do not prove registration or execution in the target.

## 6. Later acceptance, not results of this document

Verify adapters against the pinned external capability identity and its canonical rules, without altering that source. Test legacy A/B separately from complete-scope new-mode approval. Negative cases must reject incomplete planning, stale review, unauthorized approval, Mandatory Fail hidden by score, continuity CAS conflicts, Story formal screenplay, 08 Provider submission, 09 Story review, missing capability evidence and QA used as fee approval.

Parent integration runs contract gates in [P0-ACCEPTANCE-GATES.md](P0-ACCEPTANCE-GATES.md). Later runtime owners supply real stage/adapter, fact-layer and production evidence. Historical source tests/DSH closure do not certify this new application; this document claims no stage handler has run.
