import { describe, it, expect } from 'vitest'
import { auth, contextOf, ref, seal, setup } from './helpers/story-runtime.js'

const steps = ['direction', 'adaptation', 'bible', 'master_outline', 'season_architecture', 'episode_outlines']
const roleOf = (v: any) => v.episode_id ?? v.content.schema_version.slice(8, -3).replaceAll('-', '_')

// The published contract has one foundation output from adaptation and one Bible
// output from bible. There is no paired Bible cohort or direct_dependency_refs.
// Current semantic dependencies live in context.bindings; revision history lives
// in source_refs and the new ArtifactVersion's parent_ref, retaining artifact_id.
async function revisedStory(start = 'direction') {
  const parents: Record<string, any> = {}
  const s = await setup({ generate: async (request: any, generate: any) => {
    const bundle = await generate(request)
    bundle.proposals = bundle.proposals.map((v: any) => {
      if (roleOf(v) === 'story_foundation') v.content.adaptation.source_refs = contextOf(request).source_refs
      const parent = parents[roleOf(v)]
      if (!parent) return seal(v)
      expect(contextOf(request).source_refs).toContainEqual(ref(parent))
      return seal({ ...v, artifact_id: parent.artifact_id, parent_ref: ref(parent) })
    })
    return bundle
  } })
  for (const e of await s.fullStory()) expect(e.run.status).toBe('succeeded')
  const previous = structuredClone(s.byRole)
  const originals = new Map<string, any>()
  for (const r of Object.values(previous) as any[]) originals.set(r.version_id, await s.store.getArtifactVersion(r.version_id))
  const revisions = []
  for (const step of steps.slice(steps.indexOf(start))) {
    const roles = step === 'direction' ? ['direction'] : step === 'adaptation' ? ['story_foundation'] : step === 'bible' ? ['story_bible']
      : step === 'episode_outlines' ? s.project.planning_range.ordered_episode_ids : [step]
    for (const role of roles) parents[role] = originals.get(previous[role].version_id)
    const request = await s.command(step, { source_refs: roles.map(role => previous[role]) })
    const e = await s.execute(step, request)
    expect(e.run.status).toBe('succeeded')
    revisions.push(e)
  }
  return { ...s, previous, originals, revisions }
}

describe('Story revision provenance under the published contract', () => {
  it.each(['direction', 'adaptation', 'bible', 'master_outline', 'season_architecture'])('propagates a %s revision through current dependencies without selecting historical parents', async (start) => {
    const s = await revisedStory(start)
    for (const e of s.revisions) {
      for (const v of e.outputs.filter((a: any) => a.parent_ref)) {
        const old = s.originals.get(v.parent_ref.version_id)
        expect(v.parent_ref).toEqual(ref(old))
        expect(v.artifact_id).toBe(old.artifact_id)
        expect(v.version_id).not.toBe(old.version_id)
        expect(e.run.input_manifest.input_refs).toContainEqual(ref(old))
        expect(await s.store.getArtifactVersion(old.version_id)).toEqual(old)
      }
    }
    const review = await s.execute('planning_review')
    expect(review.run.status).toBe('succeeded')
    expect(s.reviewCalls).toHaveLength(1)
    // Transitive history is in frozen artifacts, not flattened into the direct manifest.
    const inspected = s.reviewCalls[0].artifacts.map(ref)
    for (const e of s.revisions) for (const v of e.outputs.filter((a: any) => a.parent_ref)) {
      expect(inspected).toContainEqual(v.parent_ref)
      expect(inspected).toContainEqual(ref(v))
    }
    expect(review.outputs[0].content.dependency_refs).toEqual(review.run.input_manifest.input_refs)
    expect(s.store._state.approvals.size).toBe(0)
  })

  it.each(['direction', 'story_foundation', 'story_bible', 'master_outline', 'season_architecture'])('rejects a stale selected %s even when it is valid historical provenance', async (role) => {
    const s = await revisedStory()
    const command = await s.command('planning_review')
    const context = await s.store.getArtifactVersion(command.context_ref.version_id)
    const forged = await s.put({ ...context.content, bindings: { ...context.content.bindings, [role]: s.previous[role] } })
    command.context_ref = ref(forged)
    const before = structuredClone(s.store._state)
    await expect(s.service.planningReview(auth, command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'planning scope conflicts with exact dependency' })
    expect(s.reviewCalls).toHaveLength(0)
    expect(s.store._state).toEqual(before)
  })

  it('rejects an independently regenerated Bible not used by the selected downstream artifacts', async () => {
    const s = await revisedStory('adaptation')
    // A valid new Bible alone does not retroactively change the old master/season.
    const bible = await s.execute('bible', await s.command('bible', { source_refs: [s.previous.story_bible] }))
    expect(bible.run.status).toBe('succeeded')
    const request = await s.command('planning_review')
    const before = structuredClone(s.store._state)
    await expect(s.service.planningReview(auth, request)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'planning scope conflicts with exact dependency' })
    expect(s.reviewCalls).toHaveLength(0)
    expect(s.store._state).toEqual(before)
  })

  it.each(['direction', 'story_foundation', 'story_bible', 'master_outline', 'season_architecture'])('verifies historical %s bytes even though that parent is not selected', async (role) => {
    const s = await revisedStory()
    const request = await s.command('planning_review')
    s.store._state.versions.get(s.previous[role].version_id).content = 'tampered historical parent'
    const before = structuredClone(s.store._state)
    await expect(s.service.planningReview(auth, request)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'stored content digest mismatch' })
    expect(s.reviewCalls).toHaveLength(0)
    expect(s.store._state).toEqual(before)
  })

  it.each(['omitted', 'empty', 'malformed', 'duplicate', 'legacy-direct-dependencies', 'untrusted-execution'])('rejects %s provenance before a downstream model call', async (attack) => {
    const s = await setup()
    const first = await s.execute('direction')
    const original = first.outputs[0]
    const content = structuredClone(original.content)
    if (attack === 'omitted') delete content.dependency_refs
    if (attack === 'empty') content.dependency_refs = []
    if (attack === 'malformed') content.dependency_refs = 'not an array'
    if (attack === 'duplicate') content.dependency_refs.push(content.dependency_refs[0])
    if (attack === 'legacy-direct-dependencies') content.direct_dependency_refs = content.dependency_refs
    // Even a byte-identical content copy cannot impersonate a durable run output.
    const forged = await s.put(content, original.kind)
    s.byRole.direction = ref(forged)
    const request = await s.command('adaptation')
    const before = structuredClone(s.store._state)
    await expect(s.service.runStep(auth, request)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(s.calls).toHaveLength(1)
    expect(s.store._state).toEqual(before)
  })
})
