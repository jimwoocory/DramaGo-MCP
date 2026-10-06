import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createInstanceValidator } from '../../scripts/dramago-schema-instances.mjs';

const directory = new URL('../../packages/dramago-contracts/contracts/', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, directory), 'utf8'));
const library = 'story-development.schema.json';
function validate(definition, value) {
  const schemas = new Map(readdirSync(directory).filter(f => f.endsWith('.schema.json')).map(f => [f, read(f)]));
  schemas.set('subject.schema.json', { $ref: `${library}#/$defs/${definition}` });
  const validator = createInstanceValidator(schemas);
  assert.deepEqual(validator.errors, [], 'schema preflight');
  return validator.validate(value, 'subject.schema.json');
}
const research = () => ({
  schema_version: 'dramago.research-snapshot/v1', data_class: 'synthetic',
  as_of: '2026-01-01T00:00:00Z', territories: ['US'], question: 'Synthetic market question',
  sources: [{ source_id: 'source_a', locator: 'https://example.invalid/source', title: 'Fixture only',
    captured_at: '2026-01-01T00:00:00Z', content_digest: `sha256:${'b'.repeat(64)}`, excerpt: 'Synthetic observation' }],
  claims: [{ claim_id: 'claim_a', statement: 'Fixture claim, not current market data', source_ids: ['source_a'] }],
  limitations: ['Synthetic test evidence; not usable as live market research'],
});

test('research snapshots retain provenance, capture time, source digests and supported claims', () => {
  assert.deepEqual(validate('research_snapshot', research()), []);
  for (const mutate of [v => delete v.as_of, v => { v.sources = []; },
    v => delete v.sources[0].content_digest, v => { v.claims[0].source_ids = []; },
    v => { v.sources[0].captured_at = 'today'; }, v => { v.approved = true; }]) {
    const value = research(); mutate(value);
    assert.ok(validate('research_snapshot', value).length);
  }
  assert.deepEqual(validate('research_selection', { status: 'omitted', reason: 'Initial ideation only' }), []);
  assert.deepEqual(validate('research_selection', { status: 'supplied', snapshot_ref: ref('research') }), []);
  assert.ok(validate('research_selection', { status: 'omitted' }).length);
  assert.ok(validate('research_selection', { status: 'supplied', snapshot_ref: ref('research'), reason: 'silent fallback' }).length);
});

test('structured planning proposals capture direction, Bible, causal arc and complete episode planning', () => {
  const origin = { run_context_ref: ref('context'), dependency_refs: [ref('context'), ref('idea')] };
  const beat = { beat_id: 'beat_a', cause: 'A debt is called in', action: 'She exposes the lender', consequence: 'Her ally is implicated', predecessor_ids: [] };
  const values = {
    direction: { logline: 'Fixture', audience: 'Fixture', genre: 'Thriller', tone: 'Tense', story_promise: 'Justice at a cost', differentiation: 'Fixture', market_claim_ids: [] },
    story_foundation: { premise: 'Fixture', theme: 'Trust', conflict: 'Debtor versus lender', stakes: 'Family',
      adaptation: { mode: 'original', source_refs: [], decisions: ['Original premise'] } },
    story_bible: { characters: [{ character_id: 'char_a', want: 'Freedom', need: 'Trust', contradiction: 'Lies for honesty' }],
      relationships: ['Ally becomes rival'], story_engine: 'A debt creates a new obligation', canon_rules: ['Debt cannot be erased'],
      promises: [{ promise_id: 'promise_a', setup: 'An unsigned letter', payoff: 'Ally wrote it' }] },
    master_outline: { opening: 'Debt', ending: 'Cost paid', causal_beats: [beat], character_arcs: ['Learns trust'] },
    season_architecture: { ordered_episode_ids: ['ep_a'], movements: [{ movement_id: 'move_a', episode_ids: ['ep_a'], dramatic_function: 'Debt revealed', turning_point: 'Ally exposed' }],
      promise_schedule: [{ promise_id: 'promise_a', setup_episode_id: 'ep_a', payoff_episode_id: 'ep_a' }] },
    episode_outline: { episode_id: 'ep_a', title: 'Debt', opening_hook: 'A summons', causal_beats: [beat],
      ending_hook: 'Ally revealed', character_turns: ['Loses trust'], continuity_in: ['Debt owed'], continuity_out: ['Debt transferred'] },
    episode_outline_set: { planning_scope: { range_id: 'range_a', definition_ref: ref('range'), ordered_episode_ids: ['ep_a'] },
      ordered_episodes: [{ episode_id: 'ep_a', outline_ref: ref('ep_a') }] },
  };
  for (const [name, fields] of Object.entries(values)) {
    const value = { schema_version: `dramago.${name.replaceAll('_', '-')}/v1`, ...origin, ...fields };
    assert.deepEqual(validate(name, value), [], name);
    const bad = structuredClone(value); delete bad.dependency_refs;
    assert.ok(validate(name, bad).length, `${name} requires exact dependencies`);
    assert.ok(validate(name, { ...value, approved: true }).length, `${name} cannot approve`);
    assert.ok(validate(name, { ...value, dialogue: 'Formal screenplay is out of scope' }).length);
  }
  const adapted = { schema_version: 'dramago.story-foundation/v1', ...origin, ...values.story_foundation };
  adapted.adaptation.mode = 'adapted';
  assert.ok(validate('story_foundation', adapted).length, 'adaptation requires exact source refs');
});

