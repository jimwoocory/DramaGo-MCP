import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'

import { fixtureCatalog } from './helpers/catalog-fixture.mjs'
const moduleUrl = new URL('../../apps/dramago-mcp/index.js', import.meta.url)
const auth = { tenantId: 'tenant', subjectId: 'subject', clientId: 'client', scopes: ['project.read'], defaultWorkspaceId: 'workspace' }
async function load() {
  assert.ok(existsSync(moduleUrl), 'internal composition root must exist')
  return import(moduleUrl)
}

test('only injected allowlisted handlers are callable; P2 and workbench stay declared', async () => {
  const { createDramaGoMcp } = await load()
  const catalog = structuredClone(fixtureCatalog)
  const app = createDramaGoMcp({ catalog, services: {
    marker: 'bound', getProject() { return { marker: this.marker } },
    getWorkbench: assert.fail, createRun: assert.fail, draftScript: assert.fail,
    dramago_story_step_run: assert.fail,
  }, mediaPorts: { job_get: () => ({ job_id: 'job' }), models_list: assert.fail, dramago_production_step_run: assert.fail }, authorize: () => true })
  assert.deepEqual(app.listTools().map(t => t.name), ['job_get', 'dramago_project_get'])
  for (const descriptor of app.descriptors.filter(t => !t.callable)) assert.equal(descriptor.status, 'declared_unimplemented')
  assert.equal((await app.callTool('dramago_story_step_run', {}, auth)).structuredContent.error.code, 'TOOL_NOT_IMPLEMENTED')
  assert.equal((await app.callTool('toString', {}, auth)).structuredContent.error.code, 'TOOL_NOT_FOUND')
  assert.equal((await app.callTool('dramago_project_get', {}, auth)).structuredContent.marker, 'bound')
  catalog.tools[5].authorization_class = 'forged'
  assert.equal(app.descriptors[5].catalog.authorization_class, 'project.read')
  assert.ok(Object.isFrozen(app.descriptors[5].catalog))
})

test('catalog ownership is a merge dependency, not a silently substituted inventory', async () => {
  const { createDramaGoMcp, loadCatalog, DEFAULT_CATALOG_URL } = await load()
  assert.ok(DEFAULT_CATALOG_URL.pathname.endsWith('/packages/dramago-contracts/contracts/tool-catalog.v1.json'))
  if (existsSync(DEFAULT_CATALOG_URL)) {
    assert.deepEqual(createDramaGoMcp().descriptors.map(t => t.name), loadCatalog().tools.map(t => t.name))
  } else {
    assert.throws(() => createDramaGoMcp(), /catalog|ENOENT/i)
  }
  assert.throws(() => createDramaGoMcp({ catalog: { ...fixtureCatalog, tools: [...fixtureCatalog.tools, fixtureCatalog.tools[0]] } }), /catalog/i)
})

test('auth, explicit policy grants and write preconditions fail closed', async () => {
  const { createDramaGoMcp } = await load()
  let calls = 0
  const options = { catalog: fixtureCatalog, services: { getProject: () => { calls++; return {} }, createArtifactRevision: () => { calls++; return {} } } }
  for (const authorize of [undefined, () => false, () => ({ allowed: true })]) {
    const app = createDramaGoMcp({ ...options, authorize })
    assert.equal((await app.callTool('dramago_project_get', {}, auth)).structuredContent.error.code, 'FORBIDDEN')
  }
  const app = createDramaGoMcp({ ...options, authorize: () => true })
  for (const context of [null, {}, { ...auth, scopes: ['*'] }, { ...auth, subjectId: '' }]) {
    assert.equal((await app.callTool('dramago_project_get', {}, context)).structuredContent.error.code, 'FORBIDDEN')
  }
  for (const input of [{}, { idempotency_key: 'key' }, { idempotency_key: 'key', expected_revision: -1 }]) {
    assert.equal((await app.callTool('dramago_artifact_revision_create', input, { ...auth, scopes: ['project.artifact_write'] })).structuredContent.error.code, 'VALIDATION_ERROR')
  }
  assert.equal(calls, 0)
  assert.equal((await app.callTool('dramago_artifact_revision_create', { idempotency_key: 'key', expected_revision: 0 }, { ...auth, scopes: ['project.artifact_write'] })).isError, false)
})

test('invalid explicit workspace selectors fail before authorization or handler invocation', async () => {
  const { createDramaGoMcp } = await load()
  let calls = 0
  const app = createDramaGoMcp({ catalog: fixtureCatalog,
    authorize: () => { calls++; return true },
    services: { getProject: () => { calls++; return {} } },
    mediaPorts: { job_get: () => { calls++; return {} } },
  })
  for (const workspace_id of [null, '', '   ', 1, [], {}]) {
    for (const [name, scope] of [['dramago_project_get', 'project.read'], ['job_get', 'media.jobs.read']]) {
      const result = await app.callTool(name, { workspace_id }, { ...auth, scopes: [scope] })
      assert.equal(result.structuredContent.error?.code, 'VALIDATION_ERROR')
    }
  }
  assert.equal(calls, 0)
})

test('Media envelopes and thrown errors are never translated by the Drama mapper', async () => {
  const { createDramaGoMcp } = await load()
  const envelope = { isError: true, content: [], structuredContent: { error: { code: 'MEDIA_ERROR' } } }
  const error = Object.assign(new Error('original'), { code: 'IDEMPOTENCY_CONFLICT' })
  const app = createDramaGoMcp({ catalog: fixtureCatalog, authorize: () => true, mediaPorts: {
    quote_create: () => envelope, generate_image: () => { throw error },
  } })
  const context = { ...auth, scopes: ['media.quotes.create', 'media.generate.image'] }
  assert.equal(await app.callTool('quote_create', { idempotency_key: 'q'.repeat(16) }, context), envelope)
  await assert.rejects(app.callTool('generate_image', { idempotency_key: 'g'.repeat(16) }, context), e => e === error)
  assert.equal((await app.callTool('quote_create', { idempotency_key: 'short' }, context)).structuredContent.error.code, 'VALIDATION_ERROR')
})

test('snapshots survive await-boundary caller mutation; invalid results and errors are sanitized', async () => {
  const { createDramaGoMcp } = await load()
  let enter, release
  const ready = new Promise(resolve => { enter = resolve })
  const wait = new Promise(resolve => { release = resolve })
  const context = structuredClone(auth), input = { ref: { version_id: 'v1' } }
  const app = createDramaGoMcp({ catalog: fixtureCatalog,
    authorize: async () => { enter(); await wait; return true },
    services: { getProject: (auth, input) => ({ subject: auth.subjectId, ref: input.ref }) },
  })
  const pending = app.callTool('dramago_project_get', input, context)
  await ready
  context.subjectId = 'forged'; input.ref.version_id = 'v2'; release()
  assert.deepEqual((await pending).structuredContent, { subject: 'subject', ref: { version_id: 'v1' } })
  for (const getProject of [() => undefined, () => ({ date: new Date() }), () => { throw new Error('secret') }]) {
    const bad = createDramaGoMcp({ catalog: fixtureCatalog, authorize: () => true, services: { getProject } })
    const result = await bad.callTool('dramago_project_get', {}, auth)
    assert.equal(result.structuredContent.error.code, 'INTERNAL_ERROR')
    assert.ok(!JSON.stringify(result).includes('secret'))
  }
})
