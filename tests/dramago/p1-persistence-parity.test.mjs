import test from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryDramaRepository, PostgresDramaRepository } from '../../packages/dramago-persistence/index.js'
import { ProjectService } from '../../packages/dramago-application/services.js'
import { InterleavingPool } from './helpers/p1-postgres-pool.mjs'

const tenantId = 'tenant'
const auth = { tenantId, subjectId: 'person', clientId: 'client', scopes: ['workspace.project_create'] }
const ref = (id) => ({ artifact_id: `artifact_${id}`, version_id: `version_${id}`, content_digest: 'sha256:' + 'a'.repeat(64) })
const project = { schema_version: 'dramago.drama-project/v1', project_id: 'p1', workspace_id: 'ws', revision: 0, name: 'P', planning_range: { range_id: 'r', definition_ref: ref('range'), ordered_episode_ids: ['EP01'] }, created_at: '2026-01-01T00:00:00Z' }
const input = { workspace_id: 'ws', name: 'P', planning_range: project.planning_range, idempotency_key: 'retry-project-0001' }
const adapters = {
  memory() { return { repo: new InMemoryDramaRepository({ tenantId, authorize: () => true }) } },
  postgres() {
    const pool = new InterleavingPool()
    return { pool, repo: new PostgresDramaRepository({ tenantId, pool, authorize: () => true }) }
  },
}

