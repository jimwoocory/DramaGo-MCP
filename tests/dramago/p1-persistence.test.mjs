import { fixture } from './helpers/fixtures.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDramaRepository } from '../../packages/dramago-persistence/index.js';

const options = { tenantId: 'tenant_test' };

test('memory transactions roll back, serialize CAS races, and return original idempotency results', async () => {
  const repo = new InMemoryDramaRepository(options);
  const project = fixture('project');
  await assert.rejects(repo.transaction(async (tx) => {
    await tx.createProject(project);
    await tx.putIdempotency({ scope: { project: project.project_id, action: 'create' }, key: 'retry', payloadHash: 'hash1', result: project });
    throw new Error('abort');
  }), /abort/);
  assert.equal(await repo.getProject(project.project_id), null);
  assert.equal(await repo.findIdempotency({ action: 'create', project: project.project_id }, 'retry'), null);
  await repo.transaction(async (tx) => {
    await repo.createProject(project); // ambient transaction also works
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.compareAndSetProject(project.project_id, 0, { name: 'rolled back' });
      throw new Error('savepoint');
    }), /savepoint/);
    assert.equal((await tx.getProject(project.project_id)).revision, 0);
  });
  const outcomes = await Promise.allSettled([1, 2].map(() => repo.compareAndSetProject(project.project_id, 0, { name: 'winner' })));
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find((o) => o.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  const record = { scope: { action: 'create', project: project.project_id }, key: 'retry', payloadHash: 'hash1', result: { id: 'original' } };
  await repo.putIdempotency(record);
  assert.deepEqual(await repo.putIdempotency({ ...record, result: { id: 'different result ignored' } }), record);
  assert.deepEqual(await repo.findIdempotency({ project: project.project_id, action: 'create' }, 'retry'), record);
  await assert.rejects(repo.putIdempotency({ ...record, payloadHash: 'hash2' }), { code: 'IDEMPOTENCY_CONFLICT' });
  await repo.putIdempotency({ ...record, scope: 'another scope', payloadHash: 'hash2' });
});

test('immutable facts, exact approval refs, append-only revocation and run stage boundaries', async () => {
  const repo = new InMemoryDramaRepository(options);
  await repo.createProject(fixture('project'));
  const version = fixture('artifact');
  await repo.putArtifactVersion(version);
  assert.deepEqual(await repo.getArtifactVersion(version.version_id), version);
  assert.deepEqual(await repo.listArtifactVersions(version.artifact_id), [version]);
  await repo.putArtifactVersion(version);
  await assert.rejects(repo.putArtifactVersion({ ...version, content: 'overwrite' }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(repo.putArtifactVersion({ ...version, version_id: 'av_foreign', workspace_id: 'foreign' }), { code: 'VALIDATION_ERROR' });
  for (const name of ['planning-baseline', 'script-baseline']) {
    const baseline = fixture(name);
    // Persist only generic outline/screenplay items; approval semantics belong to the application.
    const items = baseline.manifest.ordered_episodes?.map((e) => e.outline_ref) ?? [baseline.manifest.screenplay];
    for (const ref of items) {
      if (!await repo.getArtifactVersion(ref.version_id)) await repo.putArtifactVersion({ ...version, ...ref });
    }
    await repo.putBaseline(baseline);
    const id = baseline.planning_baseline_id ?? baseline.script_baseline_id;
    assert.deepEqual(await repo.getBaseline(id), baseline);
    await repo.putBaseline(baseline);
    await assert.rejects(repo.putBaseline({ ...baseline, manifest: { ...baseline.manifest, policy_version: 'changed/v2' } }), { code: 'BASELINE_IMMUTABLE' });
  }
  const approval = fixture('approval');
  await repo.appendApproval(approval);
  const revoked = { ...approval, approval_id: 'approval_revoked', version_id: 'av_revoked', decision: 'revoked', revoked_decision_ref: { artifact_id: approval.artifact_id, version_id: approval.version_id, content_digest: approval.content_digest } };
  await repo.appendApproval(revoked);
  assert.deepEqual(await repo.listApprovals(approval.target_refs[0]), [approval, revoked]);
  assert.deepEqual(await repo.listApprovals({ ...approval.target_refs[0], content_digest: 'sha256:' + '0'.repeat(64) }), []);
  await repo.appendAudit({ event_id: 'audit_1', project_id: version.project_id, action: 'approval.revoked' });
  await repo.appendOutbox({ event_id: 'outbox_1', project_id: version.project_id, type: 'approval.revoked' });
  await assert.rejects(repo.appendAudit({ event_id: 'audit_1', project_id: version.project_id, action: 'changed' }), { code: 'VALIDATION_ERROR' });
  const run = { ...fixture('run'), status: 'queued' };
  assert.equal((await repo.putRun(run)).revision, 0);
  assert.equal((await repo.compareAndSetRun(run.run_id, 0, { status: 'running' })).revision, 1);
  await assert.rejects(repo.compareAndSetRun(run.run_id, 0, { status: 'failed' }), { code: 'REVISION_CONFLICT' });
  await assert.rejects(repo.putRun({ ...run, run_id: 'run_bad', domain: 'story' }), { code: 'VALIDATION_ERROR' });
  assert.equal((await repo.getRun(run.run_id)).status, 'running');
  assert.equal(await repo.getRun('missing'), null);
});

test('authorization fails closed and requires explicit authority beyond workspace membership', async () => {
  const auth = { tenantId: options.tenantId, subjectId: 'person', clientId: 'client', scopes: ['drama:approve'], defaultWorkspaceId: 'ws_example' };
  const resource = { workspace_id: 'ws_example', project_id: 'project_example' };
  const denied = new InMemoryDramaRepository(options);
  await assert.rejects(denied.authorize(auth, 'drama:approve', resource), { code: 'FORBIDDEN' });
  const repo = new InMemoryDramaRepository({ ...options, authorize: (a, action, r) => a.subjectId === 'person' && action === 'drama:approve' && r.project_id === 'project_example' });
  assert.equal(await repo.authorize(auth, 'drama:approve', resource), true);
  await assert.rejects(repo.authorize({ ...auth, tenantId: 'foreign' }, 'drama:approve', resource), { code: 'FORBIDDEN' });
  await assert.rejects(repo.authorize({ ...auth, scopes: [] }, 'drama:approve', resource), { code: 'FORBIDDEN' });
});

test('memory creates isolated project values and guards mutable heads with CAS', async () => {
  const repo = new InMemoryDramaRepository(options);
  const project = fixture('project');
  assert.equal(await repo.getProject('missing'), null);
  assert.deepEqual(await repo.createProject(project), project);
  project.name = 'caller mutation';
  const read = await repo.getProject(project.project_id);
  read.planning_range.ordered_episode_ids.push('EP03');
  assert.deepEqual(await repo.getProject(project.project_id), fixture('project'));
  const updated = await repo.compareAndSetProject(project.project_id, 0, { name: 'saved' });
  assert.equal(updated.revision, 1);
  await assert.rejects(repo.compareAndSetProject(project.project_id, 0, { name: 'stale' }), { code: 'REVISION_CONFLICT' });
  await assert.rejects(repo.compareAndSetProject('missing', 0, {}), { code: 'NOT_FOUND' });
  await assert.rejects(repo.compareAndSetProject(project.project_id, 1, { workspace_id: 'foreign' }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(repo.createProject(project), { code: 'REVISION_CONFLICT' });
});
