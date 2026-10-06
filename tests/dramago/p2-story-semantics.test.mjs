import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { storyFixture, exactRef, reseal } from './helpers/p2-story-fixtures.mjs';
import { canonicalHash } from '../../packages/dramago-application/domain.js';

const helper = new URL('./helpers/p2-story-conformance.mjs', import.meta.url);
async function oracle() {
  assert.ok(existsSync(helper), 'missing offline Story conformance oracle');
  return import(helper.href);
}
const artifact = (bundle, name) => bundle.artifacts.find(a => a.artifact_id === `art_${name}`);
// Reseal the graph after a deliberate semantic mutation, so a digest error does
// not accidentally stand in for the specific semantic gate being tested.
function rehash(bundle) {
  const replacements = new Map();
  const rewrite = value => {
    if (!value || typeof value !== 'object') return;
    if (value.artifact_id && value.version_id && !value.content && replacements.has(value.version_id)) {
      value.content_digest = replacements.get(value.version_id);
    }
    for (const child of Object.values(value)) rewrite(child);
  };
  for (const value of bundle.artifacts) {
    rewrite(value.content); reseal(value); replacements.set(value.version_id, value.content_digest);
  }
  rewrite(bundle.project); rewrite(bundle.candidate);
  for (const run of bundle.runs) {
    rewrite(run); run.input_manifest_digest = canonicalHash(run.input_manifest);
    run.steps[0].attempts[0].input_manifest_digest = run.input_manifest_digest;
  }
}

test('offline full Story fixture passes exact refs, manifests and candidate gates without approving', async () => {
  const { checkBundle } = await oracle();
  const bundle = storyFixture();
  checkBundle(bundle);
  assert.equal(bundle.runs.length, 7);
  assert.equal(Object.hasOwn(bundle.candidate, 'approval_refs'), false);
  assert.equal(bundle.artifacts.some(a => a.schema_version === 'dramago.approval-decision/v1'), false);
});

for (const [name, mutate] of [
  ['missing', entries => entries.pop()],
  ['duplicate identity with distinct refs', entries => { entries[1].episode_id = entries[0].episode_id; }],
  ['reordered', entries => entries.reverse()],
  ['extra', entries => entries.push({ episode_id: 'ep_c', outline_ref: entries[0].outline_ref })],
  ['wrong episode reference', entries => { entries[1].outline_ref = entries[0].outline_ref; }],
]) {
  test(`episode set rejects ${name} coverage even after resealing digests`, async () => {
    const { checkBundle } = await oracle(); const b = storyFixture();
    mutate(artifact(b, 'episode_outline_set').content.ordered_episodes); rehash(b);
    assert.throws(() => checkBundle(b), /episode/);
  });
}

test('season and set cannot silently revise declared ordered scope', async () => {
  const { checkBundle } = await oracle();
  for (const name of ['season_architecture', 'episode_outline_set']) {
    const b = storyFixture(); const content = artifact(b, name).content;
    (content.planning_scope ?? content).ordered_episode_ids.reverse(); rehash(b);
    assert.throws(() => checkBundle(b), /scope/);
  }
});

test('direction claims must exist in the frozen research snapshot', async () => {
  const { checkBundle } = await oracle(); const b = storyFixture();
  artifact(b, 'direction').content.market_claim_ids = ['invented_claim']; rehash(b);
  assert.throws(() => checkBundle(b), /direction research claim/);
});

test('direction without research accepts no claims and rejects invented research claims', async () => {
  const { checkBundle } = await oracle(); const b = storyFixture();
  artifact(b, 'context_direction').content.research = { status: 'omitted', reason: 'Early ideation only' };
  const direction = artifact(b, 'direction');
  direction.content.market_claim_ids = [];
  direction.content.dependency_refs = direction.content.dependency_refs.filter(r => r.artifact_id !== 'art_research');
  b.runs[0].input_manifest.input_refs = b.runs[0].input_manifest.input_refs.filter(r => r.artifact_id !== 'art_research');
  rehash(b); checkBundle(b);
  direction.content.market_claim_ids = ['claim_a']; rehash(b);
  assert.throws(() => checkBundle(b), /direction.*research/);
});

