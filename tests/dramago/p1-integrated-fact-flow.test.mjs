import test from 'node:test'
import assert from 'node:assert/strict'
import { createDramaApplication } from '../../packages/dramago-application/index.js'
import { InMemoryDramaRepository } from '../../packages/dramago-persistence/index.js'
import { fixture } from './helpers/fixtures.mjs'

const auth = scopes => ({ tenantId:'tenant', subjectId:'human_example', clientId:'client', defaultWorkspaceId:'ws_example', scopes })

function stack() {
  const store = new InMemoryDramaRepository({
    tenantId:'tenant',
    authorize: (ctx, action, resource) => ctx.subjectId === 'human_example' && ctx.scopes.includes(action) &&
      (!resource?.workspace_id || resource.workspace_id === 'ws_example'),
  })
  const services = createDramaApplication(store,{ now:()=>new Date('2026-01-01T00:00:00Z'), id:(()=>{let i=0;return()=>`i${++i}`})() })
  return {store,services}
}

async function seedPlanning(store) {
  for (const item of [...fixture('supporting-artifacts'), fixture('artifact')]) await store.putArtifactVersion(item)
}

test('integrated application -> repository creates project, versions and immutable planning approval', async () => {
  const {store,services}=stack()
  const projectInput={
    workspace_id:'ws_example', project_id:'project_example', name:'Integrated P1',
    planning_range: fixture('project').planning_range,
    idempotency_key:'project-integrated-0001',
  }
  let result=await services.createProject(auth(['workspace.project_create']),projectInput)
  assert.equal(result.project_id,'project_example')
  assert.equal((await store.getProject('project_example')).revision,0)

  result=await services.createArtifactRevision(auth(['project.artifact_write']),{
    project_id:'project_example', artifact_id:'art_extra', version_id:'av_extra_1', kind:'master_outline', content:'extra',
    expected_revision:0, idempotency_key:'artifact-integrated-0001',
  })
  assert.equal(result.project_revision,1)
  assert.equal((await store.getArtifactVersion('av_extra_1')).kind,'master_outline')

  await seedPlanning(store)
  const approvalInput={
    project_id:'project_example', expected_revision:1, idempotency_key:'planning-integrated-0001',
    baseline:fixture('planning-baseline'), approval:fixture('approval'),
  }
  result=await services.approvePlanningBaseline(auth(['story.approve']),approvalInput)
  assert.equal(result.baseline.planning_baseline_id,'pb_example')
  assert.equal(result.project_revision,2)

  const retry=await services.approvePlanningBaseline(auth(['story.approve']),approvalInput)
  assert.deepEqual(retry,result)
  assert.equal((await store.getProject('project_example')).revision,2)

  const read=await services.getBaseline(auth(['project.read']),{baseline_id:'pb_example'})
  assert.equal(read.version_id,'av_planning_baseline_1')
})

test('integrated boundary fails closed for stale CAS, changed idempotency payload and missing scope', async () => {
  const {store,services}=stack()
  await services.createProject(auth(['workspace.project_create']),{
    workspace_id:'ws_example',project_id:'project_example',name:'Integrated P1',planning_range:fixture('project').planning_range,idempotency_key:'project-integrated-0002'
  })

  const first=await services.createArtifactRevision(auth(['project.artifact_write']),{
    project_id:'project_example',artifact_id:'a',version_id:'v1',kind:'master_outline',content:'one',expected_revision:0,idempotency_key:'artifact-integrated-0002'
  })
  assert.equal(first.project_revision,1)

  await assert.rejects(services.createArtifactRevision(auth(['project.artifact_write']),{
    project_id:'project_example',artifact_id:'b',version_id:'v2',kind:'master_outline',content:'two',expected_revision:0,idempotency_key:'artifact-integrated-0003'
  }),{code:'REVISION_CONFLICT'})

  await assert.rejects(services.createArtifactRevision(auth(['project.artifact_write']),{
    project_id:'project_example',artifact_id:'a',version_id:'v1-other',kind:'master_outline',content:'changed',expected_revision:0,idempotency_key:'artifact-integrated-0002'
  }),{code:'IDEMPOTENCY_CONFLICT'})

  await assert.rejects(services.getProject(auth([]),{project_id:'project_example'}),{code:'FORBIDDEN'})
  assert.equal((await store.getProject('project_example')).revision,1)
})
