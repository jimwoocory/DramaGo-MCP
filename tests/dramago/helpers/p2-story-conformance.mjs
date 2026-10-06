// Offline cross-record oracle. Content schema/semantics use the actual runtime
// validator; receipt, graph and candidate assertions remain independent checks.
import assert from 'node:assert/strict';
import { canonicalHash } from '../../../packages/dramago-application/domain.js';
import { exactRef } from './p2-story-fixtures.mjs';
import { policy, assertShape as shape, contentType, validateContent, researchSnapshot } from '../../../packages/dramago-contracts/story-validator.mjs';
export { policy };
const same = (a, b, message) => assert.deepEqual(a, b, message);
const unique = (values, message) => assert.equal(new Set(values).size, values.length, message);
const walkRefs = (value, visit) => {
  if (!value || typeof value !== 'object') return;
  if (value.artifact_id && value.version_id && value.content_digest && !value.schema_version) visit(value);
  else for (const child of Object.values(value)) walkRefs(child, visit);
};

// Pure offline admission oracle. null means admissible, not executed. This
// neither writes a receipt nor invokes a port; production must enforce atomicity.
export function checkSubmission({ project, context, request, tool, receipt }) {
  assert.ok(['dramago_story_step_run', 'dramago_planning_review'].includes(tool), 'P2 tool allowlist');
  shape(tool === 'dramago_story_step_run' ? 'step_request' : 'review_request', request);
  shape('drama-project.schema.json', project);
  same(request.project_id, project.project_id, 'request ownership');
  if (receipt) {
    same([receipt.workspace_id, receipt.project_id, receipt.tool, receipt.idempotency_key],
      [project.workspace_id, project.project_id, tool, request.idempotency_key], 'receipt scope');
    same(receipt.payload_digest, canonicalHash(request), 'IDEMPOTENCY_CONFLICT');
    shape('run_result', receipt.result);
    return receipt.result;
  }
  same(request.expected_revision, project.revision, 'STALE_REVISION');
  shape('artifact-version.schema.json', context);
  shape('run_context', context.content);
  same(exactRef(context), request.context_ref, 'exact context reference');
  same(context.content_digest, canonicalHash(context.content), 'context digest');
  same([context.workspace_id, context.project_id], [project.workspace_id, project.project_id], 'context ownership');
  same(context.content.project_revision, request.expected_revision, 'context revision');
  same(context.content.planning_scope, project.planning_range, 'context scope');
  same(context.content.operation, request.step ?? 'planning_review', 'context operation');
  return null;
}

