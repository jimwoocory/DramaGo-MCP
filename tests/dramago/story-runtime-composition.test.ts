import { describe, it, expect } from 'vitest'
import { InMemoryDramaRepository } from '../../packages/dramago-persistence/index.js'
import { canonicalHash, createDramaApplication } from '../../packages/dramago-application/index.js'
import { StoryDevelopmentService } from '../../packages/story-development/src/index.js'
import { createDramaGoMcp, loadCatalog } from '../../apps/dramago-mcp/index.js'
import * as ports from '../../apps/dramago-mcp/story-ports.js'

const auth = { tenantId: 'tenant', subjectId: 'author', clientId: 'test', scopes: ['story.execute', 'story.review', 'project.read'] }
const ref = (v: any) => ({ artifact_id: v.artifact_id, version_id: v.version_id, content_digest: v.content_digest })
async function setup() {
  const store = new InMemoryDramaRepository({ tenantId: 'tenant', authorize: () => true })
  let serial = 0
  const artifact = async (kind: string, content: any, extra = {}) => {
    const id = ++serial
    const v = { schema_version: 'dramago.artifact-version/v1', project_id: 'project', workspace_id: 'ws', artifact_id: `art_${id}`, version_id: `av_${id}`, kind, content, content_digest: canonicalHash(content), created_at: '2026-01-01T00:00:00Z', ...extra }
    await store.putArtifactVersion(v)
    return v
  }
  await store.createProject({ project_id: 'project', workspace_id: 'ws', revision: 0 })
  const range = await artifact('planning_range', { range_id: 'season', ordered_episode_ids: ['EP01', 'EP02'] })
  await store.compareAndSetProject('project', 0, { planning_range: { range_id: 'season', definition_ref: ref(range), ordered_episode_ids: ['EP01', 'EP02'] } })
  const idea = await artifact('other_drama', { schema_version: 'dramago.story-idea/v1', premise: 'A debt exposes an ally', constraints: [] })
  const config = await artifact('other_drama', { purpose: 'local executor configuration' })
  const calls: any[] = []
  const researchCalls: any[] = []
  const service = new StoryDevelopmentService(store, {
    generation: { identity: 'writer', generate: async request => { calls.push(request); return { proposals: [{ role: 'direction', data: { logline: 'Trust has a cost' } }] } } },
    review: { identity: 'reviewer', review: async request => { calls.push(request); return { outcome: 'PASS', findings: [], blockers: [], subject_refs: request.subject_refs, context_refs: request.context_refs } } },
    research: { resolve: async request => { researchCalls.push(request); if (!request.requested_ref) throw new Error('must not select latest research'); return request.requested_ref } },
  })
  const context = await artifact('other_drama', {
    schema_version: 'dramago.story-run-context/v1', policy_version: 'story-development/v1', operation: 'direction', project_revision: 1,
    planning_scope: (await store.getProject('project')).planning_range, instructions: 'Write a direction proposal',
    executor: { role: 'writer', executor_id: 'writer', configuration_ref: ref(config) },
    bindings: { idea: ref(idea) }, source_refs: [], research: { status: 'omitted', reason: 'Direction permits no research' },
  })
  const input = { project_id: 'project', expected_revision: 1, idempotency_key: 'direction-key', context_ref: ref(context), step: 'direction' }
  // This is a real service + repository, not a synthetic public Story port.
  expect(ports).toHaveProperty('createLocalStoryPorts')
  const storyService = (ports as any).createLocalStoryPorts(service, store)
  const app = createDramaGoMcp({ storyService, services: createDramaApplication(store), authorize: () => true })
  return { store, artifact, idea, config, context, input, service, app, calls, researchCalls }
}

