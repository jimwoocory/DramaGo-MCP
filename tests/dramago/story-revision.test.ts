import { describe, it, expect } from 'vitest'
import { InMemoryDramaRepository } from '../../packages/dramago-persistence/index.js'
import { canonicalHash } from '../../packages/dramago-application/index.js'
import { StoryDevelopmentService } from '../../packages/story-development/src/index.js'

const auth = { tenantId: 'tenant', subjectId: 'author', clientId: 'test', scopes: ['story.execute', 'story.review'] }
const ref = (v: any) => ({ artifact_id: v.artifact_id, version_id: v.version_id, content_digest: v.content_digest })
async function revisedStory() {
  const store = new InMemoryDramaRepository({ tenantId: 'tenant', authorize: () => true })
  const artifact = async (id: string, kind: string, content: any) => {
    const v = { schema_version: 'dramago.artifact-version/v1', project_id: 'project', workspace_id: 'ws', artifact_id: `art_${id}`, version_id: `av_${id}`, content_digest: canonicalHash(content), kind, content, created_at: '2026-01-01T00:00:00Z' }
    await store.putArtifactVersion(v)
    return v
  }
  await store.createProject({ project_id: 'project', workspace_id: 'ws', revision: 0 })
  const range = await artifact('range', 'planning_range', { ordered_episode_ids: ['EP01'] })
  await store.compareAndSetProject('project', 0, { planning_range: { range_id: 'season1', ordered_episode_ids: ['EP01'], definition_ref: ref(range) } })
  const idea = await artifact('idea', 'other_drama', 'A secret changes everything.')
  const research = await artifact('research', 'other_drama', { schema_version: 'dramago.research-snapshot/v1', snapshot_version: 'synthetic/v1', captured_at: '2026-01-01T00:00:00Z', sources: [{ uri: 'urn:test:evidence', retrieved_at: '2026-01-01T00:00:00Z' }], evidence: {} })
  const reviews: any[] = []
  const service = new StoryDevelopmentService(store, {
    generation: { identity: 'writer', generate: async (r: any) => ({ proposals: r.step === 'episode_outlines'
      ? [{ role: 'episode_outline', episode_id: 'EP01', data: 'Consequences' }]
      : (r.step === 'bible' ? ['story_foundation', 'story_bible'] : [r.step]).map(role => ({ role, data: `Synthetic ${role}` })) }) },
    review: { identity: 'reviewer', review: async (r: any) => { reviews.push(r); return { outcome: 'PASS', subject_refs: r.subject_refs, context_refs: r.context_refs, findings: [], blockers: [] } } },
    research: { resolve: async () => ref(research) },
  })
  let sequence = 0
  const advance = async (step: any, input_refs: any[]) => {
    const result = await service.runStep(auth, { project_id: 'project', workspace_id: 'ws', expected_revision: (await store.getProject('project')).revision, idempotency_key: `step-${++sequence}`, step, input_refs })
    expect(result.status).toBe('succeeded')
    return result.output_refs
  }
  const [d1] = await advance('direction', [ref(idea)])
  const [d2] = await advance('direction', [d1])
  const byRole: any = { direction: d2 }
  let inputs = [d2]
  for (const step of ['adaptation', 'bible', 'master_outline', 'season_architecture', 'episode_outlines']) {
    const outputs = await advance(step, inputs)
    for (const r of outputs) {
      const v = await store.getArtifactVersion(r.version_id)
      byRole[v.episode_id ?? v.content.artifact_role] = r
    }
    inputs = [...inputs, ...outputs]
  }
  const command = { project_id: 'project', workspace_id: 'ws', expected_revision: (await store.getProject('project')).revision, idempotency_key: 'review', planning_scope: {
    direction_ref: d2, story_foundation: byRole.story_foundation, story_bible: byRole.story_bible,
    master_outline: byRole.master_outline, season_architecture: byRole.season_architecture,
    episode_outline_set_ref: byRole.episode_outline_set, ordered_episodes: [{ episode_id: 'EP01', outline_ref: byRole.EP01 }],
  } }
  return { store, service, artifact, d1, d2, command, reviews, byRole, advance }
}

async function pairedRevision() {
  const s = await revisedStory()
  const previous = { ...s.byRole }
  const [foundation, bible] = await s.advance('bible', [s.d2, previous.story_foundation, previous.story_bible])
  let inputs = [s.d2, foundation, bible]
  s.command.planning_scope.story_foundation = foundation
  s.command.planning_scope.story_bible = bible
  for (const step of ['master_outline', 'season_architecture', 'episode_outlines']) {
    const outputs = await s.advance(step, inputs)
    for (const r of outputs) {
      const v = await s.store.getArtifactVersion(r.version_id)
      if (v.episode_id) s.command.planning_scope.ordered_episodes = [{ episode_id: v.episode_id, outline_ref: r }]
      else (s.command.planning_scope as any)[v.content.artifact_role === 'episode_outline_set' ? 'episode_outline_set_ref' : v.content.artifact_role] = r
    }
    inputs = [...inputs, ...outputs]
  }
  s.command.expected_revision = (await s.store.getProject('project')).revision
  return { ...s, previous }
}