export function checkBundle({ project, artifacts, runs, candidate }) {
  shape('drama-project.schema.json', project);
  unique(artifacts.map(a => a.version_id), 'immutable version identity');
  const index = new Map(artifacts.map(a => [a.version_id, a]));
  const resolve = ref => {
    shape('artifact_ref', ref);
    const record = index.get(ref.version_id);
    assert.ok(record, 'missing exact reference');
    same(exactRef(record), ref, 'exact reference digest and identity');
    return record;
  };
  for (const a of artifacts) {
    shape('artifact-version.schema.json', a);
    same([a.workspace_id, a.project_id], [project.workspace_id, project.project_id], 'reference ownership');
    same(a.content_digest, canonicalHash(a.content), 'artifact content digest');
    const type = contentType(a.content);
    if (a.content.run_context_ref) assert.ok(type, 'unknown Story proposal content type');
    if (type) { shape(type, a.content); same(a.kind, policy.content_kinds[type], 'content kind'); }
    walkRefs(a.content, resolve);
  }
  walkRefs(project.planning_range, resolve);
  const declared = project.planning_range;
  const range = resolve(declared.definition_ref);
  same(range.kind, 'planning_range', 'declared scope kind');
  same(range.content, { workspace_id: project.workspace_id, project_id: project.project_id,
    range_id: declared.range_id, ordered_episode_ids: declared.ordered_episode_ids }, 'declared scope bytes');
  const typed = (ref, type) => {
    const record = resolve(ref);
    same(contentType(record.content), type, `reference content type: ${type}`);
    return record;
  };
  for (const a of artifacts) {
    const c = a.content, type = contentType(c);
    if (c.run_context_ref) validateContent(a, typed(c.run_context_ref, 'run_context').content, artifacts);
    if (type === 'research_snapshot') researchSnapshot(a, true);
    if (c.planning_scope) same(c.planning_scope, declared, 'exact declared scope');
    if (type === 'episode_outline_set') {
      same(c.ordered_episodes.map(e => e.episode_id), declared.ordered_episode_ids, 'episode coverage and order');
      for (const entry of c.ordered_episodes) {
        const outline = typed(entry.outline_ref, 'episode_outline');
        same([outline.episode_id, outline.content.episode_id], [entry.episode_id, entry.episode_id], 'episode reference identity');
      }
    }
    if (type === 'season_architecture') same(c.ordered_episode_ids, declared.ordered_episode_ids, 'season scope');
    if (type === 'research_snapshot') {
      unique(c.sources.map(s => s.source_id), 'research source identity');
      unique(c.claims.map(s => s.claim_id), 'research claim identity');
      for (const claim of c.claims) for (const id of claim.source_ids) assert.ok(c.sources.some(s => s.source_id === id), 'research source missing');
      for (const source of c.sources) assert.ok(Date.parse(source.captured_at) <= Date.parse(c.as_of), 'research capture after snapshot');
    }
  }
  const produced = new Set();
  unique(runs.map(run => run.run_id), 'durable run identity');
  for (const run of runs) {
    shape('creative-run.schema.json', run);
    same([run.workspace_id, run.project_id, run.domain], [project.workspace_id, project.project_id, 'story'], 'run ownership');
    same(run.input_manifest_digest, canonicalHash(run.input_manifest), 'fixed input manifest digest');
    walkRefs(run.input_manifest, resolve);
    const contextRef = run.input_manifest.input_refs[0];
    const c = typed(contextRef, 'run_context').content, rule = policy.steps[c.operation];
    for (const name of rule.required_bindings) typed(c.bindings[name], name);
    if (c.research.status === 'supplied') typed(c.research.snapshot_ref, 'research_snapshot');
    const episodeRefs = c.operation === 'planning_review'
      ? typed(c.bindings.episode_outline_set, 'episode_outline_set').content.ordered_episodes.map(e => e.outline_ref) : [];
    const expectedInputs = [contextRef, declared.definition_ref, c.executor.configuration_ref,
      ...rule.required_bindings.map(name => c.bindings[name]), ...c.source_refs,
      ...(c.research.status === 'supplied' ? [c.research.snapshot_ref] : []), ...episodeRefs];
    const distinct = refs => [...new Map(refs.map(ref => [canonicalHash(ref), ref])).values()];
    same(run.input_manifest.input_refs, distinct(expectedInputs), 'fixed input refs');
    same(run.input_manifest.policy_version, c.policy_version, 'fixed input policy');
    same(run.steps.length, 1, 'one Story operation per run');
    same(run.steps[0].stage, `story.${c.operation}`, 'fixed Story operation');
    for (const attempt of run.steps[0].attempts) {
      same(attempt.input_manifest_digest, run.input_manifest_digest, 'attempt fixed manifest');
      walkRefs(attempt.output_refs, resolve);
      const outputs = attempt.output_refs.map(resolve);
      const expectedTypes = c.operation === 'episode_outlines'
        ? [...declared.ordered_episode_ids.map(() => 'episode_outline'), 'episode_outline_set'] : rule.outputs;
      same(outputs.map(a => contentType(a.content)), expectedTypes, 'complete output types');
      if (c.operation === 'episode_outlines') {
        const entries = outputs.slice(0, -1).map(a => ({ episode_id: a.episode_id, outline_ref: exactRef(a) }));
        same(entries.map(e => e.episode_id), declared.ordered_episode_ids, 'episode output coverage and order');
        same(outputs.at(-1).content.ordered_episodes, entries, 'episode set must bind exact same-attempt outputs');
      }
      if (c.operation === 'direction') {
        const claims = outputs[0].content.market_claim_ids;
        if (c.research.status === 'omitted') same(claims, [], 'direction without research cannot claim market evidence');
        else {
          const snapshot = typed(c.research.snapshot_ref, 'research_snapshot').content;
          for (const id of claims) assert.ok(snapshot.claims.some(claim => claim.claim_id === id), 'direction research claim missing');
        }
      }
      for (const output of outputs) {
        assert.ok(!produced.has(output.version_id), 'immutable output cannot be silently reused');
        produced.add(output.version_id);
        same(output.content.run_context_ref, contextRef, 'output context reference');
        const siblingRefs = contentType(output.content) === 'episode_outline_set'
          ? output.content.ordered_episodes.map(e => e.outline_ref) : [];
        same(output.content.dependency_refs, distinct([...expectedInputs, ...siblingRefs]), 'exact output dependencies');
      }
    }
  }
  for (const a of artifacts.filter(a => a.content.run_context_ref)) assert.ok(produced.has(a.version_id), 'proposal requires durable run');
  const reviewSubjects = context => {
    const bindings = context.bindings;
    const set = typed(bindings.episode_outline_set, 'episode_outline_set').content;
    return [declared.definition_ref, ...policy.steps.planning_review.required_bindings.map(name => bindings[name]),
      ...set.ordered_episodes.map(e => e.outline_ref), context.research.snapshot_ref];
  };
  for (const a of artifacts.filter(a => contentType(a.content) === 'planning_review_evidence')) {
    const c = a.content, context = typed(c.run_context_ref, 'run_context').content;
    same(context.operation, 'planning_review', 'review operation');
    const inspected = reviewSubjects(context);
    same(c.inspected_refs, inspected, 'complete exact inspected review subjects');
    const core = [declared.definition_ref, ...['story_foundation', 'story_bible', 'master_outline', 'season_architecture'].map(n => context.bindings[n]),
      ...typed(context.bindings.episode_outline_set, 'episode_outline_set').content.ordered_episodes.map(e => e.outline_ref)];
    same(c.subject_refs, core, 'exact core review subjects');
    same(c.reviewer_id, context.executor.executor_id, 'reviewer invocation identity');
    const writers = [...new Set(c.inspected_refs.map(resolve).filter(s => s.content.run_context_ref)
      .map(s => typed(s.content.run_context_ref, 'run_context').content.executor.executor_id))].sort();
    same(c.reviewed_writer_ids, writers, 'reviewed writer identities');
    assert.ok(!writers.includes(c.reviewer_id), 'writer cannot be its own reviewer');
    unique(c.findings.map(f => f.finding_id), 'finding identities');
    same(c.blockers, c.findings.filter(f => f.severity === 'blocker').map(f => f.finding_id), 'blocker identities');
    const subjects = new Set(c.inspected_refs.map(canonicalHash));
    for (const finding of c.findings) for (const ref of finding.subject_refs) assert.ok(subjects.has(canonicalHash(ref)), 'finding subject outside review');
  }
  if (candidate === undefined) return; // A blocked review remains a valid durable fact.
  shape('baseline_candidate', candidate);
  walkRefs(candidate, resolve);
  same([candidate.workspace_id, candidate.project_id, candidate.range_id, candidate.range_definition_ref, candidate.policy_version],
    [project.workspace_id, project.project_id, declared.range_id, declared.definition_ref, policy.policy_version], 'candidate scope');
  for (const wrapper of candidate.review_evidence) {
    const evidence = typed(wrapper.evidence_ref, 'planning_review_evidence').content;
    same(evidence.outcome, 'PASS', 'candidate requires PASS evidence');
    same(wrapper.subject_refs, evidence.subject_refs, 'candidate review subjects');
    const context = typed(evidence.run_context_ref, 'run_context').content;
    for (const key of ['story_foundation', 'story_bible', 'master_outline', 'season_architecture']) {
      same(candidate[key], context.bindings[key], `candidate exact ${key}`);
    }
    same(candidate.ordered_episodes, typed(context.bindings.episode_outline_set, 'episode_outline_set').content.ordered_episodes, 'candidate episode scope');
  }
}