const deferred = () => {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

for (const [name, setup] of Object.entries(adapters)) {
  test(`${name}: rollback releases the replay reservation and discards every losing fact`, { timeout: 3000 }, async () => {
    const { repo, pool } = setup()
    const ready = deferred(), finish = deferred(), waiting = deferred()
    const scope = { workspace_id: 'ws', command: 'project.create' }
    const record = { scope, key: 'retry', payloadHash: 'hash', result: { project_id: 'aborted' } }
    if (pool) pool.onWait = key => { if (key.startsWith('advisory:')) waiting.resolve() }
    const failed = repo.transaction(async tx => {
      assert.equal(await tx.findIdempotency(scope, record.key), null)
      await tx.createProject({ ...project, project_id: 'aborted' })
      await tx.putIdempotency(record)
      await tx.appendAudit({ event_id: 'audit_aborted', project_id: 'aborted' })
      await tx.appendOutbox({ event_id: 'outbox_aborted', project_id: 'aborted', type: 'test' })
      ready.resolve()
      await finish.promise
      throw new Error('abort winner')
    })
    const failure = assert.rejects(failed, /abort winner/)
    await ready.promise
    const contender = pool ? new PostgresDramaRepository({ tenantId, pool }) : repo
    const succeeded = contender.transaction(async tx => {
      // Same logical scope, opposite property order: it must share the lock.
      assert.equal(await tx.findIdempotency({ command: 'project.create', workspace_id: 'ws' }, record.key), null)
      await tx.createProject(project)
      await tx.putIdempotency({ ...record, result: project })
      await tx.appendAudit({ event_id: 'audit_committed', project_id: 'p1' })
      await tx.appendOutbox({ event_id: 'outbox_committed', project_id: 'p1', type: 'test' })
    })
    if (pool) await waiting.promise
    finish.resolve()
    await Promise.all([failure, succeeded])
    assert.equal(await repo.getProject('aborted'), null)
    assert.deepEqual(await repo.getProject('p1'), project)
    assert.deepEqual((await repo.findIdempotency(scope, record.key)).result, project)
    if (pool) {
      for (const table of ['projects', 'idempotency_records', 'audit_log', 'outbox']) assert.equal(pool.tables[table].size, 1, table)
      assert.equal(pool.locks.size, 0)
      assert.ok(pool.clients.every(client => client.released))
    }
  })
}

test('postgres: replay locks partition by tenant, canonical scope and key', { timeout: 3000 }, async () => {
  const { repo, pool } = adapters.postgres()
  const ready = deferred(), finish = deferred()
  const scope = { command: 'create', workspace: 'ws' }
  const held = repo.transaction(async tx => {
    assert.equal(await tx.findIdempotency(scope, 'key'), null)
    ready.resolve()
    await finish.promise
  })
  await ready.promise
  const cases = [
    { tenantId: 'other', scope, key: 'key' },
    { tenantId, scope: { ...scope, workspace: 'other' }, key: 'key' },
    { tenantId, scope: { ...scope, command: 'other' }, key: 'key' },
    { tenantId, scope, key: 'other' },
  ]
  try {
    await Promise.all(cases.map(async ({ tenantId, scope, key }) => {
      const other = new PostgresDramaRepository({ tenantId, pool })
      await other.transaction(async tx => {
        assert.equal(await tx.findIdempotency(scope, key), null)
        await tx.putIdempotency({ scope, key, payloadHash: 'hash', result: { ok: true } })
      })
      assert.deepEqual((await other.findIdempotency(scope, key)).result, { ok: true })
    }))
    assert.equal(pool.waits.length, 0, 'unrelated identities must not block behind the held lock')
    assert.equal(await repo.findIdempotency(scope, 'key'), null, 'outside a transaction the lookup is observational')
  } finally {
    finish.resolve()
    await held
  }
  const locks = pool.queries.filter(q => q.text.startsWith('SELECT pg_advisory_xact_lock('))
  assert.ok(locks.every(q => q.client), 'locks belong to dedicated transaction clients')
  assert.ok(pool.queries.filter(q => q.text.startsWith('BEGIN')).every(q => q.text === 'BEGIN ISOLATION LEVEL READ COMMITTED'))
  assert.equal(new Set(locks.map(q => JSON.stringify(q.params))).size, 5)
  assert.equal(pool.locks.size, 0)
})

const approval = { schema_version: 'dramago.approval-decision/v1', ...ref('approval'), approval_id: 'approval_1', project_id: 'p1', workspace_id: 'ws', decision: 'approved', target_refs: [ref('target')], decided_at: '2026-01-01T00:00:00Z' }
const revocation = { ...approval, ...ref('revocation'), approval_id: 'revocation_1', decision: 'revoked', revoked_decision_ref: ref('approval') }

for (const [name, setup] of Object.entries(adapters)) {
  test(`${name}: valid revocation is append-only and retryable`, async () => {
    const { repo } = setup()
    await repo.createProject(project)
    await repo.appendApproval(approval)
    assert.deepEqual(await repo.appendApproval(revocation), revocation)
    assert.deepEqual(await repo.appendApproval(revocation), revocation)
    assert.deepEqual(await repo.listApprovals(ref('target')), [approval, revocation])
  })

  const invalidRevocations = [
    ['missing predecessor', { revoked_decision_ref: ref('missing') }],
    ['wrong predecessor digest', { revoked_decision_ref: { ...ref('approval'), content_digest: 'sha256:' + 'b'.repeat(64) } }],
    ['wrong predecessor artifact', { revoked_decision_ref: { ...ref('approval'), artifact_id: 'other' } }],
    ['different project', { project_id: 'p2' }],
    ['different workspace', { project_id: 'p2', workspace_id: 'ws2' }],
    ['different target', { target_refs: [ref('other')] }],
    ['extra target', { target_refs: [ref('target'), ref('other')] }],
  ]
  for (const [label, patch] of invalidRevocations) {
    test(`${name}: rejects revocation with ${label}`, async () => {
      const { repo } = setup()
      await repo.createProject(project)
      await repo.createProject({ ...project, project_id: 'p2', workspace_id: patch.workspace_id ?? 'ws' })
      await repo.appendApproval(approval)
      await assert.rejects(repo.appendApproval({ ...revocation, ...patch }), { code: 'APPROVAL_INVALID' })
      assert.deepEqual(await repo.listApprovals(ref('target')), [approval])
    })
  }
  for (const decision of ['rejected', 'revoked']) {
    test(`${name}: revocation predecessor cannot be ${decision}`, async () => {
      const { repo } = setup()
      await repo.createProject(project)
      await repo.appendApproval(approval)
      const previous = decision === 'revoked' ? revocation : { ...revocation, decision }
      if (decision === 'rejected') delete previous.revoked_decision_ref
      await repo.appendApproval(previous)
      await assert.rejects(repo.appendApproval({ ...revocation, ...ref('next'), approval_id: 'next', revoked_decision_ref: ref('revocation') }), { code: 'APPROVAL_INVALID' })
    })
  }
  for (const decision of ['approved', 'rejected', 'revoked']) {
    test(`${name}: ${decision} validates each exact target ref`, async () => {
      const { repo } = setup()
      await repo.createProject(project)
      await repo.appendApproval(approval)
      const next = { ...revocation, decision, target_refs: [{ ...ref('target'), content_digest: 'not-a-digest' }] }
      if (decision !== 'revoked') delete next.revoked_decision_ref
      await assert.rejects(repo.appendApproval(next), { code: 'VALIDATION_ERROR' })
      assert.deepEqual(await repo.listApprovals(ref('target')), [approval])
    })
  }
  test(`${name}: cannot resolve a revocation predecessor from another tenant`, async () => {
    const { repo, pool } = setup()
    const foreign = pool
      ? new PostgresDramaRepository({ tenantId: 'foreign', pool })
      : new InMemoryDramaRepository({ tenantId: 'foreign' })
    await repo.createProject(project)
    await foreign.createProject({ ...project, project_id: 'foreign_project' })
    await foreign.appendApproval({ ...approval, project_id: 'foreign_project' })
    await assert.rejects(repo.appendApproval(revocation), { code: 'APPROVAL_INVALID' })
    assert.deepEqual(await repo.listApprovals(ref('target')), [])
  })
}

for (const [name, setup] of Object.entries(adapters)) {
  for (const [label, value] of [
    ['undefined', undefined], ['nested undefined', { nested: undefined }],
    ['NaN', NaN], ['Infinity', Infinity], ['negative Infinity', -Infinity],
    ['undefined array element', [undefined]], ['sparse array', new Array(1)],
  ]) {
    test(`${name}: project CAS rejects ${label} without changing persisted state`, async () => {
      const { repo, pool } = setup()
      await repo.createProject(project)
      await assert.rejects(repo.compareAndSetProject('p1', 0, { metadata: value }), { code: 'VALIDATION_ERROR' })
      assert.deepEqual(await repo.getProject('p1'), project)
      if (pool) assert.equal(pool.queries.filter(q => q.text.startsWith('UPDATE')).length, 0)
    })
  }
  test(`${name}: project CAS has exactly one winner and returns the stored JSON value`, async () => {
    const { repo } = setup()
    await repo.createProject(project)
    const outcomes = await Promise.allSettled(['one', 'two'].map(name => repo.compareAndSetProject('p1', 0, { name, metadata: { empty: null, list: [1, true] } })))
    assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1)
    assert.equal(outcomes.find(o => o.status === 'rejected').reason.code, 'REVISION_CONFLICT')
    assert.deepEqual(await repo.getProject('p1'), outcomes.find(o => o.status === 'fulfilled').value)
  })
}