test('episode run outputs must retain the declared episode order', async () => {
  const { checkBundle } = await oracle(); const b = storyFixture();
  const refs = b.runs.find(r => r.run_id === 'run_episode_outlines').steps[0].attempts[0].output_refs;
  [refs[0], refs[1]] = [refs[1], refs[0]];
  rehash(b);
  assert.throws(() => checkBundle(b), /episode output/);
});

test('required research cannot be omitted and missing provenance cannot support a claim', async () => {
  const { checkBundle } = await oracle();
  const missing = storyFixture();
  artifact(missing, 'context_bible').content.research = { status: 'omitted', reason: 'Unavailable' }; rehash(missing);
  assert.throws(() => checkBundle(missing), /run_context/);
  const invented = storyFixture(); artifact(invented, 'research').content.claims[0].source_ids = ['nonexistent']; rehash(invented);
  assert.throws(() => checkBundle(invented), /research source/);
});

for (const [name, mutate, message] of [
  ['partial inspected scope', b => artifact(b, 'planning_review_evidence').content.inspected_refs.pop(), /inspected review subjects/],
  ['partial review subjects', b => artifact(b, 'planning_review_evidence').content.subject_refs.pop(), /review subjects/],
  ['writer posing as reviewer', b => {
    artifact(b, 'context_planning_review').content.executor.executor_id = 'writer_a';
    artifact(b, 'planning_review_evidence').content.reviewer_id = 'writer_a';
  }, /writer.*reviewer/],
  ['concealed writer identity', b => { artifact(b, 'planning_review_evidence').content.reviewed_writer_ids = ['unrelated']; }, /writer identities/],
  ['finding outside reviewed scope', b => { artifact(b, 'planning_review_evidence').content.findings = [{ finding_id: 'finding_a', code: 'NOTE', severity: 'warning',
    subject_refs: [exactRef(artifact(b, 'writer_config'))], message: 'Out of scope', remediation: 'Fix' }]; }, /finding subject/],
  ['blocker omitted from blocker IDs', b => { const c = artifact(b, 'planning_review_evidence').content;
    c.outcome = 'BLOCKED'; c.blockers = ['unrelated']; c.findings = [{ finding_id: 'finding_a', code: 'GAP', severity: 'blocker',
      subject_refs: [exactRef(artifact(b, 'ep_b'))], message: 'Gap', remediation: 'Fix' }]; }, /blocker identities/],
  ['blocked review candidate', b => { const c = artifact(b, 'planning_review_evidence').content;
    c.outcome = 'BLOCKED'; c.blockers = ['finding_a']; c.findings = [{ finding_id: 'finding_a', code: 'GAP', severity: 'blocker',
      subject_refs: [exactRef(artifact(b, 'ep_b'))], message: 'Gap', remediation: 'Fix' }]; }, /candidate.*PASS/],
  ['candidate version substitution', b => { b.candidate.story_bible = exactRef(artifact(b, 'idea')); }, /candidate/],
  ['candidate self-approval', b => { b.candidate.approval_refs = [exactRef(artifact(b, 'planning_review_evidence'))]; }, /baseline_candidate/],
]) {
  test(`planning review rejects ${name}`, async () => {
    const { checkBundle } = await oracle(); const b = storyFixture(); mutate(b); rehash(b);
    assert.throws(() => checkBundle(b), message);
  });
}

