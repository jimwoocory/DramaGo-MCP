import { describe, it, expect, vi } from 'vitest'
import { createDramaApplication } from '../../packages/dramago-application/index.js'
import { createDramaGoMcp, loadCatalog } from '../../apps/dramago-mcp/index.js'
import { createLocalStoryPorts } from '../../apps/dramago-mcp/story-ports.js'
import { auth, ref, seal, setup as runtimeSetup } from './helpers/story-runtime.js'
import { policy } from './helpers/p2-story-conformance.mjs'

async function setup(options: any = {}) {
  const s = await runtimeSetup(options)
  // Call-through spies observe the seam without replacing the real runtime.
  const runStep = vi.spyOn(s.service, 'runStep')
  const planningReview = vi.spyOn(s.service, 'planningReview')
  const storyService = createLocalStoryPorts(s.service, s.store)
  const app = createDramaGoMcp({ storyService, services: createDramaApplication(s.store), authorize: () => true })
  const input = await s.command('direction')
  const context = await s.store.getArtifactVersion(input.context_ref.version_id)
  const execute = async (request: any) => {
    const tool = request.step ? 'dramago_story_step_run' : 'dramago_planning_review'
    const response = await app.callTool(tool, request, auth)
    expect(response.isError, JSON.stringify(response)).toBe(false)
    expect(Object.keys(response.structuredContent)).toEqual(['creative_run_id'])
    const run = await s.store.getRun(response.structuredContent.creative_run_id)
    expect(run.status).toBe('succeeded')
    const outputs = await Promise.all(run.steps[0].attempts[0].output_refs.map((r: any) => s.store.getArtifactVersion(r.version_id)))
    for (const a of outputs) s.byRole[a.episode_id ?? a.content.schema_version.slice(8, -3).replaceAll('-', '_')] = ref(a)
    return { response, run, outputs }
  }
  return { ...s, app, storyService, input, context, execute, runStep, planningReview }
}

async function reviewSetup() {
  const s = await setup()
  // Every generated binding comes from the actual dispatcher -> adapter -> runtime chain.
  for (const step of Object.keys(policy.steps).filter(s => s !== 'planning_review')) {
    const request = step === 'direction' ? s.input : await s.command(step)
    await s.execute(request)
    expect(s.runStep).toHaveBeenLastCalledWith(auth, request)
  }
  const reviewInput = await s.command('planning_review')
  const reviewContext = await s.store.getArtifactVersion(reviewInput.context_ref.version_id)
  const set = await s.store.getArtifactVersion(s.byRole.episode_outline_set.version_id)
  return { ...s, reviewInput, reviewContext, set }
}

