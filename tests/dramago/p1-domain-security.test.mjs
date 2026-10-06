import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers/fixtures.mjs'
import { createDramaApplication, canonicalHash } from '../../packages/dramago-application/index.js'
import { InMemoryDramaRepository } from '../../packages/dramago-persistence/index.js'

const ref = ({ artifact_id, version_id, content_digest }) => ({ artifact_id, version_id, content_digest })
const digestDecision = decision => {
  const { artifact_id, version_id, content_digest, ...body } = decision
  return { ...decision, content_digest: canonicalHash(body) }
}
const auth = (project = 'project_example', subjectId = 'human_example') => ({
  tenantId: 'tenant', subjectId, clientId: 'client', defaultWorkspaceId: 'ws_example', allowedProject: project,
  scopes: ['project.read', 'story.approve', 'script.approve', 'project.approval_revoke', 'project.artifact_write', 'script.write'],
})
async function setup() {
  const store = new InMemoryDramaRepository({ tenantId: 'tenant', authorize: (ctx, action, resource) =>
    ctx.scopes.includes(action) && resource.project_id === ctx.allowedProject && resource.workspace_id === 'ws_example' })
  await store.createProject(fixture('project'))
  await store.createProject({ ...fixture('project'), project_id: 'project_other' })
  for (const item of [...fixture('supporting-artifacts'), fixture('artifact')]) await store.putArtifactVersion(item)
  return { store, app: createDramaApplication(store) }
}
const planningInput = () => ({ project_id: 'project_example', expected_revision: 0, idempotency_key: 'planning-security', baseline: fixture('planning-baseline'), approval: fixture('approval') })
const scriptInput = () => ({ project_id: 'project_example', expected_revision: 1, idempotency_key: 'script-security', baseline: fixture('script-baseline'), approval: fixture('script-approval') })
const revocation = (original = fixture('approval')) => digestDecision({ ...original,
  approval_id: 'approval_revocation', artifact_id: 'art_revocation', version_id: 'av_revocation_1',
  decision: 'revoked', revoked_decision_ref: ref(original),
})

test('CreativeRun rejects a foreign artifact with an injected local manifest owner', async () => {
  const { store, app } = await setup()
  const artifact = { ...fixture('artifact'), artifact_id: 'art_foreign_manifest', version_id: 'av_foreign_manifest',
    project_id: 'project_other', manifest: { project_id: 'project_example', workspace_id: 'ws_example' } }
  // Seed the malformed stored record to exercise resolution independently of entry validation.
  await store.putArtifactVersion(artifact)
  const run = fixture('run')
  run.input_manifest.input_refs = [ref(artifact)]
  rehashRun(run)
  await assert.rejects(app.createRun(auth(), { run }), { code: 'VALIDATION_ERROR' })
  assert.equal(await store.getRun(run.run_id), null)
})

for (const attack of ['baseline_schema', 'injected_manifest']) test(`artifact envelope rejects ${attack}`, async () => {
  const { store, app } = await setup()
  const artifact = { ...fixture('artifact'), artifact_id: 'art_schema_attack', version_id: 'av_schema_attack',
    manifest: { project_id: 'project_example', workspace_id: 'ws_example' } }
  if (attack === 'baseline_schema') {
    artifact.schema_version = 'dramago.planning-baseline/v1'
    artifact.content_digest = canonicalHash(artifact.manifest)
    assert.notEqual(artifact.content_digest, canonicalHash(artifact.content))
  }
  await assert.rejects(app.createArtifactRevision(auth(), { project_id: 'project_example', expected_revision: 0,
    idempotency_key: 'artifact-schema-attack', artifact_version: artifact }), { code: 'VALIDATION_ERROR' })
  assert.equal(await store.getArtifactVersion(artifact.version_id), null)
  assert.equal((await store.getProject('project_example')).revision, 0)
})

test('revocation rejects an artifact schema digest over unrelated content', async () => {
  const { store, app } = await setup()
  await app.approvePlanningBaseline(auth(), planningInput())
  const approval = { ...revocation(), schema_version: 'dramago.artifact-version/v1', content: { unrelated: true } }
  approval.content_digest = canonicalHash(approval.content)
  assert.notEqual(approval.content_digest, digestDecision(approval).content_digest)
  await assert.rejects(app.revokeApproval(auth(), { project_id: 'project_example', expected_revision: 1,
    idempotency_key: 'revocation-schema-attack', approval }), { code: 'VALIDATION_ERROR' })
  assert.deepEqual(await store.listApprovals(ref(fixture('planning-baseline'))), [fixture('approval')])
  assert.equal((await store.getProject('project_example')).revision, 1)
})