for (const [name, mutate, message] of [
  ['unfrozen research input', b => { b.runs[0].input_manifest.input_refs.pop(); }, /fixed input refs/],
  ['wrong binding content type', b => { artifact(b, 'context_bible').content.bindings.story_foundation = exactRef(artifact(b, 'idea')); }, /reference content type/],
  ['substituted output dependencies', b => { artifact(b, 'story_bible').content.dependency_refs.pop(); }, /output dependencies|fixed input refs/],
  ['missing durable output', b => { b.runs[0].steps[0].attempts[0].output_refs = []; }, /output types/],
  ['writer output masquerading as review', b => { b.runs[0].steps[0].attempts[0].output_refs = [exactRef(artifact(b, 'planning_review_evidence'))]; }, /output types/],
  ['missing durable run', b => { b.runs.shift(); }, /durable run/],
  ['run manifest ownership', b => { b.runs[0].project_id = 'other_project'; }, /run ownership/],
  ['unknown Story content version', b => { artifact(b, 'direction').content.schema_version = 'dramago.direction/v99'; }, /content type|unknown Story/],
]) {
  test(`fixed runs reject ${name}`, async () => {
    const { checkBundle } = await oracle(); const b = storyFixture(); mutate(b); rehash(b);
    assert.throws(() => checkBundle(b), message);
  });
}

test('BLOCKED is durable review evidence, not approval or a candidate', async () => {
  const { checkBundle } = await oracle(); const b = storyFixture();
  const c = artifact(b, 'planning_review_evidence').content;
  c.outcome = 'BLOCKED'; c.blockers = ['finding_a']; c.findings = [{ finding_id: 'finding_a', code: 'GAP', severity: 'blocker',
    subject_refs: [exactRef(artifact(b, 'ep_b'))], message: 'Gap', remediation: 'Fix' }];
  rehash(b); delete b.candidate;
  checkBundle(b);
  assert.equal(b.runs.at(-1).status, 'succeeded', 'successful review execution may find blockers');
});

for (const operation of ['direction', 'planning_review']) {
  test(`${operation}: offline admission contract pins CAS and replay-before-CAS semantics`, async () => {
    const { checkSubmission } = await oracle();
    assert.equal(typeof checkSubmission, 'function', 'missing admission contract oracle');
    const b = storyFixture(), context = artifact(b, `context_${operation}`);
    const tool = operation === 'direction' ? 'dramago_story_step_run' : 'dramago_planning_review';
    const request = { project_id: b.project.project_id, expected_revision: 0, idempotency_key: 'same_key', context_ref: exactRef(context),
      ...(operation === 'direction' ? { step: operation } : {}) };
    const input = { project: b.project, context, request, tool };
    assert.equal(checkSubmission(input), null, 'fresh request passes admission, does not execute a run');
    const stale = { ...input, project: { ...b.project, revision: 1 } };
    assert.throws(() => checkSubmission(stale), /STALE_REVISION/);
    const receipt = { workspace_id: b.project.workspace_id, project_id: b.project.project_id, tool, idempotency_key: request.idempotency_key,
      payload_digest: canonicalHash(request), result: { creative_run_id: `run_${operation}` } };
    assert.strictEqual(checkSubmission({ ...stale, receipt }), receipt.result, 'replay returns identical recorded result despite advanced revision');
    assert.throws(() => checkSubmission({ ...input, receipt, request: { ...request, expected_revision: 1 } }), /IDEMPOTENCY_CONFLICT/);
    assert.throws(() => checkSubmission({ ...input, receipt, request: { ...request, context_ref: exactRef(artifact(b, 'idea')) } }), /IDEMPOTENCY_CONFLICT/);
    assert.throws(() => checkSubmission({ ...input, receipt: { ...receipt, project_id: 'foreign_project' } }), /receipt scope/);
    assert.throws(() => checkSubmission({ ...input, project: { ...b.project, revision: 1 }, request: { ...request, expected_revision: 1 } }), /context revision/);
  });
}

for (const [name, mutate, message] of [
  ['foreign project reference', b => { artifact(b, 'idea').project_id = 'foreign_project'; }, /ownership/],
  ['foreign workspace reference', b => { artifact(b, 'research').workspace_id = 'foreign_workspace'; }, /ownership/],
  ['false stored digest', b => { artifact(b, 'idea').content.premise = 'Corrupted bytes'; }, /digest/],
  ['false reference digest', b => { b.candidate.story_bible.content_digest = `sha256:${'0'.repeat(64)}`; }, /reference/],
]) {
  test(`offline contracts reject ${name}`, async () => {
    const { checkBundle } = await oracle(); const bundle = storyFixture(); mutate(bundle);
    assert.throws(() => checkBundle(bundle), message);
  });
}