async function reviewSetup() {
  const s = await setup()
  const direction = await s.app.callTool('dramago_story_step_run', s.input, auth)
  const run = await s.store.getRun(direction.structuredContent.creative_run_id)
  const bindings: any = { direction: run.steps[0].attempts[0].output_refs[0] }
  for (const role of ['story_foundation', 'story_bible', 'master_outline', 'season_architecture']) {
    bindings[role] = ref(await s.artifact(role, { artifact_role: role, generated_by: 'writer' }))
  }
  const episodes = []
  for (const episode_id of ['EP01', 'EP02']) episodes.push({ episode_id, outline_ref: ref(await s.artifact('episode_outline', { generated_by: 'writer' }, { episode_id })) })
  bindings.episode_outline_set = ref(await s.artifact('other_drama', { artifact_role: 'episode_outline_set', ordered_episodes: episodes, generated_by: 'writer' }))
  const research = await s.artifact('other_drama', { schema_version: 'dramago.research-snapshot/v1', snapshot_version: 'test/v1', captured_at: '2026-01-01T00:00:00Z', sources: [{ uri: 'urn:test:research', retrieved_at: '2026-01-01T00:00:00Z' }], evidence: { note: 'Offline fixture' } })
  const context = await s.artifact('other_drama', { ...s.context.content, operation: 'planning_review', project_revision: 2,
    executor: { role: 'reviewer', executor_id: 'reviewer', configuration_ref: ref(s.config) }, bindings,
    research: { status: 'supplied', snapshot_ref: ref(research) } })
  return { ...s, episodes, bindings, reviewContext: context, reviewInput: { project_id: 'project', expected_revision: 2, idempotency_key: 'review-key', context_ref: ref(context) } }
}