test('approval evidence resolution rejects a decision stored as an artifact', async () => {
  const { store, app } = await setup()
  const evidence = fixture('supporting-artifacts').find(item => item.kind === 'authorization_evidence')
  const forged = digestDecision({ ...evidence, artifact_id: 'art_schema_evidence', version_id: 'av_schema_evidence',
    schema_version: 'dramago.approval-decision/v1' })
  await store.putArtifactVersion(forged)
  const input = planningInput()
  input.approval.actor.authorization_ref = ref(forged)
  input.approval = digestDecision(input.approval)
  input.baseline.approval_refs = [ref(input.approval)]
  await assert.rejects(app.approvePlanningBaseline(auth(), input), { code: 'VALIDATION_ERROR' })
  assert.equal(await store.getBaseline(input.baseline.planning_baseline_id), null)
  assert.equal((await store.getProject('project_example')).revision, 0)
})

for (const port of ['artifact', 'baseline']) test(`CreativeRun rejects the wrong schema from the ${port} port`, async () => {
  const { store, app } = await setup()
  let fact
  if (port === 'artifact') {
    fact = { ...fixture('planning-baseline'), project_id: 'project_example', workspace_id: 'ws_example' }
    await store.putArtifactVersion(fact)
  } else {
    fact = { ...fixture('artifact'), artifact_id: 'art_wrong_baseline', version_id: 'av_wrong_baseline',
      manifest: { project_id: 'project_example', workspace_id: 'ws_example' } }
    // A malformed baseline-port response must not be interpreted as an artifact.
    store.getBaselineByVersion = async (versionId, projectId) =>
      versionId === fact.version_id && projectId === fact.manifest.project_id ? structuredClone(fact) : null
  }
  const run = fixture('run')
  run.input_manifest.input_refs = [ref(fact)]
  rehashRun(run)
  await assert.rejects(app.createRun(auth(), { run }), { code: 'VALIDATION_ERROR' })
  assert.equal(await store.getRun(run.run_id), null)
})

test('revocation rejects a resolved previous decision with an artifact schema', async () => {
  const { store, app } = await setup()
  const previous = { ...fixture('approval'), schema_version: 'dramago.artifact-version/v1', content: { unrelated: true } }
  previous.content_digest = canonicalHash(previous.content)
  await store.appendApproval(previous)
  const approval = digestDecision({ ...revocation(previous), schema_version: 'dramago.approval-decision/v1' })
  await assert.rejects(app.revokeApproval(auth(), { project_id: 'project_example', expected_revision: 0,
    idempotency_key: 'previous-schema-attack', approval }), { code: 'VALIDATION_ERROR' })
  assert.deepEqual(await store.listApprovals(ref(fixture('planning-baseline'))), [previous])
  assert.equal((await store.getProject('project_example')).revision, 0)
})

for (const envelope of [false, true]) test(`artifact rejects a false supplied digest (envelope=${envelope})`, async () => {
  const { store, app } = await setup()
  const artifact = { ...fixture('artifact'), artifact_id: 'art_new', version_id: 'av_new', content_digest: 'sha256:' + '0'.repeat(64) }
  const input = { project_id: 'project_example', expected_revision: 0, idempotency_key: 'false-artifact',
    ...(envelope ? { artifact_version: artifact } : { artifact_id: artifact.artifact_id, version_id: artifact.version_id, kind: artifact.kind, content: artifact.content, content_digest: artifact.content_digest }) }
  await assert.rejects(app.createArtifactRevision(auth(), input), { code: 'VALIDATION_ERROR' })
  assert.equal(await store.getArtifactVersion('av_new'), null)
  assert.equal((await store.getProject('project_example')).revision, 0)
})

for (const kind of ['planning', 'script']) test(`${kind} baseline rejects a false manifest digest`, async () => {
  const { store, app } = await setup()
  if (kind === 'script') await app.approvePlanningBaseline(auth(), planningInput())
  const input = kind === 'planning' ? planningInput() : scriptInput()
  input.baseline.content_digest = 'sha256:' + '0'.repeat(64)
  input.approval.target_refs = [ref(input.baseline)]
  input.approval = digestDecision(input.approval)
  input.baseline.approval_refs = [ref(input.approval)]
  await assert.rejects(kind === 'planning' ? app.approvePlanningBaseline(auth(), input) : app.approveScriptBaseline(auth(), input), { code: 'VALIDATION_ERROR' })
  assert.equal((await store.getProject('project_example')).revision, kind === 'planning' ? 0 : 1)
})

