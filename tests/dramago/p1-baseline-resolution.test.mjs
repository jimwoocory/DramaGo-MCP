import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers/fixtures.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryDramaRepository, JournalDramaRepository, PostgresDramaRepository } from '../../packages/dramago-persistence/index.js'

test('baseline version lookup resolves exact owned baseline without interpreting the version as a baseline ID', async () => {
  const repo = new InMemoryDramaRepository({ tenantId: 'tenant' })
  await repo.createProject(fixture('project'))
  for (const artifact of [...fixture('supporting-artifacts'), fixture('artifact')]) await repo.putArtifactVersion(artifact)
  const baseline = fixture('planning-baseline')
  await repo.putBaseline(baseline)
  assert.deepEqual(await repo.getBaselineByVersion(baseline.version_id, 'project_example'), baseline)
  assert.equal(await repo.getBaselineByVersion(baseline.version_id, 'project_other'), null)
  assert.equal(await repo.getBaselineByVersion(baseline.planning_baseline_id, 'project_example'), null)
})

test('journal resolves frozen baseline versions after reopening without a process-local index', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dramago-baseline-resolution-'))
  let repo
  t.after(async () => {
    try { await repo?.close() }
    finally { rmSync(directory, { recursive: true, force: true }) }
  })
  repo = new JournalDramaRepository({ tenantId: 'tenant', directory })
  const baseline = fixture('planning-baseline')
  await repo.transaction(async tx => {
    await tx.createProject(fixture('project'))
    for (const artifact of [...fixture('supporting-artifacts'), fixture('artifact')]) await tx.putArtifactVersion(artifact)
    await tx.putBaseline(baseline)
    assert.deepEqual(await tx.getBaselineByVersion(baseline.version_id, 'project_example'), baseline)
  })
  await repo.close()
  repo = new JournalDramaRepository({ tenantId: 'tenant', directory })
  assert.deepEqual(await repo.getBaselineByVersion(baseline.version_id, 'project_example'), baseline)
  assert.equal(await repo.getBaselineByVersion(baseline.version_id, 'project_other'), null)
  const returned = await repo.getBaselineByVersion(baseline.version_id, 'project_example')
  returned.manifest.project_id = 'changed'
  assert.deepEqual(await repo.getBaselineByVersion(baseline.version_id, 'project_example'), baseline)
})

test('Postgres baseline version lookup binds tenant, version and project in the read query', async () => {
  const baseline = fixture('planning-baseline')
  const queries = []
  const pool = { async query(sql, params) { queries.push({ sql, params }); return { rows: [{ body: baseline }] } } }
  const repo = new PostgresDramaRepository({ tenantId: 'tenant', pool })
  assert.deepEqual(await repo.getBaselineByVersion(baseline.version_id, 'project_example'), baseline)
  assert.equal(queries.length, 1)
  assert.match(queries[0].sql, /WHERE tenant_id=\$1 AND version_id=\$2 AND project_id=\$3/)
  assert.deepEqual(queries[0].params, ['tenant', baseline.version_id, 'project_example'])
})
