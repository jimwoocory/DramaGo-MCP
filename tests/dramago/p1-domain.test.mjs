import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers/fixtures.mjs'
import { createDramaApplication, DomainError, canonicalHash, canonicalize } from '../../packages/dramago-application/index.js'

const supporting = () => fixture('supporting-artifacts')
const clone = v => structuredClone(v)
const sameRef = (a,b) => a?.artifact_id===b?.artifact_id && a?.version_id===b?.version_id && a?.content_digest===b?.content_digest

class TestStore {
  constructor() {
    this.projects=new Map(); this.versions=new Map(); this.baselines=new Map(); this.approvals=[]; this.runs=new Map(); this.idempotency=new Map(); this.audit=[]; this.outbox=[]
  }
  async authorize(auth, action) {
    if (!auth?.scopes?.includes(action)) throw new DomainError('FORBIDDEN','scope denied')
    return true
  }
  async transaction(fn) { return fn(this) }
  _idem(scope,key){ return JSON.stringify([scope,key]) }
  async findIdempotency(scope,key){ return clone(this.idempotency.get(this._idem(scope,key)) ?? null) }
  async putIdempotency(record){
    const id=this._idem(record.scope,record.key), prev=this.idempotency.get(id)
    if(prev && prev.payloadHash!==record.payloadHash) throw new DomainError('IDEMPOTENCY_CONFLICT')
    if(!prev) this.idempotency.set(id,clone(record))
    return clone(prev ?? record)
  }
  async createProject(project){ if(this.projects.has(project.project_id)) throw new DomainError('REVISION_CONFLICT'); this.projects.set(project.project_id,clone(project)); return clone(project) }
  async getProject(id){ return clone(this.projects.get(id) ?? null) }
  async compareAndSetProject(id,expected,patch){
    const p=this.projects.get(id); if(!p) throw new DomainError('NOT_FOUND'); if(p.revision!==expected) throw new DomainError('REVISION_CONFLICT')
    const next={...clone(p),...clone(patch),revision:expected+1}; this.projects.set(id,next); return clone(next)
  }
  async putArtifactVersion(version){
    const prev=this.versions.get(version.version_id)
    if(prev && JSON.stringify(prev)!==JSON.stringify(version)) throw new DomainError('VALIDATION_ERROR')
    if(!prev) this.versions.set(version.version_id,clone(version)); return clone(prev ?? version)
  }
  async getArtifactVersion(id){ return clone(this.versions.get(id) ?? null) }
  async listArtifactVersions(artifactId){ return [...this.versions.values()].filter(v=>v.artifact_id===artifactId).map(clone) }
  async putBaseline(baseline){
    const id=baseline.planning_baseline_id ?? baseline.script_baseline_id, prev=this.baselines.get(id)
    if(prev && JSON.stringify(prev)!==JSON.stringify(baseline)) throw new DomainError('BASELINE_IMMUTABLE')
    if(!prev) this.baselines.set(id,clone(baseline)); return clone(prev ?? baseline)
  }
  async getBaseline(id){ return clone(this.baselines.get(id) ?? null) }
  async getBaselineByVersion(versionId,projectId){ return clone([...this.baselines.values()].find(b=>b.version_id===versionId && b.manifest.project_id===projectId) ?? null) }
  async appendApproval(decision){ this.approvals.push(clone(decision)); return clone(decision) }
  async listApprovals(ref){ return this.approvals.filter(a=>(a.target_refs??[]).some(r=>sameRef(r,ref))).map(clone) }
  async putRun(run){ if(this.runs.has(run.run_id)) throw new DomainError('REVISION_CONFLICT'); const v={...clone(run),revision:run.revision??0}; this.runs.set(v.run_id,v); return clone(v) }
  async getRun(id){ return clone(this.runs.get(id) ?? null) }
  async compareAndSetRun(id,expected,patch){ const r=this.runs.get(id); if(!r) throw new DomainError('NOT_FOUND'); if(r.revision!==expected) throw new DomainError('REVISION_CONFLICT'); const next={...clone(r),...clone(patch),revision:expected+1}; this.runs.set(id,next); return clone(next) }
  async appendAudit(e){ this.audit.push(clone(e)); return clone(e) }
  async appendOutbox(e){ this.outbox.push(clone(e)); return clone(e) }
}