for (const operation of ['approve', 'revoke']) test(`${operation} rejects a false decision digest`, async () => {
  const { app } = await setup()
  if (operation === 'revoke') await app.approvePlanningBaseline(auth(), planningInput())
  const approval = operation === 'approve' ? fixture('approval') : revocation()
  approval.content_digest = 'sha256:' + '0'.repeat(64)
  await assert.rejects(operation === 'approve'
    ? app.approvePlanningBaseline(auth(), { ...planningInput(), approval })
    : app.revokeApproval(auth(), { project_id: 'project_example', expected_revision: 1, idempotency_key: 'bad-digest-revoke', approval }), { code: 'VALIDATION_ERROR' })
})

test('resolved evidence cannot hide false content behind a matching reference digest', async () => {
  const { store, app } = await setup()
  const input = planningInput()
  const report = await store.getArtifactVersion(input.baseline.manifest.review_evidence[0].evidence_ref.version_id)
  report.version_id = 'av_false_digest'; report.content_digest = 'sha256:' + '0'.repeat(64)
  await store.putArtifactVersion(report)
  input.baseline.manifest.review_evidence[0].evidence_ref = ref(report)
  bindInput(input)
  await assert.rejects(app.approvePlanningBaseline(auth(), input), { code: 'VALIDATION_ERROR' })
})

test('P1 application does not expose a project-only workbench projection', async () => {
  const { app } = await setup()
  assert.equal(Object.hasOwn(app, 'getWorkbench'), false)
  assert.equal((await app.getProject(auth(), { project_id: 'project_example' })).project_id, 'project_example')
})

function rehashRun(run) {
  run.input_manifest_digest = canonicalHash(run.input_manifest)
  for (const step of run.steps) for (const attempt of step.attempts) attempt.input_manifest_digest = run.input_manifest_digest
  return run
}

for (const attack of ['unresolved', 'foreign_project', 'false_digest', 'wrong_ref_digest', 'attempt_digest', 'duplicate_attempt', 'unordered_attempt', 'duplicate_step']) {
  test(`CreativeRun create rejects ${attack}`, async () => {
    const { store, app } = await setup()
    await app.approvePlanningBaseline(auth(), planningInput())
    const run = fixture('run')
    if (attack === 'unresolved') run.input_manifest.input_refs[0].version_id = 'av_missing'
    if (attack === 'foreign_project') {
      const other = { ...fixture('artifact'), project_id: 'project_other', artifact_id: 'art_foreign', version_id: 'av_foreign' }
      await store.putArtifactVersion(other)
      run.input_manifest.input_refs[1] = ref(other)
    }
    if (attack === 'wrong_ref_digest') run.input_manifest.input_refs[0].content_digest = 'sha256:' + '0'.repeat(64)
    rehashRun(run)
    if (attack === 'false_digest') run.input_manifest_digest = 'sha256:' + '0'.repeat(64)
    if (attack === 'attempt_digest') run.steps[0].attempts[0].input_manifest_digest = 'sha256:' + '0'.repeat(64)
    if (attack === 'duplicate_attempt') run.steps[0].attempts.push(structuredClone(run.steps[0].attempts[0]))
    if (attack === 'unordered_attempt') run.steps[0].attempts.unshift({ ...run.steps[0].attempts[0], attempt: 2 })
    if (attack === 'duplicate_step') run.steps.push(structuredClone(run.steps[0]))
    await assert.rejects(app.createRun(auth(), { run }), { code: 'VALIDATION_ERROR' })
    assert.equal(await store.getRun(run.run_id), null)
  })
}

for (const attack of ['attempt_digest', 'duplicate_attempt', 'frozen_manifest', 'foreign_project']) test(`CreativeRun update rejects ${attack}`, async () => {
  const { store, app } = await setup()
  await app.approvePlanningBaseline(auth(), planningInput())
  const created = await app.createRun(auth(), { run: fixture('run') })
  const steps = structuredClone(created.steps)
  steps[0].attempts.push({ ...steps[0].attempts[0], attempt: 2 })
  const patch = { steps }
  if (attack === 'attempt_digest') steps[0].attempts[1].input_manifest_digest = 'sha256:' + '0'.repeat(64)
  if (attack === 'duplicate_attempt') steps[0].attempts[1].attempt = 1
  if (attack === 'frozen_manifest') {
    patch.input_manifest = { ...created.input_manifest, input_refs: [ref(fixture('artifact'))] }
    patch.input_manifest_digest = canonicalHash(patch.input_manifest)
    for (const attempt of steps[0].attempts) attempt.input_manifest_digest = patch.input_manifest_digest
  }
  if (attack === 'foreign_project') patch.project_id = 'project_other'
  await assert.rejects(app.updateRun(auth(), { run_id: created.run_id, expected_revision: 0, patch }), { code: 'VALIDATION_ERROR' })
  assert.deepEqual(await store.getRun(created.run_id), created)
})

