// Compatibility test of the existing P1 approval path, not a new P2 service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDramaApplication, canonicalHash } from '../../packages/dramago-application/index.js';
import { InMemoryDramaRepository } from '../../packages/dramago-persistence/index.js';
import { storyFixture, exactRef, reseal } from './helpers/p2-story-fixtures.mjs';
import { fixture } from './helpers/fixtures.mjs';

test('P2 candidate and review evidence remain compatible with the sole existing formal approval path', async () => {
  const b = storyFixture();
  const auth = { tenantId: 'tenant_fixture', subjectId: 'human_example', clientId: 'fixture', defaultWorkspaceId: b.project.workspace_id, scopes: ['story.approve'] };
  const store = new InMemoryDramaRepository({ tenantId: auth.tenantId,
    authorize: (ctx, action) => ctx.subjectId === auth.subjectId && ctx.scopes.includes(action) });
  const app = createDramaApplication(store);
  await store.createProject(b.project);
  for (const a of b.artifacts) await store.putArtifactVersion(a);
  for (const run of b.runs) await store.putRun(run);
  const authorization = fixture('supporting-artifacts').find(a => a.kind === 'authorization_evidence');
  authorization.project_id = b.project.project_id; authorization.workspace_id = b.project.workspace_id;
  reseal(authorization); await store.putArtifactVersion(authorization);
  const baseline = { schema_version: 'dramago.planning-baseline/v1', artifact_id: 'art_candidate', version_id: 'av_candidate',
    content_digest: canonicalHash(b.candidate), planning_baseline_id: 'pb_fixture', manifest: b.candidate, approval_refs: [], created_at: b.project.created_at };
  const approval = fixture('approval');
  Object.assign(approval, { project_id: b.project.project_id, workspace_id: b.project.workspace_id,
    target_refs: [exactRef(baseline)], evidence_refs: b.candidate.review_evidence.map(e => e.evidence_ref) });
  approval.actor.authorization_ref = exactRef(authorization);
  const { artifact_id, version_id, content_digest, ...body } = approval;
  approval.content_digest = canonicalHash(body);
  baseline.approval_refs = [exactRef(approval)];
  assert.equal(await store.getBaseline('pb_fixture'), null, 'generation, PASS and candidate assembly have not published anything');
  assert.deepEqual(await store.listApprovals(exactRef(baseline)), [], 'no self-approval');
  const input = { project_id: b.project.project_id, expected_revision: 0, idempotency_key: 'explicit-human-approval', baseline, approval };
  await assert.rejects(app.approvePlanningBaseline(auth, { ...input, approval: { ...approval, actor: { ...approval.actor, actor_type: 'model' } } }), { code: 'APPROVAL_INVALID' });
  const result = await app.approvePlanningBaseline(auth, input);
  assert.deepEqual(result.baseline.manifest, b.candidate);
  assert.deepEqual((await store.getBaseline('pb_fixture')).manifest, b.candidate);
  assert.equal((await store.listApprovals(exactRef(baseline))).length, 1);
});