const auth = scopes => ({ tenantId:'tenant', subjectId:'human_example', clientId:'client', defaultWorkspaceId:'ws_example', scopes })
function appFixture() {
  const store=new TestStore()
  const application=createDramaApplication(store,{ now:()=>new Date('2026-01-01T00:00:00Z'), id:(()=>{let i=0;return()=>`id${++i}`})() })
  return {store,application}
}
async function seedPlanning(store) {
  const project=fixture('project'); await store.createProject(project)
  for(const item of [...supporting(),fixture('artifact')]) if(!store.versions.has(item.version_id)) await store.putArtifactVersion(item)
  return project
}
async function approvePlanning(store,application,{ baseline=fixture('planning-baseline'), approval=fixture('approval'), expectedRevision=0 }={}) {
  return application.approvePlanningBaseline(auth(['story.approve']),{
    project_id:'project_example', expected_revision:expectedRevision, idempotency_key:`planning-key-${expectedRevision}-0001`, baseline, approval,
  })
}

test('canonical JSON hash is stable and rejects lossy values with VALIDATION_ERROR', () => {
  assert.equal(canonicalHash({b:2,a:1}), canonicalHash({a:1,b:2}))
  assert.equal(canonicalize({z:-0,a:[1e30,0.002]}), '{"a":[1e+30,0.002],"z":0}')
  assert.throws(()=>canonicalHash({a:undefined}), e=>e instanceof DomainError && e.code==='VALIDATION_ERROR')
})

test('project creation is authorized, idempotent and changed replay conflicts', async () => {
  const {store,application}=appFixture()
  const input={ workspace_id:'ws_example', project_id:'p1', name:'Drama', planning_range:{range_id:'r1',definition_ref:{artifact_id:'a',version_id:'v',content_digest:'sha256:'+'a'.repeat(64)},ordered_episode_ids:['EP01']}, idempotency_key:'project-create-0001' }
  const a=await application.createProject(auth(['workspace.project_create']),input)
  const b=await application.createProject(auth(['workspace.project_create']),clone(input))
  assert.deepEqual(b,a); assert.equal(store.projects.size,1); assert.equal(store.audit.length,1)
  await assert.rejects(application.createProject(auth(['workspace.project_create']),{...input,name:'Changed'}),{code:'IDEMPOTENCY_CONFLICT'})
  await assert.rejects(application.createProject(auth([]),{...input,idempotency_key:'other-project-0001'}),{code:'FORBIDDEN'})
})

test('artifact revision creates immutable version and uses project CAS', async () => {
  const {store,application}=appFixture(); await store.createProject(fixture('project'))
  const input={ project_id:'project_example', expected_revision:0, idempotency_key:'artifact-create-0001', artifact_id:'art_new', version_id:'av_new_1', kind:'master_outline', content:'story' }
  const result=await application.createArtifactRevision(auth(['project.artifact_write']),input)
  assert.equal(result.project_revision,1); assert.equal((await store.getArtifactVersion('av_new_1')).content,'story')
  assert.deepEqual(await application.createArtifactRevision(auth(['project.artifact_write']),input),result)
  await assert.rejects(application.createArtifactRevision(auth(['project.artifact_write']),{...input,idempotency_key:'artifact-create-0002',version_id:'av_new_2',expected_revision:0}),{code:'REVISION_CONFLICT'})
})

test('planning baseline requires exact declared episode coverage and passing evidence before exact approval', async () => {
  const {store,application}=appFixture(); await seedPlanning(store)
  const result=await approvePlanning(store,application)
  assert.equal(result.baseline.planning_baseline_id,'pb_example'); assert.equal(result.project_revision,1); assert.equal(store.outbox.length,1)
  const bad=fixture('planning-baseline'); bad.planning_baseline_id='pb_bad'; bad.version_id='av_planning_bad'; bad.artifact_id='art_planning_bad'; bad.content_digest='sha256:'+'b'.repeat(64); bad.manifest.ordered_episodes.pop()
  const approval=fixture('approval'); approval.approval_id='approval_bad'; approval.target_refs=[{artifact_id:bad.artifact_id,version_id:bad.version_id,content_digest:bad.content_digest}]
  await assert.rejects(application.approvePlanningBaseline(auth(['story.approve']),{project_id:'project_example',expected_revision:1,idempotency_key:'planning-bad-0001',baseline:bad,approval}),{code:'BASELINE_INCOMPLETE'})
})

