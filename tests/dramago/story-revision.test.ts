import { describe, it, expect } from 'vitest'
import { canonicalHash } from '../../packages/dramago-application/index.js'
import { executionId } from '../../packages/story-development/src/dependencies.js'
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
  // ae8b1d5's same-role/cohort proof now comes from run_context_ref and the
  // deterministic durable execution, not creative_run_id or caller labels.
  it.each(['missing-run', 'foreign-project', 'foreign-workspace', 'wrong-domain', 'wrong-run-id', 'wrong-run-schema', 'failed-run', 'bad-manifest-digest', 'bad-manifest-refs', 'wrong-stage', 'failed-attempt', 'bad-attempt-digest', 'missing-output'])('rejects revision backed by %s before reviewer or mutation', async attack => {
    const s = await revisedStory('adaptation')
    const foundation = await s.store.getArtifactVersion(s.byRole.story_foundation.version_id)
    const command = await s.command('planning_review')
    // Writes swap the in-memory transaction snapshot; mutate the current record.
    const runId = executionId(foundation.content.run_context_ref), run = s.store._state.runs.get(runId)
    expect(run.run_id).toBe(runId)
    if (attack === 'missing-run') s.store._state.runs.delete(runId)
    if (attack === 'foreign-project') run.project_id = 'foreign'
    if (attack === 'foreign-workspace') run.workspace_id = 'foreign'
    if (attack === 'wrong-domain') run.domain = 'media'
    if (attack === 'wrong-run-id') run.run_id = 'run_other'
    if (attack === 'wrong-run-schema') run.schema_version = 'dramago.untrusted-run/v1'
    if (attack === 'failed-run') run.status = 'failed'
    if (attack === 'bad-manifest-digest') run.input_manifest_digest = `sha256:${'0'.repeat(64)}`
    if (attack === 'bad-manifest-refs') {
      run.input_manifest.input_refs.pop()
      // Keep internal hashes consistent: exact manifest membership must fail.
      run.input_manifest_digest = canonicalHash(run.input_manifest)
      run.steps[0].attempts[0].input_manifest_digest = run.input_manifest_digest
    }
    if (attack === 'wrong-stage') run.steps[0].stage = 'story.direction'
    const attempt = run.steps[0].attempts[0]
    if (attack === 'failed-attempt') attempt.status = 'failed'
    if (attack === 'bad-attempt-digest') attempt.input_manifest_digest = `sha256:${'0'.repeat(64)}`
    if (attack === 'missing-output') attempt.output_refs = []
    const before = structuredClone(s.store._state), count = s.calls.length
    await expect(s.service.planningReview(auth, command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(s.reviewCalls).toHaveLength(0); expect(s.calls).toHaveLength(count); expect(s.store._state).toEqual(before)
  })
  it('rejects episode set members split across different successful attempts', async () => {
    const s = await revisedStory('adaptation')
    const set = await s.store.getArtifactVersion(s.byRole.episode_outline_set.version_id)
    const run = s.store._state.runs.get(executionId(set.content.run_context_ref))
    const attempt = run.steps[0].attempts[0], member = set.content.ordered_episodes[0].outline_ref
    attempt.output_refs = attempt.output_refs.filter((r: any) => r.version_id !== member.version_id)
    run.steps[0].attempts.push({ ...structuredClone(attempt), attempt: 2, output_refs: [member] })
    const command = await s.command('planning_review'), before = structuredClone(s.store._state)
    await expect(s.service.planningReview(auth, command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(s.reviewCalls).toHaveLength(0); expect(s.store._state).toEqual(before)
  })
  describe.each(['story_foundation', 'story_bible'])('imported %s execution proof', role => {
    it.each(['malformed-digest', 'invented-digest', 'copied-real-context'])('rejects %s without treating imported content as a durable output', async attack => {
      const s = await revisedStory('adaptation'), original = await s.store.getArtifactVersion(s.byRole[role].version_id)
      const content = structuredClone(original.content)
      if (attack !== 'copied-real-context') content.run_context_ref.content_digest = attack === 'malformed-digest' ? 'caller-context' : `sha256:${'a'.repeat(64)}`
      const imported = await s.put(content, original.kind)
      const command = await s.command('direction', { source_refs: [ref(imported)] })
      const before = structuredClone(s.store._state), count = s.calls.length, researchCount = s.researchCalls.length
      await expect(s.service.runStep(auth, command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR',
        ...(attack === 'copied-real-context' ? { message: 'Story output lacks trusted execution provenance' } : {}) })
      expect(s.calls).toHaveLength(count); expect(s.reviewCalls).toHaveLength(0)
      expect(s.researchCalls).toHaveLength(researchCount); expect(s.store._state).toEqual(before)
    })
  })
  it.each(['generation', 'review'])('rejects a stale direction hidden behind a selected intermediate before %s', async mode => {
    const s = await revisedStory()
    // The old Bible selects its old foundation and direction transitively.
    // History in source_refs is legal; selecting it as current is not.
    const step = mode === 'review' ? 'planning_review' : 'master_outline'
    const bindings = mode === 'review' ? { ...s.byRole } : { story_foundation: s.byRole.story_foundation, story_bible: s.previous.story_bible }
    if (mode === 'review') {
      delete bindings.idea
      for (const id of s.project.planning_range.ordered_episode_ids) delete bindings[id]
      bindings.story_bible = s.previous.story_bible
    }
    const command = await s.command(step, { bindings }), before = structuredClone(s.store._state), count = s.calls.length
    await expect(mode === 'review' ? s.service.planningReview(auth, command) : s.service.runStep(auth, command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'planning scope conflicts with exact dependency' })
    expect(s.calls).toHaveLength(count); expect(s.reviewCalls).toHaveLength(0); expect(s.store._state).toEqual(before)
  })
  it.each(['generation', 'review'])('does not admit hidden creative dependencies in newly selected canonical research before %s', async mode => {
    const s = await revisedStory()
    // Published research is canonical evidence, not an alternate active Story
    // graph. The old direct_dependency_refs escape hatch is no longer valid.
    const research = await s.put({ ...s.seed('research').content, dependency_refs: [s.previous.direction] })
    const step = mode === 'review' ? 'planning_review' : 'direction'
    const command = await s.command(step, { research: { status: 'supplied', snapshot_ref: ref(research) } })
    const before = structuredClone(s.store._state), count = s.calls.length
    await expect(mode === 'review' ? s.service.planningReview(auth, command) : s.service.runStep(auth, command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(s.calls).toHaveLength(count); expect(s.reviewCalls).toHaveLength(0); expect(s.store._state).toEqual(before)
  })
  describe.each([false, true])('transitive set provenance (reverse source traversal: %s)', reverse => {
    it('rejects incompatible member contexts instead of accepting mixed historical and current episodes', async () => {
      const s = await revisedStory()
      let set = await s.store.getArtifactVersion(s.byRole.episode_outline_set.version_id)
      const originalRef = ref(set), entry = set.content.ordered_episodes[0], current = entry.outline_ref
      entry.outline_ref = s.previous[entry.episode_id]
      set.content.dependency_refs = [...new Map(set.content.dependency_refs.map((r: any) => {
        const selected = r.version_id === current.version_id ? entry.outline_ref : r
        return [canonicalHash(selected), selected]
      })).values()]
      set = seal(set); s.store._state.versions.set(set.version_id, set)
      // Reseal the exact output membership as well, so this exercises the
      // cross-member semantic boundary, not an unrelated stale digest.
      const run = s.store._state.runs.get(executionId(set.content.run_context_ref))
      run.steps[0].attempts[0].output_refs = run.steps[0].attempts[0].output_refs.map((r: any) => r.version_id === originalRef.version_id ? ref(set) : r)
      const source_refs = [ref(set), s.byRole.story_bible]
      if (reverse) source_refs.reverse()
      const command = await s.command('direction', { source_refs }), before = structuredClone(s.store._state), count = s.calls.length
      await expect(s.service.runStep(auth, command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'episode set must bind same-run outlines' })
      expect(s.calls).toHaveLength(count); expect(s.reviewCalls).toHaveLength(0); expect(s.store._state).toEqual(before)
    })
    it.each(['missing-proof', 'copied-proof'])('rejects a nested imported same-role revision with %s', async attack => {
      const s = await revisedStory(), original = await s.store.getArtifactVersion(s.byRole.direction.version_id)
      const content = structuredClone(original.content)
      if (attack === 'missing-proof') delete content.run_context_ref
      const fake = await s.put(content, original.kind, { parent_ref: s.previous.direction })
      const bridge = await s.put({ source_ref: ref(fake) })
      const source_refs = [ref(bridge), s.byRole.episode_outline_set]
      if (reverse) source_refs.reverse()
      const command = await s.command('direction', { source_refs }), before = structuredClone(s.store._state), count = s.calls.length
      await expect(s.service.runStep(auth, command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR',
        ...(attack === 'copied-proof' ? { message: 'Story output lacks trusted execution provenance' } : {}) })
      expect(s.calls).toHaveLength(count); expect(s.reviewCalls).toHaveLength(0); expect(s.store._state).toEqual(before)
    })
    it.each(['story_foundation', 'story_bible'])('preserves verified history when %s is shallow and its dependencies are deeper', async role => {
      const s = await revisedStory(), source_refs = [s.byRole[role], s.byRole.episode_outline_set]
      if (reverse) source_refs.reverse()
      const e = await s.execute('planning_review', await s.command('planning_review', { source_refs }))
      expect(e.run.status).toBe('succeeded')
      const artifacts = s.reviewCalls[0].artifacts.map(ref)
      for (const name of ['direction', 'story_foundation', 'story_bible']) {
        expect(artifacts).toContainEqual(s.byRole[name]); expect(artifacts).toContainEqual(s.previous[name])
        expect(e.run.input_manifest.input_refs).not.toContainEqual(s.previous[name])
      }
      expect(e.outputs[0].content.dependency_refs).toEqual(e.run.input_manifest.input_refs)
    })
  })
  it('rejects ambiguous selected versions rather than using array or last-root wins semantics', async () => {
    const s = await revisedStory(), command = await s.command('adaptation', { bindings: { idea: s.byRole.idea, direction: [s.byRole.direction, s.previous.direction] } })
    const before = structuredClone(s.store._state), count = s.calls.length
    await expect(s.service.runStep(auth, command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(s.calls).toHaveLength(count); expect(s.store._state).toEqual(before)
  })
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