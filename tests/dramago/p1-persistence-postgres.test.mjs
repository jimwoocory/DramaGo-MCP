import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PostgresDramaRepository } from '../../packages/dramago-persistence/index.js'

class FakePool {
  constructor() { this.projects=new Map(); this.idem=new Map(); this.queries=[]; this.snapshot=null }
  async query(sql,params=[]){ return this._query(sql,params) }
  async connect(){
    return { query:(sql,params=[])=>this._query(sql,params), release:()=>{ this.released=true } }
  }
  _query(sql,params){
    this.queries.push([sql,params])
    const text=String(sql).replace(/\s+/g,' ').trim()
    if(text==='BEGIN ISOLATION LEVEL READ COMMITTED'){ this.snapshot={projects:structuredClone(this.projects),idem:structuredClone(this.idem)}; return {rows:[]} }
    if(text.startsWith('SELECT pg_advisory_xact_lock(')) return {rows:[]}
    if(text==='COMMIT'){ this.snapshot=null; return {rows:[]} }
    if(text==='ROLLBACK'){ if(this.snapshot){this.projects=this.snapshot.projects;this.idem=this.snapshot.idem} this.snapshot=null; return {rows:[]} }
    if(text.startsWith('INSERT INTO dramago.projects')){
      const [,workspace,projectId,revisionValue,bodyText]=params
      if(this.projects.has(projectId)) return {rows:[]}
      const body=JSON.parse(bodyText); this.projects.set(projectId,{body,revision:revisionValue,workspace}); return {rows:[{body}]}
    }
    if(text.startsWith('SELECT body FROM dramago.projects')){
      const project=this.projects.get(params[1]); return {rows:project?[{body:project.body}]:[]}
    }
    if(text.startsWith('UPDATE dramago.projects')){
      const [newRevision,bodyText,,projectId,expected]=params
      const project=this.projects.get(projectId)
      if(!project || project.revision!==expected) return {rows:[]}
      project.revision=newRevision; project.body=JSON.parse(bodyText); return {rows:[{body:project.body}]}
    }
    if(text.startsWith('INSERT INTO dramago.idempotency_records')){
      const [tenant,scope,key,payloadHash,resultText]=params
      const id=JSON.stringify([tenant,scope,key])
      if(this.idem.has(id)) return {rows:[]}
      const row={payload_hash:payloadHash,result:JSON.parse(resultText)}; this.idem.set(id,row); return {rows:[row]}
    }
    if(text.startsWith('SELECT payload_hash,result FROM dramago.idempotency_records')){
      const id=JSON.stringify(params); const row=this.idem.get(id); return {rows:row?[row]:[]}
    }
    throw new Error('Unhandled SQL in fake: '+text)
  }
}

const project={schema_version:'dramago.drama-project/v1',workspace_id:'ws',project_id:'p1',name:'P',revision:0,planning_range:{range_id:'r',definition_ref:{artifact_id:'a',version_id:'v',content_digest:'sha256:'+'a'.repeat(64)},ordered_episode_ids:['EP01']},created_at:'2026-01-01T00:00:00Z'}

test('P1 migration is additive and contains required fact tables/constraints',()=>{
  const sql=readFileSync(new URL('../../packages/dramago-persistence/migrations/001_p1_fact_layer.sql',import.meta.url),'utf8')
  for(const table of ['projects','project_members','artifact_versions','baselines','baseline_items','approval_decisions','creative_runs','idempotency_records','audit_log','outbox']){
    assert.match(sql,new RegExp(`CREATE TABLE IF NOT EXISTS dramago\\.${table}\\b`))
  }
  assert.match(sql,/ON DELETE RESTRICT/)
  assert.match(sql,/content_digest ~ '\^sha256:/)
  assert.match(sql,/UNIQUE\(project_id, artifact_id, version_id\)/)
  assert.doesNotMatch(sql,/\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i)
})

test('Postgres repository uses transaction, CAS and scoped idempotency without driver dependency',async()=>{
  const pool=new FakePool()
  const repo=new PostgresDramaRepository({tenantId:'tenant',pool,authorize:()=>true})
  const created=await repo.transaction(tx=>tx.createProject(project))
  assert.deepEqual(created,project); assert.equal(pool.released,true)
  assert.deepEqual(await repo.getProject('p1'),project)
  const updated=await repo.compareAndSetProject('p1',0,{name:'P2'})
  assert.equal(updated.revision,1); assert.equal(updated.name,'P2')
  await assert.rejects(repo.compareAndSetProject('p1',0,{name:'stale'}),{code:'REVISION_CONFLICT'})
  const record={scope:{project:'p1',command:'x'},key:'idem-key-00000001',payloadHash:'hash1',result:{ok:true}}
  assert.deepEqual(await repo.putIdempotency(record),record)
  assert.deepEqual(await repo.putIdempotency({...record,result:{ignored:true}}),record)
  await assert.rejects(repo.putIdempotency({...record,payloadHash:'hash2'}),{code:'IDEMPOTENCY_CONFLICT'})
  assert.ok(pool.queries.some(([sql])=>String(sql).trim()==='BEGIN ISOLATION LEVEL READ COMMITTED'))
  assert.ok(pool.queries.some(([sql])=>String(sql).trim()==='COMMIT'))
})

test('Postgres transaction rolls back failed writes',async()=>{
  const pool=new FakePool()
  const repo=new PostgresDramaRepository({tenantId:'tenant',pool,authorize:()=>true})
  await assert.rejects(repo.transaction(async tx=>{ await tx.createProject(project); throw new Error('abort') }),/abort/)
  assert.equal(await repo.getProject('p1'),null)
  assert.ok(pool.queries.some(([sql])=>String(sql).trim()==='ROLLBACK'))
})