test('CreativeRun resolves a frozen baseline across application instances and accepts matching attempts', async () => {
  const { store, app } = await setup()
  await app.approvePlanningBaseline(auth(), planningInput())
  const otherApp = createDramaApplication(store)
  const run = await otherApp.createRun(auth(), { run: fixture('run') })
  const steps = structuredClone(run.steps)
  steps[0].attempts.push({ ...steps[0].attempts[0], attempt: 2 })
  const updated = await otherApp.updateRun(auth(), { run_id: run.run_id, expected_revision: 0, patch: { steps } })
  assert.equal(updated.revision, 1)
  assert.equal(updated.steps[0].attempts.length, 2)
  assert.equal(updated.input_manifest_digest, canonicalHash(updated.input_manifest))
})

function bindInput(input) {
  input.baseline.content_digest = canonicalHash(input.baseline.manifest)
  input.approval.target_refs = [ref(input.baseline)]
  const m = input.baseline.manifest
  input.approval.evidence_refs = m.review_evidence ? m.review_evidence.map(e => e.evidence_ref) : [m.doctor_evidence.evidence_ref, m.continuity_evidence.evidence_ref]
  input.approval = digestDecision(input.approval)
  input.baseline.approval_refs = [ref(input.approval)]
  return input
}

for (const field of ['review_evidence', 'doctor_evidence', 'continuity_evidence']) {
  const attacks = ['kind', 'review_kind', 'outcome', 'subjects', 'manifest_subjects']
  if (field === 'review_evidence') attacks.push('blockers')
  if (field === 'doctor_evidence') attacks.push('mandatory_fail')
  if (field === 'continuity_evidence') attacks.push('input_ref', 'output_ref')
  for (const attack of attacks) test(`${field} resolves immutable report and rejects forged ${attack}`, async () => {
    const { store, app } = await setup()
    const planning = field === 'review_evidence'
    if (!planning) await app.approvePlanningBaseline(auth(), planningInput())
    const input = planning ? planningInput() : scriptInput()
    const evidence = planning ? input.baseline.manifest.review_evidence[0] : input.baseline.manifest[field]
    const report = await store.getArtifactVersion(evidence.evidence_ref.version_id)
    report.artifact_id = 'art_forged_review'; report.version_id = 'av_forged_review'
    if (attack === 'kind') report.kind = 'other_drama'
    if (attack === 'review_kind') report.content.review_kind = 'unrelated_review'
    if (attack === 'outcome') report.content.outcome = 'FAIL'
    if (attack === 'subjects') report.content.subject_refs = [ref(fixture('artifact'))]
    if (attack === 'manifest_subjects') evidence.subject_refs.push(ref(fixture('artifact')))
    if (attack === 'blockers') report.content.blockers = ['unresolved']
    if (attack === 'mandatory_fail') report.content.mandatory_fail = true
    if (attack === 'input_ref' || attack === 'output_ref') report.content[attack] = ref(fixture('artifact'))
    report.content_digest = canonicalHash(report.content)
    await store.putArtifactVersion(report)
    evidence.evidence_ref = ref(report)
    bindInput(input)
    await assert.rejects(planning ? app.approvePlanningBaseline(auth(), input) : app.approveScriptBaseline(auth(), input), { code: 'APPROVAL_INVALID' })
    assert.equal((await store.getProject('project_example')).revision, planning ? 0 : 1)
  })
}