describe('Story revision provenance', () => {
  it('reviews a paired foundation/Bible revision with full historical provenance', async () => {
    const s = await pairedRevision()
    const result = await s.service.planningReview(auth, s.command)
    expect(result.status).toBe('succeeded')
    expect(s.reviews).toHaveLength(1)
    const run = await s.store.getRun(result.creative_run_id)
    expect(run.input_manifest.input_refs).toEqual(expect.arrayContaining([
      s.previous.story_foundation, s.previous.story_bible,
      s.command.planning_scope.story_foundation, s.command.planning_scope.story_bible,
    ]))
    const report = await s.store.getArtifactVersion(result.output_refs[0].version_id)
    expect(report.content.dependency_refs).toEqual(run.input_manifest.input_refs)
  })

  it.each(['story_foundation', 'story_bible', 'master_outline', 'season_architecture'])('rejects stale %s in a paired revision scope', async (role) => {
    const s = await pairedRevision()
    ;(s.command.planning_scope as any)[role] = s.previous[role]
    const before = structuredClone(s.store._state)
    await expect(s.service.planningReview(auth, s.command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'planning scope conflicts with exact dependency' })
    expect(s.reviews).toHaveLength(0)
    expect(s.store._state).toEqual(before)
  })

  it('rejects a current Bible from a different generation cohort', async () => {
    const s = await pairedRevision()
    const [, otherBible] = await s.advance('bible', [s.d2, s.previous.story_foundation, s.previous.story_bible])
    s.command.planning_scope.story_bible = otherBible
    s.command.expected_revision = (await s.store.getProject('project')).revision
    await expect(s.service.planningReview(auth, s.command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'planning scope conflicts with exact dependency' })
    expect(s.reviews).toHaveLength(0)
  })

  it.each(['story_foundation', 'story_bible'])('verifies historical %s content in a paired revision', async (role) => {
    const s = await pairedRevision()
    s.store._state.versions.get(s.previous[role].version_id).content = 'tampered historical sibling'
    await expect(s.service.planningReview(auth, s.command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'stored content digest mismatch' })
    expect(s.reviews).toHaveLength(0)
  })

  it('still rejects an actually inconsistent selected direction', async () => {
    const s = await revisedStory()
    s.command.planning_scope.direction_ref = s.d1
    await expect(s.service.planningReview(auth, s.command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'planning scope conflicts with exact dependency' })
    expect(s.reviews).toHaveLength(0)
  })

  it('still validates a historical ancestor that is not a selected dependency', async () => {
    const s = await revisedStory()
    s.store._state.versions.get(s.d1.version_id).content = 'tampered historical direction'
    await expect(s.service.planningReview(auth, s.command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'stored content digest mismatch' })
    expect(s.reviews).toHaveLength(0)
  })

  it.each(['omitted', 'empty', 'malformed', 'duplicate'])('rejects %s direct provenance before model calls', async (attack) => {
    const s = await revisedStory()
    const content: any = { artifact_role: 'direction', dependency_refs: [s.d1], direct_dependency_refs: [s.d1] }
    if (attack === 'omitted') content.dependency_refs = []
    if (attack === 'empty') content.direct_dependency_refs = []
    if (attack === 'malformed') content.direct_dependency_refs = 'not an array'
    if (attack === 'duplicate') content.direct_dependency_refs = [s.d1, s.d1]
    const forged = await s.artifact(`forged-${attack}`, 'other_drama', content)
    const before = structuredClone(s.store._state)
    await expect(s.service.runStep(auth, { project_id: 'project', workspace_id: 'ws', expected_revision: s.command.expected_revision, idempotency_key: 'forged-input', step: 'bible', input_refs: [ref(forged)] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('direct dependency') })
    expect(s.reviews).toHaveLength(0)
    expect(s.store._state).toEqual(before)
  })

  it('reviews regenerated downstream artifacts after D1 -> D2 without losing historical provenance', async () => {
    const s = await revisedStory()
    const result = await s.service.planningReview(auth, s.command)
    expect(result.status).toBe('succeeded')
    expect(s.reviews).toHaveLength(1)
    const run = await s.store.getRun(result.creative_run_id)
    expect(run.input_manifest.input_refs).toEqual(expect.arrayContaining([s.d1, s.d2]))
    const bible = await s.store.getArtifactVersion(s.byRole.story_bible.version_id)
    expect(bible.content.dependency_refs).toEqual(expect.arrayContaining([s.d1, s.d2]))
    const report = await s.store.getArtifactVersion(result.output_refs[0].version_id)
    expect(report.content.dependency_refs).toEqual(run.input_manifest.input_refs)
  })
})