describe('public Story tool -> local adapter -> actual runtime -> InMemory repository', () => {
  it('constructs exact planning scope and persists independent review evidence without approving', async () => {
    const s = await reviewSetup()
    const response = await s.app.callTool('dramago_planning_review', s.reviewInput, auth)
    expect(response.isError).toBe(false)
    expect(Object.keys(response.structuredContent)).toEqual(['creative_run_id'])
    const run = await s.store.getRun(response.structuredContent.creative_run_id)
    expect(run.status).toBe('succeeded')
    expect(run.input_manifest.input_refs).toContainEqual(ref(s.reviewContext))
    expect(run.input_manifest.input_refs).toContainEqual(ref(s.config))
    const report = await s.store.getArtifactVersion(run.steps[0].attempts[0].output_refs[0].version_id)
    expect(report.content).toMatchObject({ outcome: 'PASS', generated_by: 'reviewer', blockers: [] })
    expect(report.content.direct_dependency_refs).toContainEqual(ref(s.reviewContext))
    expect(report.content.direct_dependency_refs).toContainEqual(ref(s.config))
    expect(s.calls[1].planning_scope.ordered_episodes).toEqual(s.episodes)
    expect(s.calls[1].planning_scope.direction_ref).toEqual(s.bindings.direction)
    expect(await s.app.callTool('dramago_planning_review', s.reviewInput, auth)).toEqual(response)
    expect(s.calls).toHaveLength(2)
    expect(s.researchCalls).toHaveLength(1)
    expect(s.researchCalls[0].requested_ref).toEqual(s.reviewContext.content.research.snapshot_ref)
    expect(s.store._state.runs.size).toBe(2)
    expect(s.store._state.approvals.size).toBe(0)
    expect(s.store._state.baselines.size).toBe(0)
  })

  it.each(['missing-context', 'runtime-payload', 'latest', 'wrong-digest', 'extra-field', 'overlong-key'])('rejects invalid public request: %s', async attack => {
    const s = await setup()
    const input: any = structuredClone(s.input)
    if (attack === 'missing-context') delete input.context_ref
    if (attack === 'runtime-payload') { delete input.context_ref; input.input_refs = [ref(s.idea)]; input.workspace_id = 'ws' }
    if (attack === 'latest') input.context_ref.version_id = 'av_latest'
    if (attack === 'wrong-digest') input.context_ref.content_digest = `sha256:${'0'.repeat(64)}`
    if (attack === 'extra-field') input.planning_scope = {}
    if (attack === 'overlong-key') input.idempotency_key = 'x'.repeat(257)
    expect((await s.app.callTool('dramago_story_step_run', input, auth)).structuredContent.error.code).toBe('VALIDATION_ERROR')
    expect(s.calls).toHaveLength(0)
    expect(s.store._state.runs.size).toBe(0)
  })

  it.each(['missing-binding', 'wrong-operation', 'wrong-revision', 'wrong-range', 'missing-scope', 'missing-config', 'missing-source', 'foreign-context', 'foreign-binding', 'corrupt-context', 'missing-workspace', 'wrong-idea-kind'])('fails closed before runtime mutation: %s', async attack => {
    const s = await setup()
    const content: any = structuredClone(s.context.content)
    let extra = {}
    if (attack === 'missing-binding') delete content.bindings.idea
    if (attack === 'wrong-operation') content.operation = 'bible'
    if (attack === 'wrong-revision') content.project_revision = 0
    if (attack === 'wrong-range') content.planning_scope.ordered_episode_ids.reverse()
    if (attack === 'missing-scope') delete content.planning_scope
    if (attack === 'missing-config') delete content.executor.configuration_ref
    if (attack === 'missing-source') content.source_refs = [{ ...ref(s.idea), version_id: 'av_missing' }]
    if (attack === 'foreign-context') { await s.store.createProject({ project_id: 'foreign', workspace_id: 'other-workspace', revision: 0 }); extra = { project_id: 'foreign', workspace_id: 'other-workspace' } }
    if (attack === 'foreign-binding') { await s.store.createProject({ project_id: 'foreign', workspace_id: 'ws', revision: 0 }); content.bindings.idea = ref(await s.artifact('other_drama', 'foreign', { project_id: 'foreign' })) }
    if (attack === 'wrong-idea-kind') content.bindings.idea = ref(s.config)
    const context = await s.artifact('other_drama', content, extra)
    if (attack === 'corrupt-context') s.store._state.versions.get(context.version_id).content.instructions = 'tampered'
    if (attack === 'missing-workspace') delete s.store._state.projects.get('project').workspace_id
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
      const episodes = structuredClone(s.episodes)
      if (attack === 'missing-episode') episodes.pop()
      if (attack === 'reordered-episodes') episodes.reverse()
      if (attack === 'wrong-episode') episodes[1].outline_ref = episodes[0].outline_ref
      c.bindings.episode_outline_set = ref(await s.artifact('other_drama', { artifact_role: 'episode_outline_set', ordered_episodes: episodes }))
    }
    const context = await s.artifact('other_drama', c)
    const before = structuredClone(s.store._state)
    expect((await s.app.callTool('dramago_planning_review', { ...s.reviewInput, context_ref: ref(context) }, auth)).structuredContent.error.code).toBe('VALIDATION_ERROR')
    expect(s.calls).toHaveLength(1)
    expect(s.store._state).toEqual(before)
  })

  it('keeps Script and Production unimplemented with the actual adapter wired', async () => {
    const s = await setup()
    for (const tool of loadCatalog().tools.filter((t: any) => t.domain === 'production' || ['dramago_script_draft', 'dramago_script_review'].includes(t.name))) {
      expect((await s.app.callTool(tool.name, s.input, { ...auth, scopes: [tool.authorization_class] })).structuredContent.error.code).toBe('TOOL_NOT_IMPLEMENTED')
    }
    expect(s.calls).toHaveLength(0)
  })

  it.each(['direction', 'planning_review'])('replays %s after the project planning range changes without executing again', async operation => {
    const s = await reviewSetup()
    const tool = operation === 'direction' ? 'dramago_story_step_run' : 'dramago_planning_review'
    const input = operation === 'direction' ? s.input : s.reviewInput
    const response = await s.app.callTool(tool, input, auth)
    expect(response.isError).toBe(false)
    const project = await s.store.getProject('project')
    const range = await s.artifact('planning_range', { range_id: 'next-season', ordered_episode_ids: ['EP03'] })
    await s.store.compareAndSetProject('project', project.revision, {
      planning_range: { range_id: 'next-season', definition_ref: ref(range), ordered_episode_ids: ['EP03'] },
    })
    const before = structuredClone(s.store._state)
    const executions = s.calls.length
    expect(await s.app.callTool(tool, input, auth)).toEqual(response)
    expect(s.calls).toHaveLength(executions)
    expect(s.store._state).toEqual(before)
  })

  it('binds idempotency to public context identity and reauthorizes replay', async () => {
    const s = await setup()
    const first = await s.app.callTool('dramago_story_step_run', s.input, auth)
    const changedContext = await s.artifact('other_drama', { ...s.context.content, instructions: 'Different request' })
    expect((await s.app.callTool('dramago_story_step_run', { ...s.input, context_ref: ref(changedContext) }, auth)).structuredContent.error.code).toBe('IDEMPOTENCY_CONFLICT')
    expect((await s.app.callTool('dramago_story_step_run', s.input, { ...auth, scopes: [] })).structuredContent.error.code).toBe('FORBIDDEN')
    s.store._authorize = () => false
    expect((await s.app.callTool('dramago_story_step_run', s.input, auth)).structuredContent.error.code).toBe('FORBIDDEN')
    expect(first.isError).toBe(false)
    expect(s.calls).toHaveLength(1)
  })

  it('derives Bible runtime prerequisites only from exact bound foundation dependencies', async () => {
    const s = await reviewSetup()
    const foundation = await s.artifact('story_foundation', { dependency_refs: [s.bindings.direction], generated_by: 'writer' })
    const context = await s.artifact('other_drama', { ...s.reviewContext.content, operation: 'bible', bindings: { story_foundation: ref(foundation) }, executor: s.context.content.executor })
    const generation: any[] = []
    const runtime = new StoryDevelopmentService(s.store, {
      generation: { identity: 'writer', generate: async r => { generation.push(r); return { proposals: [{ role: 'story_foundation', data: 'Foundation' }, { role: 'story_bible', data: 'Bible' }] } } },
      review: { identity: 'reviewer', review: async () => { throw new Error('wrong role') } },
      research: { resolve: async r => r.requested_ref },
    })
    const app = createDramaGoMcp({ storyService: ports.createLocalStoryPorts(runtime, s.store), authorize: () => true })
    const result = await app.callTool('dramago_story_step_run', { ...s.input, step: 'bible', expected_revision: 2, idempotency_key: 'bible-key', context_ref: ref(context) }, auth)
    expect(result.isError).toBe(false)
    const run = await s.store.getRun(result.structuredContent.creative_run_id)
    expect(run.status).toBe('succeeded')
    expect(generation[0].inputs.map(ref)).toContainEqual(s.bindings.direction)
  })

  it('rejects a context that names a different executor instead of silently running the configured writer', async () => {
    const s = await setup()
    const context = await s.artifact('other_drama', { ...s.context.content, executor: { ...s.context.content.executor, executor_id: 'other-writer' } })
    const result = await s.app.callTool('dramago_story_step_run', { ...s.input, context_ref: ref(context) }, auth)
    expect(result.structuredContent.error?.code).toBe('VALIDATION_ERROR')
    expect(s.calls).toHaveLength(0)
    expect(s.store._state.runs.size).toBe(0)
  })

  it('maps direction and returns only the contract identity of the persisted run, including replay', async () => {
    const s = await setup()
    const response = await s.app.callTool('dramago_story_step_run', s.input, auth)
    expect(response.isError).toBe(false)
    expect(Object.keys(response.structuredContent)).toEqual(['creative_run_id'])
    const run = await s.store.getRun(response.structuredContent.creative_run_id)
    expect(run).toMatchObject({ run_id: response.structuredContent.creative_run_id, workspace_id: 'ws', status: 'succeeded' })
    expect(run.input_manifest.input_refs).toEqual(expect.arrayContaining([ref(s.context), ref(s.idea), ref(s.config)]))
    expect(s.calls).toHaveLength(1)
    expect(await s.app.callTool('dramago_story_step_run', s.input, auth)).toEqual(response)
    expect(s.calls).toHaveLength(1)
    expect(s.store._state.runs.size).toBe(1)
    expect(s.researchCalls).toHaveLength(0)
    expect(s.store._state.approvals.size).toBe(0)
  })
})