for (const state of ['absent', 'revoked', 'rejected', 'wrong_version']) test(`script baseline rejects ${state} Planning approval`, async () => {
  const { store, app } = await setup()
  if (state === 'revoked') {
    await app.approvePlanningBaseline(auth(), planningInput())
    await app.revokeApproval(auth(), { project_id: 'project_example', expected_revision: 1, idempotency_key: 'revoke-planning', approval: revocation() })
  } else {
    await store.putBaseline(fixture('planning-baseline'))
    if (state !== 'absent') {
      const decision = fixture('approval')
      if (state === 'rejected') decision.decision = 'rejected'
      if (state === 'wrong_version') decision.target_refs[0].version_id = 'av_other_version'
      await store.appendApproval(digestDecision(decision))
    }
  }
  const revision = state === 'revoked' ? 2 : 0
  await assert.rejects(app.approveScriptBaseline(auth(), { ...scriptInput(), expected_revision: revision }), { code: 'APPROVAL_INVALID' })
  assert.equal(await store.getBaseline('sb_ep01'), null)
  assert.equal((await store.getProject('project_example')).revision, revision)
})

for (const operation of ['approve', 'revoke']) {
  for (const attack of ['actor', 'actor_type', 'evidence_kind', 'evidence_actor', 'evidence_project', 'decision_project', 'decision_workspace']) {
    test(`${operation} rejects forged ${attack}`, async () => {
      const { store, app } = await setup()
      if (operation === 'revoke') await app.approvePlanningBaseline(auth(), planningInput())
      const decision = operation === 'approve' ? fixture('approval') : revocation()
      if (attack === 'actor') decision.actor.actor_id = 'someone_else'
      if (attack === 'actor_type') decision.actor.actor_type = 'reviewer'
      if (attack.startsWith('evidence_')) {
        const evidence = fixture('supporting-artifacts').find(v => v.kind === 'authorization_evidence')
        evidence.artifact_id = 'art_bad_auth'; evidence.version_id = 'av_bad_auth'
        if (attack === 'evidence_kind') evidence.kind = 'other_drama'
        if (attack === 'evidence_actor') evidence.content.actor_id = 'someone_else'
        if (attack === 'evidence_project') evidence.project_id = 'project_other'
        evidence.content_digest = canonicalHash(evidence.content)
        await store.putArtifactVersion(evidence)
        decision.actor.authorization_ref = ref(evidence)
      }
      if (attack === 'decision_project') decision.project_id = 'project_other'
      if (attack === 'decision_workspace') decision.workspace_id = 'ws_other'
      const approval = digestDecision(decision)
      const request = operation === 'approve'
        ? app.approvePlanningBaseline(auth(), { ...planningInput(), approval })
        : app.revokeApproval(auth(), { project_id: 'project_example', expected_revision: 1, idempotency_key: 'forged-revoke', approval })
      await assert.rejects(request, e => ['APPROVAL_INVALID', 'VALIDATION_ERROR'].includes(e.code))
      assert.equal((await store.getProject('project_example')).revision, operation === 'approve' ? 0 : 1)
    })
  }
}

test('another authenticated subject cannot replay an approval attributed to the original actor', async () => {
  const { app } = await setup()
  await app.approvePlanningBaseline(auth(), planningInput())
  await assert.rejects(app.approvePlanningBaseline(auth('project_example', 'other_subject'), planningInput()), { code: 'APPROVAL_INVALID' })
})

for (const operation of ['read', 'revoke']) test(`same-tenant cross-project approval ${operation} is denied without mutation`, async () => {
  const { store, app } = await setup()
  await app.approvePlanningBaseline(auth(), planningInput())
  const attackAuth = auth('project_other')
  if (operation === 'read') {
    await assert.rejects(app.getApproval(attackAuth, { project_id: 'project_other', target_ref: ref(fixture('planning-baseline')) }), { code: 'APPROVAL_INVALID' })
  } else {
    await assert.rejects(app.revokeApproval(attackAuth, { project_id: 'project_other', expected_revision: 0,
      idempotency_key: 'cross-project-revoke', approval: revocation() }), { code: 'APPROVAL_INVALID' })
  }
  assert.equal((await store.listApprovals(ref(fixture('planning-baseline')))).length, 1)
  assert.equal((await store.getProject('project_other')).revision, 0)
  assert.equal((await store.getProject('project_example')).revision, 1)
})

test('revocation cannot relabel another project decision as its own', async () => {
  const { store, app } = await setup()
  await app.approvePlanningBaseline(auth(), planningInput())
  const approval = digestDecision({ ...revocation(), project_id: 'project_other' })
  await assert.rejects(app.revokeApproval(auth('project_other'), { project_id: 'project_other', expected_revision: 0,
    idempotency_key: 'relabeled-revoke', approval }), { code: 'APPROVAL_INVALID' })
  assert.equal((await store.listApprovals(ref(fixture('planning-baseline')))).length, 1)
})
