import assert from 'node:assert/strict'
import test from 'node:test'
import { createDramaGoMcp, loadCatalog } from '../../apps/dramago-mcp/index.js'

const auth = scopes => ({ tenantId: 'tenant', subjectId: 'subject', clientId: 'client', defaultWorkspaceId: 'workspace', scopes })
const command = { project_id: 'project', idempotency_key: 'story-key', expected_revision: 0,
  context_ref: { artifact_id: 'art_context', version_id: 'av_context', content_digest: `sha256:${'a'.repeat(64)}` } }
const stepCommand = { ...command, step: 'direction' }
const commandFor = name => name === 'dramago_story_step_run' ? stepCommand : command
const operations = [
  ['dramago_story_step_run', 'story.execute', 'writer', 'runStoryStep'],
  ['dramago_planning_review', 'story.review', 'reviewer', 'reviewPlanning'],
]

test('Story writer is explicitly registered and receives unchanged frozen command and auth', async () => {
  let calls = 0
  const writer = { run_id: 'creative-writer-run', async runStoryStep(context, input) {
    calls++
    assert.deepEqual(context, auth(['story.execute']))
    assert.deepEqual(input, stepCommand)
    assert.ok(Object.isFrozen(context.scopes))
    assert.ok(Object.isFrozen(input.context_ref))
    return { creative_run_id: this.run_id }
  } }
  const app = createDramaGoMcp({ storyService: { writer }, authorize: () => true })
  assert.deepEqual(app.listTools().map(t => [t.name, t.status]), [['dramago_story_step_run', 'implemented']])
  const result = await app.callTool('dramago_story_step_run', stepCommand, auth(['story.execute']))
  assert.equal(result.isError, false)
  assert.deepEqual(result.structuredContent, { creative_run_id: writer.run_id })
  assert.equal(calls, 1)
})

test('planning review uses only the reviewer role, never a writer fallback or automatic approval', async () => {
  const review = { creative_run_id: 'creative-review-run' }
  let calls = 0
  const reviewer = { result: review, async reviewPlanning(context, input) {
    calls++
    assert.deepEqual(context, auth(['story.review']))
    assert.deepEqual(input, command)
    return this.result
  } }
  const writer = { runStoryStep: assert.fail, reviewPlanning: assert.fail, approvePlanningBaseline: assert.fail }
  const app = createDramaGoMcp({ storyService: { writer, reviewer, approvePlanningBaseline: assert.fail },
    services: { reviewPlanning: assert.fail, approvePlanningBaseline: assert.fail }, authorize: () => true })
  const result = await app.callTool('dramago_planning_review', command, auth(['story.review']))
  assert.equal(result.isError, false)
  assert.deepEqual(result.structuredContent, review)
  assert.equal(calls, 1)
  const writerOnly = createDramaGoMcp({ storyService: { writer }, authorize: () => true })
  assert.equal((await writerOnly.callTool('dramago_planning_review', command, auth(['story.review']))).structuredContent.error.code, 'TOOL_NOT_IMPLEMENTED')
})

test('planning approval can only be registered through the existing fact service', async () => {
  const extra = { approvePlanningBaseline: assert.fail, dramago_planning_baseline_approve: assert.fail }
  const storyService = { ...extra, writer: { ...extra, runStoryStep: assert.fail }, reviewer: { ...extra, reviewPlanning: assert.fail } }
  const withoutFacts = createDramaGoMcp({ storyService, mediaPorts: extra, authorize: () => true })
  assert.equal((await withoutFacts.callTool('dramago_planning_baseline_approve', command, auth(['story.approve']))).structuredContent.error.code, 'TOOL_NOT_IMPLEMENTED')
  let calls = 0
  const services = { approval_id: 'fact-approval', approvePlanningBaseline(context, input) {
    calls++
    assert.deepEqual(context, auth(['story.approve']))
    assert.deepEqual(input, command)
    return { approval_id: this.approval_id }
  } }
  const app = createDramaGoMcp({ storyService, services, authorize: () => true })
  for (const scopes of [['story.execute'], ['story.review'], ['story.execute', 'story.review']]) {
    assert.equal((await app.callTool('dramago_planning_baseline_approve', command, auth(scopes))).structuredContent.error.code, 'FORBIDDEN')
  }
  assert.equal(calls, 0)
  assert.deepEqual((await app.callTool('dramago_planning_baseline_approve', command, auth(['story.approve']))).structuredContent, { approval_id: 'fact-approval' })
  assert.equal(calls, 1)
})