describe('public Story tool -> local adapter -> actual runtime -> InMemory repository', () => {
  it('fails generated screenplay prose through the public composition without publishing it', async () => {
    let generated: any
    const s = await setup({ generate: async (request: any, generate: any) => {
      const bundle = await generate(request)
      bundle.proposals[0].content.logline = 'INT. ROOM - NIGHT\nMAYA: Leave now.\nCUT TO:'
      generated = seal(bundle.proposals[0])
      bundle.proposals[0] = generated
      return bundle
    } })
    const before = structuredClone(s.store._state)
    const response = await s.app.callTool('dramago_story_step_run', s.input, auth)
    expect(response.isError).toBe(false)
    expect(Object.keys(response.structuredContent)).toEqual(['creative_run_id'])
    expect(s.runStep).toHaveBeenLastCalledWith(auth, s.input)
    const run = await s.store.getRun(response.structuredContent.creative_run_id)
    expect(run.status).toBe('failed')
    expect(run.steps[0].attempts[0]).toMatchObject({ status: 'failed', output_refs: [] })
    expect([...s.store._state.audit.values()].at(-1)).toMatchObject({ error_code: 'INVALID_GENERATION_OUTPUT' })
    expect(await s.store.getArtifactVersion(generated.version_id)).toBeNull()
    expect(s.store._state.versions).toEqual(before.versions)
    expect(s.store._state.projects).toEqual(before.projects)
    expect(s.store._state.baselines.size).toBe(0)
    expect(s.store._state.approvals.size).toBe(0)
    expect(await s.app.callTool('dramago_story_step_run', s.input, auth)).toEqual(response)
    expect(s.calls).toHaveLength(1)
  })

  it('passes only the published direction DTO and returns only the persisted run identity, including replay', async () => {
    const s = await setup()
    const { response, run, outputs } = await s.execute(s.input)
    expect(s.runStep).toHaveBeenLastCalledWith(auth, s.input)
    expect(run).toMatchObject({ run_id: response.structuredContent.creative_run_id, workspace_id: s.project.workspace_id })
    expect(run.input_manifest.input_refs).toEqual(expect.arrayContaining([s.input.context_ref, ref(s.seed('idea')), ref(s.seed('writer_config'))]))
    expect(outputs[0].content.run_context_ref).toEqual(s.input.context_ref)
    expect(await s.app.callTool('dramago_story_step_run', s.input, auth)).toEqual(response)
    expect(s.calls).toHaveLength(1)
    expect(s.researchCalls).toHaveLength(1)
    expect(s.store._state.runs.size).toBe(1)
    expect(s.store._state.approvals.size).toBe(0)
    expect(s.store._state.baselines.size).toBe(0)
  })

  it('reviews a complete real Story chain from immutable context without reconstructing runtime inputs or approving', async () => {
    const s = await reviewSetup()
    const { response, run, outputs } = await s.execute(s.reviewInput)
    expect(s.planningReview).toHaveBeenLastCalledWith(auth, s.reviewInput)
    expect(run.input_manifest.input_refs).toContainEqual(s.reviewInput.context_ref)
    expect(run.input_manifest.input_refs).toContainEqual(ref(s.seed('reviewer_config')))
    expect(outputs[0].content).toMatchObject({ schema_version: 'dramago.planning-review-evidence/v1', outcome: 'PASS', reviewer_id: 'reviewer_a', reviewed_writer_ids: ['writer_a'], blockers: [] })
    expect(outputs[0].content.dependency_refs).toEqual(run.input_manifest.input_refs)
    expect(outputs[0].content.subject_refs).toEqual(expect.arrayContaining(s.set.content.ordered_episodes.map((e: any) => e.outline_ref)))
    const before = structuredClone(s.store._state)
    const researchCount = s.researchCalls.length
    expect(await s.app.callTool('dramago_planning_review', s.reviewInput, auth)).toEqual(response)
    expect(s.reviewCalls).toHaveLength(1)
    expect(s.researchCalls).toHaveLength(researchCount)
    expect(s.researchCalls.at(-1).snapshot_ref).toEqual(s.reviewContext.content.research.snapshot_ref)
    expect(s.store._state).toEqual(before)
    expect(s.store._state.approvals.size).toBe(0)
    expect(s.store._state.baselines.size).toBe(0)
  })

  it.each(['missing-context', 'runtime-payload', 'latest', 'wrong-digest', 'extra-field', 'overlong-key'])('rejects invalid public request: %s', async attack => {
    const s = await setup()
    const input: any = structuredClone(s.input)
    if (attack === 'missing-context') delete input.context_ref
    if (attack === 'runtime-payload') { delete input.context_ref; input.input_refs = [ref(s.seed('idea'))]; input.workspace_id = s.project.workspace_id }
    if (attack === 'latest') input.context_ref.version_id = 'av_latest'
    if (attack === 'wrong-digest') input.context_ref.content_digest = `sha256:${'0'.repeat(64)}`
    if (attack === 'extra-field') input.planning_scope = {}
    if (attack === 'overlong-key') input.idempotency_key = 'x'.repeat(257)
    const before = structuredClone(s.store._state)
    expect((await s.app.callTool('dramago_story_step_run', input, auth)).structuredContent.error.code).toBe('VALIDATION_ERROR')
    expect(s.runStep).not.toHaveBeenCalled()
    expect(s.calls).toHaveLength(0)
    expect(s.store._state).toEqual(before)
  })

  it.each(['missing-binding', 'wrong-operation', 'wrong-revision', 'wrong-policy', 'wrong-range', 'missing-scope', 'missing-config', 'wrong-role', 'missing-source', 'foreign-context', 'foreign-binding', 'corrupt-context', 'missing-workspace', 'wrong-idea-kind'])('fails closed before runtime mutation: %s', async attack => {
    const s = await setup()
    const content: any = structuredClone(s.context.content)
    let extra = {}
    if (attack === 'missing-binding') delete content.bindings.idea
    if (attack === 'wrong-operation') content.operation = 'bible'
    if (attack === 'wrong-revision') content.project_revision = s.input.expected_revision + 1
    if (attack === 'wrong-policy') content.policy_version = 'unsupported/v2'
    if (attack === 'wrong-range') content.planning_scope.ordered_episode_ids.reverse()
    if (attack === 'missing-scope') delete content.planning_scope
    if (attack === 'missing-config') delete content.executor.configuration_ref
    if (attack === 'wrong-role') content.executor.role = 'reviewer'
    if (attack === 'missing-source') content.source_refs = [{ ...ref(s.seed('idea')), version_id: 'av_missing' }]
    if (attack === 'foreign-context' || attack === 'foreign-binding') {
      await s.store.createProject({ project_id: 'foreign', workspace_id: 'other_workspace', revision: 0 })
      const owner = { project_id: 'foreign', workspace_id: 'other_workspace' }
      if (attack === 'foreign-context') extra = owner
      else content.bindings.idea = ref(await s.put(s.seed('idea').content, 'other_drama', owner))
    }
    if (attack === 'wrong-idea-kind') content.bindings.idea = ref(s.seed('writer_config'))
    const context = await s.put(content, 'other_drama', extra)
    if (attack === 'corrupt-context') s.store._state.versions.get(context.version_id).content.instructions = 'tampered'
    if (attack === 'missing-workspace') delete s.store._state.projects.get(s.project.project_id).workspace_id
    const before = structuredClone(s.store._state)
    expect((await s.app.callTool('dramago_story_step_run', { ...s.input, context_ref: ref(context) }, auth)).structuredContent.error?.code).toBe('VALIDATION_ERROR')
    expect(s.calls).toHaveLength(0)
    expect(s.store._state).toEqual(before)
  })

  it.each(['missing-foundation', 'missing-research', 'missing-episode', 'reordered-episodes', 'wrong-episode'])('rejects incomplete exact planning review: %s', async attack => {
    const s = await reviewSetup()
    const c: any = structuredClone(s.reviewContext.content)
    if (attack === 'missing-foundation') delete c.bindings.story_foundation
    if (attack === 'missing-research') c.research = { status: 'omitted', reason: 'no evidence' }
    if (['missing-episode', 'reordered-episodes', 'wrong-episode'].includes(attack)) {
      const content = structuredClone(s.set.content)
      const episodes = content.ordered_episodes
      if (attack === 'missing-episode') episodes.pop()
      if (attack === 'reordered-episodes') episodes.reverse()
      if (attack === 'wrong-episode') episodes[1].outline_ref = episodes[0].outline_ref
      c.bindings.episode_outline_set = ref(await s.put(content))
    }
    const context = await s.put(c)
    const before = structuredClone(s.store._state)
    expect((await s.app.callTool('dramago_planning_review', { ...s.reviewInput, context_ref: ref(context) }, auth)).structuredContent.error.code).toBe('VALIDATION_ERROR')
    expect(s.reviewCalls).toHaveLength(0)
    expect(s.store._state).toEqual(before)
  })

  it('keeps Script, Production and Workbench unimplemented with the actual adapter wired', async () => {
    const s = await setup()
    for (const tool of loadCatalog().tools.filter((t: any) => t.domain === 'production' || ['dramago_script_draft', 'dramago_script_review', 'dramago_workbench_get'].includes(t.name))) {
      expect((await s.app.callTool(tool.name, s.input, { ...auth, scopes: [tool.authorization_class] })).structuredContent.error.code).toBe('TOOL_NOT_IMPLEMENTED')
    }
    expect(s.runStep).not.toHaveBeenCalled()
    expect(s.planningReview).not.toHaveBeenCalled()
  })

  it.each(['direction', 'planning_review'])('replays %s after the project planning range changes without executing again', async operation => {
    const s = await reviewSetup()
    const tool = operation === 'direction' ? 'dramago_story_step_run' : 'dramago_planning_review'
    const input = operation === 'direction' ? s.input : s.reviewInput
    const response = await s.app.callTool(tool, input, auth)
    expect(response.isError).toBe(false)
    const project = await s.store.getProject(s.project.project_id)
    const range = await s.put({ range_id: 'next_season', ordered_episode_ids: ['EP03'] }, 'planning_range')
    await s.store.compareAndSetProject(project.project_id, project.revision, {
      planning_range: { range_id: 'next_season', definition_ref: ref(range), ordered_episode_ids: ['EP03'] },
    })
    const before = structuredClone(s.store._state)
    const executions = [s.calls.length, s.reviewCalls.length, s.researchCalls.length]
    expect(await s.app.callTool(tool, input, auth)).toEqual(response)
    expect([s.calls.length, s.reviewCalls.length, s.researchCalls.length]).toEqual(executions)
    expect(s.store._state).toEqual(before)
  })

  it.each([
    ['direction', 'revision'], ['direction', 'context'], ['direction', 'step'],
    ['planning_review', 'revision'], ['planning_review', 'context'],
  ])('delegates reused %s key with changed %s to authoritative conflict handling', async (operation, change) => {
    const s = operation === 'direction' ? await setup() : await reviewSetup()
    const input = operation === 'direction' ? s.input : (s as Awaited<ReturnType<typeof reviewSetup>>).reviewInput
    const tool = operation === 'direction' ? 'dramago_story_step_run' : 'dramago_planning_review'
    await s.execute(input)
    const context = await s.store.getArtifactVersion(input.context_ref.version_id)
    const changedContext = await s.put({ ...context.content, project_revision: input.expected_revision + 1 })
    const edits = change === 'revision' ? { expected_revision: input.expected_revision + 1 }
      : change === 'context' ? { context_ref: ref(changedContext) } : { step: 'bible' }
    const before = structuredClone(s.store._state)
    const executions = [s.calls.length, s.reviewCalls.length, s.researchCalls.length]
    const runtime = operation === 'direction' ? s.runStep : s.planningReview
    runtime.mockClear()
    const request = { ...input, ...edits }
    const response = await s.app.callTool(tool, request, auth)
    expect(response.structuredContent.error?.code).toBe('IDEMPOTENCY_CONFLICT')
    expect(runtime).toHaveBeenCalledTimes(1)
    expect(runtime).toHaveBeenLastCalledWith(auth, request)
    await expect(runtime.mock.results[0].value).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    expect([s.calls.length, s.reviewCalls.length, s.researchCalls.length]).toEqual(executions)
    expect(s.store._state).toEqual(before)
  })

  it.each(['foreign-context', 'foreign-binding', 'wrong-digest', 'missing-scope', 'denied-workspace'])('keeps replay preflight authorization and exact ownership checks: %s', async attack => {
    const s = await setup()
    await s.execute(s.input)
    let request = { ...s.input, expected_revision: s.input.expected_revision + 1 }
    if (attack === 'foreign-context' || attack === 'foreign-binding') {
      const owner = { project_id: 'foreign', workspace_id: 'other_workspace' }
      await s.store.createProject({ ...owner, revision: 0 })
      const content = structuredClone(s.context.content)
      if (attack === 'foreign-binding') content.bindings.idea = ref(await s.put(s.seed('idea').content, 'other_drama', owner))
      request = { ...request, context_ref: ref(await s.put(content, 'other_drama', attack === 'foreign-context' ? owner : {})) }
    }
    if (attack === 'wrong-digest') request.context_ref = { ...request.context_ref, content_digest: `sha256:${'0'.repeat(64)}` }
    if (attack === 'denied-workspace') s.store._authorize = () => false
    const before = structuredClone(s.store._state)
    s.runStep.mockClear()
    const response = await s.app.callTool('dramago_story_step_run', request, attack === 'missing-scope' ? { ...auth, scopes: [] } : auth)
    expect(response.structuredContent.error?.code).toBe(['missing-scope', 'denied-workspace'].includes(attack) ? 'FORBIDDEN' : 'VALIDATION_ERROR')
    expect(s.runStep).not.toHaveBeenCalled()
    expect(s.calls).toHaveLength(1)
    expect(s.store._state).toEqual(before)
  })

  it('binds idempotency to public context identity and reauthorizes replay', async () => {
    const s = await setup()
    await s.execute(s.input)
    const changedContext = await s.put({ ...s.context.content, instructions: 'Different request' })
    expect((await s.app.callTool('dramago_story_step_run', { ...s.input, context_ref: ref(changedContext) }, auth)).structuredContent.error.code).toBe('IDEMPOTENCY_CONFLICT')
    expect((await s.app.callTool('dramago_story_step_run', s.input, { ...auth, scopes: [] })).structuredContent.error.code).toBe('FORBIDDEN')
    s.store._authorize = () => false
    expect((await s.app.callTool('dramago_story_step_run', s.input, auth)).structuredContent.error.code).toBe('FORBIDDEN')
    expect(s.calls).toHaveLength(1)
  })

  it.each(['executor_id', 'configuration_ref'])('leaves trusted executor %s matching to the authoritative runtime', async field => {
    const s = await setup()
    const executor = { ...s.context.content.executor, [field]: field === 'executor_id' ? 'other_writer' : ref(s.seed('reviewer_config')) }
    const context = await s.put({ ...s.context.content, executor })
    const before = structuredClone(s.store._state)
    const result = await s.app.callTool('dramago_story_step_run', { ...s.input, context_ref: ref(context) }, auth)
    // ROLE_SEPARATION is not a published MCP error; private details remain hidden.
    expect(result.structuredContent.error?.code).toBe('INTERNAL_ERROR')
    await expect(s.runStep.mock.results[0].value).rejects.toMatchObject({ code: 'ROLE_SEPARATION' })
    expect(s.calls).toHaveLength(0)
    expect(s.store._state).toEqual(before)
  })
})