const scope = () => ({ range_id: 'range_a', definition_ref: ref('range'), ordered_episode_ids: ['ep_a', 'ep_b'] });
const context = (step = 'direction') => ({
  schema_version: 'dramago.story-run-context/v1', policy_version: 'story-development/v1',
  operation: step, project_revision: 0, planning_scope: scope(), instructions: 'Synthetic task',
  executor: { role: 'writer', executor_id: 'writer_a', configuration_ref: ref('writer_config') },
  bindings: { idea: ref('idea') }, source_refs: [], research: { status: 'omitted', reason: 'Early ideation' },
});

test('step policy freezes exact inputs, research requirements, role separation and output kinds', () => {
  assert.ok(existsSync(new URL('story-development-policy.v1.json', directory)), 'missing frozen step policy');
  const policy = read('story-development-policy.v1.json');
  assert.deepEqual(Object.keys(policy.steps), ['direction', 'adaptation', 'bible', 'master_outline', 'season_architecture', 'episode_outlines', 'planning_review']);
  for (const [step, rule] of Object.entries(policy.steps)) {
    const value = context(step);
    value.bindings = Object.fromEntries(rule.required_bindings.map(name => [name, ref(name)]));
    value.executor.role = step === 'planning_review' ? 'reviewer' : 'writer';
    value.research = { status: 'supplied', snapshot_ref: ref('research') };
    assert.deepEqual(validate('run_context', value), [], step);
    const missing = structuredClone(value); delete missing.bindings[rule.required_bindings[0]];
    assert.ok(validate('run_context', missing).length, `${step}: required bindings`);
    assert.ok(validate('run_context', { ...value, bindings: { ...value.bindings, surprise: ref('x') } }).length);
    const omitted = { ...value, research: { status: 'omitted', reason: 'Unavailable' } };
    assert.equal(validate('run_context', omitted).length === 0, rule.research === 'optional', step);
    value.executor.role = value.executor.role === 'writer' ? 'reviewer' : 'writer';
    assert.ok(validate('run_context', value).length, `${step}: wrong role`);
    for (const output of rule.outputs) assert.ok(policy.content_kinds[output], `reserved kind for ${output}`);
  }
  assert.ok(validate('run_context', context('script_draft')).length);
  assert.ok(validate('run_context', { ...context(), project_revision: -1 }).length);
  const request = { project_id: 'project_a', expected_revision: 0, idempotency_key: 'request_a', step: 'direction', context_ref: ref('context') };
  assert.deepEqual(validate('step_request', request), []);
  for (const key of ['idempotency_key', 'expected_revision', 'context_ref']) {
    const bad = { ...request }; delete bad[key]; assert.ok(validate('step_request', bad).length);
  }
  assert.deepEqual(validate('run_result', { creative_run_id: 'run_a' }), []);
  assert.ok(validate('run_result', { creative_run_id: 'run_a', approved: true }).length);
});