test('Story slots are explicit, never inferred from fact, Media, opposite role or public-name methods', async () => {
  const misplaced = { runStoryStep: assert.fail, reviewPlanning: assert.fail,
    dramago_story_step_run: assert.fail, dramago_planning_review: assert.fail }
  const app = createDramaGoMcp({ services: misplaced, mediaPorts: misplaced,
    storyService: { ...misplaced, writer: { reviewPlanning: assert.fail }, reviewer: { runStoryStep: assert.fail } }, authorize: () => true })
  for (const [name, scope] of operations) {
    assert.equal((await app.callTool(name, commandFor(name), auth([scope]))).structuredContent.error.code, 'TOOL_NOT_IMPLEMENTED')
  }
  assert.deepEqual(app.listTools(), [])
})

test('Story registration cannot expose tools missing from the catalog', async () => {
  for (const [name, scope, role, method] of operations) {
    const catalog = loadCatalog()
    catalog.tools = catalog.tools.filter(tool => tool.name !== name)
    const app = createDramaGoMcp({ catalog, storyService: { [role]: { [method]: assert.fail } }, authorize: assert.fail })
    assert.equal(app.descriptors.some(tool => tool.name === name), false)
    assert.deepEqual(app.listTools(), [])
    assert.equal((await app.callTool(name, commandFor(name), auth([scope]))).structuredContent.error.code, 'TOOL_NOT_FOUND')
  }
})

test('script, production and Workbench tools remain fail-closed with Story wired', async () => {
  const unsupported = loadCatalog().tools.filter(t => t.domain === 'production' ||
    ['dramago_script_draft', 'dramago_script_review', 'dramago_workbench_get'].includes(t.name))
  assert.deepEqual(unsupported.map(t => t.name), [
    'dramago_workbench_get', 'dramago_script_draft', 'dramago_script_review',
    'dramago_production_step_run', 'dramago_production_package_approve', 'dramago_production_generation_prepare',
    'dramago_production_generate', 'dramago_production_execution_get', 'dramago_production_result_review', 'dramago_stage09_review',
  ])
  const extras = Object.fromEntries(unsupported.map(t => [t.name, assert.fail]))
  Object.assign(extras, { draftScript: assert.fail, reviewScript: assert.fail, runProductionStep: assert.fail, getWorkbench: assert.fail })
  const app = createDramaGoMcp({ services: extras, mediaPorts: extras,
    storyService: { ...extras, writer: { ...extras, runStoryStep: assert.fail }, reviewer: { ...extras, reviewPlanning: assert.fail } },
    authorize: assert.fail })
  for (const tool of unsupported) {
    assert.equal((await app.callTool(tool.name, command, auth([tool.authorization_class]))).structuredContent.error.code, 'TOOL_NOT_IMPLEMENTED')
    assert.equal(app.descriptors.find(d => d.name === tool.name).status, 'declared_unimplemented')
  }
  assert.deepEqual(app.listTools().map(t => t.name), operations.map(([name]) => name))
})