for (const [name, setup] of Object.entries(adapters)) {
  for (const receiver of ['tx', 'root']) {
    test(`${name}: caught nested transaction on ${receiver} never leaks inner writes`, async () => {
      const { repo, pool } = setup()
      let entered = false
      await repo.transaction(async tx => {
        await tx.createProject(project)
        const nestedRepo = receiver === 'tx' ? tx : repo
        await assert.rejects(nestedRepo.transaction(async inner => {
          entered = true
          await inner.compareAndSetProject('p1', 0, { name: 'must roll back' })
          throw new Error('inner abort')
        }), name === 'postgres' ? { code: 'INVALID_STATE_TRANSITION' } : /inner abort/)
        assert.deepEqual(await tx.getProject('p1'), project)
        await tx.compareAndSetProject('p1', 0, { name: 'outer committed' })
      })
      assert.equal(entered, name === 'memory')
      assert.equal((await repo.getProject('p1')).name, 'outer committed')
      if (pool) assert.equal(pool.clients.length, 1, 'nested attempt must not acquire another connection')
    })
  }
  test(`${name}: uncaught nested failure rolls back the outer transaction`, async () => {
    const { repo } = setup()
    await assert.rejects(repo.transaction(async tx => {
      await tx.createProject(project)
      await tx.transaction(async inner => {
        await inner.compareAndSetProject('p1', 0, { name: 'inner' })
        throw new Error('inner abort')
      })
    }), name === 'postgres' ? { code: 'INVALID_STATE_TRANSITION' } : /inner abort/)
    assert.equal(await repo.getProject('p1'), null)
  })
}

for (const [name, setup] of Object.entries(adapters)) {
  test(`${name}: concurrent project retries commit one fact and replay the original result`, { timeout: 3000 }, async () => {
    const { repo, pool } = setup()
    let sequence = 0
    const options = { id: () => String(++sequence), now: () => new Date(project.created_at) }
    const service = new ProjectService(repo, options)
    // Distinct repository instances/connections model separate service processes.
    const contender = new ProjectService(pool ? new PostgresDramaRepository({ tenantId, pool, authorize: () => true }) : repo, options)
    const results = await Promise.all([service.createProject(auth, input), contender.createProject(auth, input)])
    assert.deepEqual(results[0], results[1])
    assert.equal(sequence, 2, 'one generated project id and one audit id only')
    assert.deepEqual(await repo.getProject(results[0].project_id), results[0])
    if (pool) {
      assert.equal(pool.tables.projects.size, 1)
      assert.equal(pool.tables.audit_log.size, 1)
      assert.equal(pool.tables.idempotency_records.size, 1)
      assert.ok(pool.waits.some(key => key.startsWith('advisory:')), 'contender really waited')
      assert.equal(pool.locks.size, 0)
      assert.ok(pool.clients.every(client => client.released))
    }
  })

  test(`${name}: changed concurrent retry conflicts without committing another project`, { timeout: 3000 }, async () => {
    const { repo, pool } = setup()
    let sequence = 0
    const options = { id: () => String(++sequence), now: () => new Date(project.created_at) }
    const service = new ProjectService(repo, options)
    // Distinct repository instances/connections model separate service processes.
    const contender = new ProjectService(pool ? new PostgresDramaRepository({ tenantId, pool, authorize: () => true }) : repo, options)
    const results = await Promise.allSettled([service.createProject(auth, input), contender.createProject(auth, { ...input, name: 'changed' })])
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'IDEMPOTENCY_CONFLICT')
    assert.equal(sequence, 2, 'loser must not even generate another project')
    if (pool) {
      assert.equal(pool.tables.projects.size, 1)
      assert.equal(pool.tables.audit_log.size, 1)
      assert.equal(pool.tables.idempotency_records.size, 1)
    }
  })
}