test('review evidence is structured, records blockers, and cannot be a formal approval', () => {
  const evidence = {
    schema_version: 'dramago.planning-review-evidence/v1', run_context_ref: ref('review_context'), dependency_refs: [ref('review_context')],
    planning_scope: scope(), review_kind: 'planning', subject_refs: [ref('ep_a'), ref('ep_b')],
    inspected_refs: [ref('direction'), ref('ep_a'), ref('ep_b')],
    reviewer_id: 'reviewer_a', reviewed_writer_ids: ['writer_a'], outcome: 'PASS', findings: [], blockers: [],
  };
  assert.deepEqual(validate('planning_review_evidence', evidence), []);
  const finding = { finding_id: 'finding_a', code: 'CAUSAL_GAP', severity: 'blocker', subject_refs: [ref('ep_b')],
    message: 'Missing causal link', remediation: 'Connect the reversal to its cause' };
  const blocked = { ...evidence, outcome: 'BLOCKED', findings: [finding], blockers: ['finding_a'] };
  assert.deepEqual(validate('planning_review_evidence', blocked), []);
  assert.ok(validate('planning_review_evidence', { ...blocked, outcome: 'PASS' }).length);
  assert.ok(validate('planning_review_evidence', { ...evidence, outcome: 'FAIL' }).length);
  assert.ok(validate('planning_review_evidence', { ...evidence, approval_refs: [ref('approval')] }).length);
  assert.ok(validate('planning_review_evidence', { ...evidence, outcome: 'APPROVED' }).length);
  assert.deepEqual(read(library).$defs.baseline_candidate, { $ref: 'planning-baseline.schema.json#/properties/manifest' });
  assert.deepEqual(read(library).$defs.frozen_input.properties.input_manifest, { $ref: 'creative-run.schema.json#/properties/input_manifest' });
  assert.deepEqual(read(library).$defs.proposal_bundle.properties.proposals.items, { $ref: 'artifact-version.schema.json' });
  assert.deepEqual(validate('review_request', { project_id: 'project_a', expected_revision: 0, idempotency_key: 'review_a', context_ref: ref('review_context') }), []);
});

test('injected ports are separate, immutable, schema-bound contracts only', () => {
  const ports = read('story-development-policy.v1.json').ports;
  assert.ok(ports, 'missing explicit injected port contracts');
  assert.deepEqual(Object.keys(ports), ['ResearchContextPort', 'StoryGenerationPort', 'PlanningReviewPort']);
  assert.equal(ports.ResearchContextPort.method, 'resolve_snapshot');
  assert.equal(ports.ResearchContextPort.output_content, 'research_snapshot');
  assert.equal(ports.StoryGenerationPort.role, 'writer');
  assert.equal(ports.PlanningReviewPort.role, 'reviewer');
  assert.notEqual(ports.StoryGenerationPort.method, ports.PlanningReviewPort.method);
  for (const port of Object.values(ports)) {
    assert.equal(port.implementation_status, 'contract_only');
    assert.equal(port.can_approve, false);
    assert.ok(read(library).$defs[port.input_definition]);
    assert.ok(read(library).$defs[port.output_definition]);
  }
});

const ref = name => ({ artifact_id: `art_${name}`, version_id: `av_${name}`, content_digest: `sha256:${'a'.repeat(64)}` });

test('P2 reuses existing references and generic envelopes without changing their IDs', () => {
  assert.ok(existsSync(new URL(library, directory)), 'missing Story content definition library');
  const schema = read(library);
  assert.equal(schema.$id, 'https://schemas.dramago.invalid/p2/v1/story-development.schema.json');
  assert.deepEqual(schema.$defs.artifact_ref, { $ref: 'common.schema.json#/$defs/artifact_ref' });
  assert.deepEqual(schema.$defs.planning_scope, { $ref: 'drama-project.schema.json#/properties/planning_range' });
  for (const name of ['artifact-version', 'creative-run', 'planning-baseline', 'common']) {
    assert.equal(read(`${name}.schema.json`).$id, `https://schemas.dramago.invalid/p0/v1/${name}.schema.json`);
  }
  assert.deepEqual(validate('idea', { schema_version: 'dramago.story-idea/v1', premise: 'A fuzzy synthetic idea', constraints: [] }), []);
});