for (const [name, scope, role, method] of operations) {
  test(`${name}: catalog auth and required write preconditions run before the handler`, async () => {
    const storyService = { [role]: { [method]: assert.fail } }
    const tool = loadCatalog().tools.find(t => t.name === name)
    assert.equal(tool.authorization_class, scope)
    assert.equal(tool.idempotency_required, true)
    assert.equal(tool.expected_revision_required, true)
    assert.equal(tool.async_result_kind, 'creative_run_id')
    const app = createDramaGoMcp({ storyService, authorize: assert.fail })
    for (const context of [null, {}, auth(['*']), auth(['story.approve']), auth([scope === 'story.execute' ? 'story.review' : 'story.execute']),
      { ...auth([scope]), subjectId: '' }]) {
      assert.equal((await app.callTool(name, commandFor(name), context)).structuredContent.error.code, 'FORBIDDEN')
    }
    for (const input of [null, {}, { ...command, idempotency_key: '' }, { ...command, idempotency_key: ' ' },
      { ...command, idempotency_key: 7 }, { ...command, expected_revision: undefined },
      ...[-1, 0.5, '0', null, Number.MAX_SAFE_INTEGER + 1].map(expected_revision => ({ ...command, expected_revision })),
      ...[null, '', ' ', 1].map(workspace_id => ({ ...command, workspace_id }))]) {
      assert.equal((await app.callTool(name, input, auth([scope]))).structuredContent.error.code, 'VALIDATION_ERROR')
    }
    for (const authorize of [undefined, () => false, () => ({ allowed: true })]) {
      const denied = createDramaGoMcp({ storyService, authorize })
      assert.equal((await denied.callTool(name, commandFor(name), auth([scope]))).structuredContent.error.code, 'FORBIDDEN')
    }
  })

  test(`${name}: authorization receives exact public context frozen across await`, async () => {
    let enter, release
    const ready = new Promise(resolve => { enter = resolve })
    const wait = new Promise(resolve => { release = resolve })
    const input = structuredClone(commandFor(name))
    const context = auth([scope])
    const app = createDramaGoMcp({ storyService: { [role]: { [method](actualAuth, actualInput) {
      assert.deepEqual(actualAuth, auth([scope]))
      assert.deepEqual(actualInput, commandFor(name))
      assert.ok(Object.isFrozen(actualInput.context_ref))
      return { creative_run_id: 'fixed-input-run' }
    } } }, authorize: async (actualAuth, actualScope, resource) => {
      assert.equal(actualScope, scope)
      assert.equal(resource.toolName, name)
      assert.equal(resource.workspaceId, 'workspace')
      assert.deepEqual(resource.input, input)
      enter(); await wait; return true
    } })
    const pending = app.callTool(name, input, context)
    await ready
    input.context_ref.content_digest = 'changed'; input.expected_revision = 99; context.subjectId = 'changed'
    release()
    assert.equal((await pending).isError, false)
  })

  test(`${name}: service replay results and application failures are preserved without local retries`, async () => {
    const calls = []
    const result = { creative_run_id: 'durable-original-run' }
    // This is a wiring contract probe, not a replacement for domain idempotency/CAS tests.
    const app = createDramaGoMcp({ storyService: { [role]: { [method](_auth, input) {
      calls.push(input)
      return result
    } } }, authorize: (_auth, actualScope, resource) => {
      assert.equal(actualScope, scope)
      assert.equal(resource.workspaceId, 'workspace')
      return true
    } })
    const first = await app.callTool(name, commandFor(name), auth([scope]))
    assert.equal(first.isError, false)
    assert.deepEqual(await app.callTool(name, commandFor(name), auth([scope])), first)
    const changed = { ...commandFor(name), expected_revision: 1 }
    await app.callTool(name, changed, auth([scope]))
    assert.deepEqual(calls, [commandFor(name), commandFor(name), changed])
    for (const code of ['REVISION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'NOT_FOUND', 'VALIDATION_ERROR', 'BASELINE_INCOMPLETE', 'FORBIDDEN', 'unrecognized']) {
      let count = 0
      const rejecting = createDramaGoMcp({ storyService: { [role]: { async [method]() {
        count++
        throw Object.assign(new Error('private service detail'), { code })
      } } }, authorize: () => true })
      const failure = await rejecting.callTool(name, commandFor(name), auth([scope]))
      assert.equal(failure.structuredContent.error.code, code === 'unrecognized' ? 'INTERNAL_ERROR' : code)
      assert.ok(!JSON.stringify(failure).includes('private service detail'))
      assert.equal(count, 1)
    }
  })
}

test('review run identity is returned without promoting evidence or approving', async () => {
  const result = { creative_run_id: 'blocked-review' }
  const app = createDramaGoMcp({ storyService: { reviewer: { reviewPlanning: () => result } },
    services: { approvePlanningBaseline: assert.fail }, authorize: () => true })
  const response = await app.callTool('dramago_planning_review', command, auth(['story.review']))
  assert.equal(response.isError, false)
  assert.deepEqual(response.structuredContent, result)
})

test('public Story boundary rejects runtime payloads and never leaks internal result fields', async () => {
  let calls = 0
  const app = createDramaGoMcp({ storyService: { writer: { runStoryStep() { calls++; return { creative_run_id: 'run_exact', project_revision: 2, status: 'succeeded', output_refs: [] } } } }, authorize: () => true })
  const runtime = { project_id: 'project', workspace_id: 'ws', expected_revision: 0, idempotency_key: 'key', step: 'direction', input_refs: [] }
  assert.equal((await app.callTool('dramago_story_step_run', runtime, auth(['story.execute']))).structuredContent.error?.code, 'VALIDATION_ERROR')
  assert.equal(calls, 0)
  const input = { project_id: 'project', expected_revision: 0, idempotency_key: 'key', step: 'direction', context_ref: { artifact_id: 'art_context', version_id: 'av_context', content_digest: `sha256:${'a'.repeat(64)}` } }
  for (const invalid of [{ ...input, project_id: 'project\n' }, ...['artifact_id', 'version_id', 'content_digest'].map(field => ({ ...input, context_ref: { ...input.context_ref, [field]: `${input.context_ref[field]}\n` } }))]) {
    assert.equal((await app.callTool('dramago_story_step_run', invalid, auth(['story.execute']))).structuredContent.error?.code, 'VALIDATION_ERROR')
  }
  assert.deepEqual((await app.callTool('dramago_story_step_run', input, auth(['story.execute']))).structuredContent, { creative_run_id: 'run_exact' })
  const legacy = createDramaGoMcp({ storyService: { writer: { runStoryStep: () => ({ run_id: 'legacy' }) } }, authorize: () => true })
  assert.equal((await legacy.callTool('dramago_story_step_run', input, auth(['story.execute']))).structuredContent.error.code, 'INTERNAL_ERROR')
})

test('all five Media passthroughs keep their envelopes and errors when Story is configured', async () => {
  const catalog = loadCatalog()
  const storyService = { writer: { runStoryStep: assert.fail }, reviewer: { reviewPlanning: assert.fail } }
  for (const name of catalog.preserved_media_names) {
    const tool = catalog.tools.find(t => t.name === name)
    const context = auth([tool.authorization_class])
    const input = tool.idempotency_required ? { idempotency_key: 'media-key-00000001' } : {}
    const envelope = { isError: false, content: [], structuredContent: { media_result: name } }
    const app = createDramaGoMcp({ storyService, authorize: () => true, mediaPorts: { [name](actualInput, actualAuth) {
      assert.deepEqual(actualInput, input)
      assert.deepEqual(actualAuth, context)
      return envelope
    } } })
    assert.equal(app.descriptors.find(t => t.name === name).status, 'pass_through')
    assert.equal(await app.callTool(name, input, context), envelope)
    const error = Object.assign(new Error('original media error'), { code: 'MEDIA_ERROR' })
    const rejecting = createDramaGoMcp({ storyService, authorize: () => true, mediaPorts: { [name]() { throw error } } })
    await assert.rejects(rejecting.callTool(name, input, context), e => e === error)
  }
})