test('planning approval rejects model actor, missing evidence and dangling refs', async () => {
  const {store,application}=appFixture(); await seedPlanning(store)
  const modelApproval=fixture('approval'); modelApproval.actor.actor_type='model'
  await assert.rejects(approvePlanning(store,application,{approval:modelApproval}),{code:'APPROVAL_INVALID'})
  const missing=fixture('approval'); missing.evidence_refs=[]
  await assert.rejects(approvePlanning(store,application,{approval:missing}),{code:'APPROVAL_INVALID'})
  const dangling=fixture('planning-baseline'); dangling.manifest.master_outline={artifact_id:'x',version_id:'missing',content_digest:'sha256:'+'c'.repeat(64)}
  await assert.rejects(approvePlanning(store,application,{baseline:dangling}),{code:'VALIDATION_ERROR'})
})

test('script baseline binds approved planning, exact screenplay Doctor PASS and Continuity CLEAR', async () => {
  const {store,application}=appFixture(); await seedPlanning(store); await approvePlanning(store,application)
  const result=await application.approveScriptBaseline(auth(['script.approve']),{
    project_id:'project_example',expected_revision:1,idempotency_key:'script-approve-0001',baseline:fixture('script-baseline'),approval:fixture('script-approval')
  })
  assert.equal(result.baseline.script_baseline_id,'sb_ep01'); assert.equal(result.project_revision,2)
  const wrong=fixture('script-baseline'); wrong.script_baseline_id='sb_bad'; wrong.version_id='av_script_bad'; wrong.artifact_id='art_script_bad'; wrong.content_digest='sha256:'+'d'.repeat(64); wrong.manifest.doctor_evidence.outcome='FAIL'
  const approval=fixture('script-approval'); approval.approval_id='script_bad'; approval.target_refs=[{artifact_id:wrong.artifact_id,version_id:wrong.version_id,content_digest:wrong.content_digest}]
  await assert.rejects(application.approveScriptBaseline(auth(['script.approve']),{project_id:'project_example',expected_revision:2,idempotency_key:'script-bad-0001',baseline:wrong,approval}),{code:'APPROVAL_INVALID'})
})

test('revocation appends decision without mutating baseline and is CAS protected', async () => {
  const {store,application}=appFixture(); await seedPlanning(store); await approvePlanning(store,application)
  const baseline=await store.getBaseline('pb_example')
  const approval=fixture('approval')
  const revoked={...approval,approval_id:'approval_revoke',artifact_id:'art_revoke',version_id:'av_revoke',content_digest:'sha256:'+'e'.repeat(64),decision:'revoked',revoked_decision_ref:{artifact_id:approval.artifact_id,version_id:approval.version_id,content_digest:approval.content_digest}}
  const {artifact_id,version_id,content_digest,...revocationBody}=revoked
  revoked.content_digest=canonicalHash(revocationBody)
  const out=await application.revokeApproval(auth(['project.approval_revoke']),{project_id:'project_example',expected_revision:1,idempotency_key:'revoke-000000001',approval:revoked})
  assert.equal(out.project_revision,2); assert.deepEqual(await store.getBaseline('pb_example'),baseline)
  await assert.rejects(application.revokeApproval(auth(['project.approval_revoke']),{project_id:'project_example',expected_revision:1,idempotency_key:'revoke-000000002',approval:revoked}),{code:'REVISION_CONFLICT'})
})

test('CreativeRun enforces domain-stage boundary and CAS updates', async () => {
  const {store,application}=appFixture(); await seedPlanning(store); await approvePlanning(store,application)
  const run={...fixture('run'),status:'queued'}
  const created=await application.createRun(auth(['script.write']),{run}); assert.equal(created.revision,0)
  const updated=await application.updateRun(auth(['script.write']),{run_id:run.run_id,expected_revision:0,patch:{status:'running'}}); assert.equal(updated.revision,1)
  await assert.rejects(application.updateRun(auth(['script.write']),{run_id:run.run_id,expected_revision:0,patch:{status:'failed'}}),{code:'REVISION_CONFLICT'})
  const bad={...run,run_id:'run_bad',domain:'story'}
  await assert.rejects(application.createRun(auth(['story.execute']),{run:bad}),{code:'INVALID_STATE_TRANSITION'})
})
