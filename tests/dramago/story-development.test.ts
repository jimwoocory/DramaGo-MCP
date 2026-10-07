import { describe, it, expect } from 'vitest'
import { JournalDramaRepository } from '../../packages/dramago-persistence/index.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalHash, createDramaApplication } from '../../packages/dramago-application/index.js'
import { StoryDevelopmentService } from '../../packages/story-development/src/index.js'
import { resolveDependencies } from '../../packages/story-development/src/dependencies.js'
import { independentReviewer } from '../../packages/story-development/src/review.js'
import { auth, contextOf, ref, seal, setup } from './helpers/story-runtime.js'

const steps = ['direction', 'adaptation', 'bible', 'master_outline', 'season_architecture', 'episode_outlines']
async function fullStory(options: any = {}) {
  const s = await setup(options)
  for (const e of await s.fullStory()) expect(e.run.status).toBe('succeeded')
  return s
}
const failed = (s: any, e: any, code: string) => {
  expect(e.run.status).toBe('failed')
  expect(e.run.steps[0].attempts[0].output_refs).toEqual([])
  expect(e.outputs).toEqual([])
  expect([...s.store._state.audit.values()].at(-1)).toMatchObject({ error_code: code })
  expect(s.store._state.approvals.size).toBe(0)
}
async function approvalInput(s: any, e: any) {
  const report = e.outputs[0], p = await s.store.getProject(s.project.project_id)
  const policy_version = 'planning-baseline/v1'
  const authorization = await s.put({ actor_id: 'author', policy_version }, 'authorization_evidence')
  const set = await s.store.getArtifactVersion(s.byRole.episode_outline_set.version_id)
  const manifest = { schema_version: 'dramago.planning-manifest/v1', workspace_id: p.workspace_id, project_id: p.project_id,
    range_id: p.planning_range.range_id, range_definition_ref: p.planning_range.definition_ref,
    ...Object.fromEntries(['story_foundation', 'story_bible', 'master_outline', 'season_architecture'].map(k => [k, s.byRole[k]])),
    ordered_episodes: set.content.ordered_episodes,
    review_evidence: [{ evidence_ref: ref(report), subject_refs: report.content.subject_refs, outcome: report.content.outcome }], policy_version }
  const baseline: any = { schema_version: 'dramago.planning-baseline/v1', artifact_id: 'art_baseline', version_id: 'av_baseline', planning_baseline_id: 'pb_story', manifest, content_digest: canonicalHash(manifest), created_at: '2026-01-01T00:00:00Z' }
  const body = { schema_version: 'dramago.approval-decision/v1', approval_id: 'approve-story', project_id: p.project_id, workspace_id: p.workspace_id, decision: 'approved', target_refs: [ref(baseline)], evidence_refs: [ref(report)], actor: { actor_type: 'human', actor_id: 'author', authorization_ref: ref(authorization) }, policy_version, decided_at: '2026-01-01T00:00:00Z' }
  const approval = { ...body, artifact_id: 'art_approval', version_id: 'av_approval', content_digest: canonicalHash(body) }
  baseline.approval_refs = [ref(approval)]
  return { project_id: p.project_id, workspace_id: p.workspace_id, expected_revision: p.revision, idempotency_key: 'approval-1', baseline, approval }
}

describe('P2 Story runtime with the published three-port contract', () => {
  it('proves every generated author including episode sets with exact member dependencies', async () => {
    const s = await fullStory()
    const project = await s.store.getProject(s.project.project_id)
    const inputs = await resolveDependencies(s.store, project, [s.byRole.episode_outline_set])
    await expect(independentReviewer(s.store, project, 'reviewer_a', inputs, s.configuration.authorship, true)).resolves.toBeUndefined()
    await expect(independentReviewer(s.store, project, 'reviewer_a', inputs, undefined, true)).rejects.toMatchObject({ code: 'ROLE_SEPARATION' })
  })
  it.each(['idea', 'source'])('rejects unknown transitive %s authorship before review or writes', async unknown => {
    const s = await fullStory()
    // Self-declared labels are not a trusted host attestation.
    const source = await s.put({ note: 'Imported source', generated_by: 'not-the-reviewer' })
    const parent = await s.put({ source_ref: ref(source) })
    const service = new StoryDevelopmentService(s.store, { ...s.configuration,
      authorship: unknown === 'idea' ? undefined : { attest: async (request: any, signal: AbortSignal) =>
        canonicalHash(ref(request.artifact)) === canonicalHash(ref(parent))
          ? { artifact_ref: ref(parent), author_identities: ['fixture-source-author'] }
          : s.configuration.authorship.attest(request, signal) },
    })
    const command = await s.command('planning_review', { source_refs: unknown === 'source' ? [ref(parent)] : [] })
    const before = structuredClone(s.store._state), count = s.calls.length
    await expect(service.planningReview(auth, command)).rejects.toMatchObject({ code: 'ROLE_SEPARATION' })
    expect(s.reviewCalls).toHaveLength(0); expect(s.calls).toHaveLength(count)
    expect(s.store._state).toEqual(before)
  })
  it.each(['unnamed-source', 'copied-seed', 'changed-digest', 'changed-body', 'foreign-project', 'foreign-workspace', 'foreign-owner'])('fixture authorship does not trust %s', async attack => {
    const s = await setup(), artifact = structuredClone(s.seed('idea')), project = structuredClone(s.project)
    if (attack === 'unnamed-source') Object.assign(artifact, await s.put({ note: 'Unattested' }))
    if (attack === 'copied-seed') { artifact.artifact_id = 'art_copy'; artifact.version_id = 'av_copy' }
    if (attack === 'changed-digest') artifact.content_digest = `sha256:${'0'.repeat(64)}`
    if (attack === 'changed-body') artifact.content.premise = 'Changed without resealing'
    if (attack === 'foreign-project') artifact.project_id = 'foreign'
    if (attack === 'foreign-workspace') artifact.workspace_id = 'foreign'
    if (attack === 'foreign-owner') project.project_id = 'foreign'
    expect(await s.configuration.authorship.attest({ artifact, project, reviewer_identity: 'reviewer_a' })).toBeNull()
  })
  it.each(['generation', 'review', 'research', 'generation-config', 'review-config', 'old-resolve'])('constructor fails closed for missing %s', async attack => {
    const s = await setup(), config: any = { ...s.configuration }
    if (attack.endsWith('-config')) { const key = attack.split('-')[0]; config[key] = { ...config[key], configuration_ref: undefined } }
    else if (attack === 'old-resolve') config.research = { resolve: async () => s.seed('research') }
    else delete config[attack]
    expect(() => new StoryDevelopmentService(s.store, config)).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }))
  })
  it.each(['same-identity', 'same-object', 'same-function'])('refuses role reuse: %s', async attack => {
    const s = await setup(), config: any = { ...s.configuration, review: { ...s.configuration.review } }
    if (attack === 'same-identity') config.review.identity = config.generation.identity
    if (attack === 'same-function') config.review.review = config.generation.generate
    if (attack === 'same-object') config.review = config.generation = { ...config.generation, review: config.review.review }
    expect(() => new StoryDevelopmentService(s.store, config)).toThrowError(expect.objectContaining({ code: 'ROLE_SEPARATION' }))
  })
  it('recovers a committed review and exact frozen inputs after journal reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dramago-p2-'))
    const options = { tenantId: 'tenant', directory, authorize: () => true }
    let store = new JournalDramaRepository(options)
    try {
      const s = await fullStory({ store }), e = await s.execute('planning_review')
      expect(e.run.status).toBe('succeeded')
      await store.close(); store = new JournalDramaRepository(options)
      const noCall = async () => { throw new Error('ports must not run on replay') }
      const service = new StoryDevelopmentService(store, { ...s.configuration,
        generation: { ...s.configuration.generation, generate: noCall }, review: { ...s.configuration.review, review: async () => noCall() }, research: { resolve_snapshot: noCall } })
      expect(await service.planningReview(auth, e.request)).toEqual(e.result)
      expect(await store.getRun(e.result.creative_run_id)).toEqual(e.run)
      for (const r of [...e.run.input_manifest.input_refs, ...e.outputs.map(ref)]) {
        const v = await store.getArtifactVersion(r.version_id)
        expect(ref(v)).toEqual(r); expect(canonicalHash(v.content)).toBe(r.content_digest)
      }
      expect(store._state.approvals.size).toBe(0)
      expect(store._state.runs.size).toBe(7)
    } finally { await store.close(); rmSync(directory, { recursive: true, force: true }) }
  })
  it('late writer results after timeout cannot publish artifacts', async () => {
    let finish: any, signal: AbortSignal | undefined
    const s = await setup({ config: { timeout_ms: 15 }, generate: async (_: any, __: any, abort: AbortSignal) => {
      signal = abort; return new Promise(resolve => { finish = resolve })
    } })
    const e = await s.execute('direction'); failed(s, e, 'PORT_TIMEOUT')
    expect(signal?.aborted).toBe(true)
    const before = structuredClone(s.store._state)
    finish({ proposals: [] }); await new Promise(resolve => setImmediate(resolve))
    expect(s.store._state).toEqual(before)
  })
  it('outputs are immutable and a fresh context creates new versions', async () => {
    const s = await setup(), first = await s.execute('direction'), next = await s.execute('direction')
    expect(next.run.status).toBe('succeeded')
    expect(next.outputs[0].version_id).not.toBe(first.outputs[0].version_id)
    await expect(s.store.putArtifactVersion(seal({ ...first.outputs[0], content: 'changed' }))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(await s.store.getArtifactVersion(first.outputs[0].version_id)).toEqual(first.outputs[0])
  })
  it('caller fields cannot switch the method authorization class', async () => {
    const s = await setup(), command = await s.command('direction')
    await expect(s.service.runStep({ ...auth, scopes: ['story.review'] }, command)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(s.service.planningReview({ ...auth, scopes: ['story.execute'] }, command)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(s.service.planningReview(auth, command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
  it('fails closed for a permissive repository returning false authorization', async () => {
    const s = await setup(), command = await s.command('direction'), before = structuredClone(s.store._state)
    s.store.authorize = async () => false
    await expect(s.service.runStep(auth, command)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(s.calls).toHaveLength(0); expect(s.store._state).toEqual(before)
  })
  it.each(['stale', 'missing-key', 'negative-revision', 'unauthorized', 'wrong-workspace', 'foreign', 'false-digest', 'corrupt-body', 'duplicate', 'bad-step', 'project-id', 'null-research-ref', 'false-research-ref'])('rejects %s before generation or writes', async attack => {
    const s = await setup(), input: any = await s.command('direction'); let actor = auth
    if (attack === 'stale') input.expected_revision++
    if (attack === 'missing-key') delete input.idempotency_key
    if (attack === 'negative-revision') input.expected_revision = -1
    if (attack === 'unauthorized') actor = { ...auth, scopes: [] }
    if (attack === 'wrong-workspace') input.workspace_id = 'different'
    if (attack === 'foreign') s.store._state.versions.get(s.seed('idea').version_id).workspace_id = 'other'
    if (attack === 'false-digest') input.context_ref.content_digest = `sha256:${'0'.repeat(64)}`
    if (attack === 'corrupt-body') s.store._state.versions.get(s.seed('idea').version_id).content.premise = 'tampered'
    if (attack === 'duplicate') input.input_refs = [input.context_ref, input.context_ref]
    if (attack === 'bad-step') input.step = 'usvds.03'
    if (attack === 'project-id') { const original = s.store.getProject.bind(s.store); s.store.getProject = async (id: string) => ({ ...await original(id), project_id: 'another' }) }
    if (attack === 'null-research-ref') input.research_ref = null
    if (attack === 'false-research-ref') input.research_ref = false
    const before = structuredClone(s.store._state)
    await expect(s.service.runStep(actor, input)).rejects.toMatchObject({ code: attack === 'stale' ? 'REVISION_CONFLICT' : attack === 'unauthorized' ? 'FORBIDDEN' : attack === 'project-id' ? 'NOT_FOUND' : 'VALIDATION_ERROR' })
    expect(s.calls).toHaveLength(0); expect(s.store._state).toEqual(before)
  })
  it('snapshots caller input before authorization and freezes the entire port request', async () => {
    const s = await setup({ generate: async (r: any, generate: any) => {
      expect(Object.isFrozen(r)).toBe(true); expect(Object.isFrozen(r.artifacts[0].content)).toBe(true)
      expect(r).not.toHaveProperty('project'); expect(r).not.toHaveProperty('step')
      return generate(r)
    } })
    const input = await s.command('direction'), original = structuredClone(input)
    s.store._authorize = async () => { input.context_ref.version_id = 'injected'; input.expected_revision = 200; return true }
    const e = await s.execute('direction', input)
    expect(e.run.status).toBe('succeeded'); expect(e.run.input_manifest.input_refs[0]).toEqual(original.context_ref)
    expect(contextOf(s.calls[0]).project_revision).toBe(original.expected_revision)
    expect(e.outputs[0].content.dependency_refs).toEqual(e.run.input_manifest.input_refs)
  })
  it.each(['generation', 'review'])('%s replay is payload-bound and reauthorized without any port calls', async mode => {
    const s = mode === 'review' ? await fullStory() : await setup(), step = mode === 'review' ? 'planning_review' : 'direction'
    const e = await s.execute(step), noCall = async () => { throw new Error('must replay') }
    const service = new StoryDevelopmentService(s.store, { ...s.configuration,
      generation: { ...s.configuration.generation, generate: noCall }, review: { ...s.configuration.review, review: async () => noCall() }, research: { resolve_snapshot: noCall } })
    const call = mode === 'review' ? service.planningReview.bind(service) : service.runStep.bind(service)
    expect(await call(auth, e.request)).toEqual(e.result)
    await expect(call(auth, { ...e.request, expected_revision: 999 })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    await expect(call({ ...auth, scopes: [] }, e.request)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
  it.each(['throws', 'timeout', 'wrong-role', 'approval'])('sanitizes and replays failed %s execution', async attack => {
    const s = await setup({ config: { timeout_ms: 20 }, generate: async (r: any, generate: any) => {
      if (attack === 'throws') throw new Error('secret provider detail')
      if (attack === 'timeout') return new Promise(() => {})
      const b = await generate(r)
      if (attack === 'wrong-role') b.proposals[0].kind = 'review_report'
      if (attack === 'approval') b.approval = { decision: 'approved' }
      return b
    } })
    const e = await s.execute('direction')
    failed(s, e, attack === 'throws' ? 'GENERATION_FAILED' : attack === 'timeout' ? 'PORT_TIMEOUT' : 'INVALID_GENERATION_OUTPUT')
    expect(await s.service.runStep(auth, e.request)).toEqual(e.result)
    expect(s.calls).toHaveLength(1); expect(JSON.stringify([...s.store._state.audit.values()])).not.toContain('secret')
  })
  it('publication rollback retains durable admission but no outputs when audit storage fails', async () => {
    const s = await setup(), command = await s.command('direction'), count = s.store._state.versions.size
    s.store.appendAudit = async () => { throw new Error('storage unavailable') }
    await expect(s.service.runStep(auth, command)).rejects.toThrow('storage unavailable')
    expect(s.store._state.versions.size).toBe(count)
    expect((await s.store.getProject(s.project.project_id)).revision).toBe(0)
    expect(s.store._state.runs.size).toBe(1); expect(s.store._state.idempotency.size).toBe(1)
    expect([...s.store._state.runs.values()][0].status).toBe('running')
  })
  it('concurrent identical requests replay one admission and invoke the writer once', async () => {
    let release: any, entered: any
    const ready = new Promise(resolve => { entered = resolve })
    const s = await setup({ generate: async (r: any, generate: any) => { entered(); await new Promise(resolve => { release = resolve }); return generate(r) } })
    const command = await s.command('direction'), first = s.service.runStep(auth, command)
    await ready
    const replay = await s.service.runStep(auth, command)
    expect((await s.store.getRun(replay.creative_run_id)).status).toBe('running')
    release(); expect(await first).toEqual(replay)
    expect(s.calls).toHaveLength(1); expect(s.store._state.runs.size).toBe(1)
  })
  it('competing contexts at one revision publish exactly one proposal', async () => {
    let release: any, entered: any
    const ready = new Promise(resolve => { entered = resolve }), gate = new Promise(resolve => { release = resolve })
    let count = 0
    const s = await setup({ generate: async (r: any, generate: any) => { if (++count === 2) entered(); await gate; return generate(r) } })
    const a = await s.command('direction'), b = await s.command('direction')
    const pending = Promise.all([s.execute('direction', a), s.execute('direction', b)])
    await ready; release(); const results = await pending
    expect(results.map(e => e.run.status).sort()).toEqual(['failed', 'succeeded'])
    expect(results.flatMap(e => e.outputs)).toHaveLength(1)
    expect((await s.store.getProject(s.project.project_id)).revision).toBe(1)
  })
  it('permits explicitly omitted direction research but not later steps', async () => {
    const s = await setup(), omitted = { status: 'omitted', reason: 'No market claims' }
    expect((await s.execute('direction', await s.command('direction', { research: omitted }))).run.status).toBe('succeeded')
    expect(s.researchCalls).toHaveLength(0)
    await expect(s.service.runStep(auth, await s.command('adaptation', { research: omitted }))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
  it.each(['wrong-kind', 'false-digest', 'substituted', 'unversioned', 'invalid-port-ref'])('rejects %s research response before model calls', async attack => {
    let selected: any
    const s = await setup({ research: async () => selected }); selected = structuredClone(s.seed('research'))
    if (attack === 'wrong-kind') selected.kind = 'story_bible'
    if (attack === 'false-digest') selected.content_digest = `sha256:${'0'.repeat(64)}`
    if (attack === 'substituted') selected.version_id = 'av_other'
    if (attack === 'unversioned') delete selected.content.schema_version
    if (attack === 'invalid-port-ref') selected = ref(selected)
    const command = await s.command('direction'), before = structuredClone(s.store._state)
    await expect(s.service.runStep(auth, command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(s.calls).toHaveLength(0); expect(s.store._state).toEqual(before)
  })
  describe.each(['generation', 'review'])('%s transitive source graph', mode => {
    it.each(['missing', 'foreign', 'corrupt'])('rejects %s before mutation', async attack => {
      const s = mode === 'review' ? await fullStory() : await setup(), step = mode === 'review' ? 'planning_review' : 'direction'
      const leaf = await s.put({ note: 'Imported source' }), parent = await s.put({ source_ref: ref(leaf) })
      const command = await s.command(step, { source_refs: [ref(parent)] })
      if (attack === 'missing') s.store._state.versions.delete(leaf.version_id)
      if (attack === 'foreign') s.store._state.versions.get(leaf.version_id).workspace_id = 'foreign'
      if (attack === 'corrupt') s.store._state.versions.get(leaf.version_id).content = 'tampered'
      const before = structuredClone(s.store._state), count = s.calls.length
      await expect(step === 'planning_review' ? s.service.planningReview(auth, command) : s.service.runStep(auth, command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
      expect(s.calls).toHaveLength(count); expect(s.reviewCalls).toHaveLength(0); expect(s.store._state).toEqual(before)
    })
    it('freezes transitive bytes without flattening the direct manifest', async () => {
      const s = mode === 'review' ? await fullStory() : await setup(), step = mode === 'review' ? 'planning_review' : 'direction'
      const leaf = await s.put({ note: 'Imported source' }), parent = await s.put({ source_ref: ref(leaf) })
      // These two newly imported versions are trusted explicitly by this test,
      // not by the shared fixture helper or a content-kind wildcard.
      const service = new StoryDevelopmentService(s.store, { ...s.configuration, authorship: {
        attest: async (request: any, signal: AbortSignal) => {
          const selected = [leaf, parent].find(v => canonicalHash(ref(v)) === canonicalHash(ref(request.artifact)))
          return selected ? { artifact_ref: ref(selected), author_identities: ['fixture-source-author'] }
            : s.configuration.authorship.attest(request, signal)
        },
      } })
      const command = await s.command(step, { source_refs: [ref(parent)] })
      const result = await (mode === 'review' ? service.planningReview(auth, command) : service.runStep(auth, command))
      const e = { run: await s.store.getRun(result.creative_run_id) }
      expect(e.run.status).toBe('succeeded')
      const request = (mode === 'review' ? s.reviewCalls : s.calls).at(-1)
      expect(request.artifacts.map(ref)).toContainEqual(ref(leaf))
      expect(e.run.input_manifest.input_refs).toContainEqual(ref(parent))
      expect(e.run.input_manifest.input_refs).not.toContainEqual(ref(leaf))
      expect(e.run.input_manifest_digest).toBe(canonicalHash(e.run.input_manifest))
    })
  })
  describe.each(['generation', 'review'])('frozen planning range for %s', mode => {
    it.each(['reordered', 'missing', 'extra', 'wrong-kind'])('rejects %s definition before ports or mutation', async attack => {
      const s = mode === 'review' ? await fullStory() : await setup()
      const range = structuredClone(s.seed('range')), ids = [...s.project.planning_range.ordered_episode_ids]
      range.content.ordered_episode_ids = attack === 'reordered' ? ids.reverse() : attack === 'missing' ? ids.slice(0, -1) : attack === 'extra' ? [...ids, 'ep_extra'] : ids
      const forged = await s.put(range.content, attack === 'wrong-kind' ? 'other_drama' : 'planning_range')
      const project = await s.store.getProject(s.project.project_id)
      await s.store.compareAndSetProject(project.project_id, project.revision, { planning_range: { ...project.planning_range, definition_ref: ref(forged) } })
      const step = mode === 'review' ? 'planning_review' : 'direction', command = await s.command(step)
      const before = structuredClone(s.store._state), count = s.calls.length, researchCount = s.researchCalls.length
      await expect(mode === 'review' ? s.service.planningReview(auth, command) : s.service.runStep(auth, command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
      expect(s.calls).toHaveLength(count); expect(s.reviewCalls).toHaveLength(0)
      expect(s.researchCalls).toHaveLength(researchCount); expect(s.store._state).toEqual(before)
    })
  })
  it('freezes exact episode set members through ordinary source traversal', async () => {
    const s = await fullStory(), set = await s.store.getArtifactVersion(s.byRole.episode_outline_set.version_id)
    const members = set.content.ordered_episodes.map((e: any) => e.outline_ref)
    expect(set.content.dependency_refs).toEqual(expect.arrayContaining(members))
    const e = await s.execute('direction', await s.command('direction', { source_refs: [ref(set)] }))
    expect(e.run.status).toBe('succeeded')
    expect(s.calls.at(-1).artifacts.map(ref)).toEqual(expect.arrayContaining(members))
    expect(e.run.input_manifest.input_refs).toContainEqual(ref(set))
    for (const member of members) expect(e.run.input_manifest.input_refs).not.toContainEqual(member)
  })
  it.each(['missing', 'corrupt', 'omitted-member-ref'])('rejects %s set member before model calls or mutation', async attack => {
    const s = await fullStory()
    let set = await s.store.getArtifactVersion(s.byRole.episode_outline_set.version_id)
    const member = set.content.ordered_episodes[0].outline_ref
    if (attack === 'missing') s.store._state.versions.delete(member.version_id)
    if (attack === 'corrupt') s.store._state.versions.get(member.version_id).content = 'tampered member'
    if (attack === 'omitted-member-ref') {
      set.content.dependency_refs = set.content.dependency_refs.filter((r: any) => r.version_id !== member.version_id)
      set = seal(set); s.store._state.versions.set(set.version_id, set)
    }
    const command = await s.command('direction', { source_refs: [ref(set)] })
    const before = structuredClone(s.store._state), count = s.calls.length
    await expect(s.service.runStep(auth, command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR',
      message: attack === 'missing' ? 'unresolved or foreign artifact reference' : attack === 'corrupt' ? 'stored content digest mismatch' : 'invalid exact output dependencies' })
    expect(s.calls).toHaveLength(count); expect(s.reviewCalls).toHaveLength(0); expect(s.store._state).toEqual(before)
  })
  it.each(['adaptation', 'bible', 'master_outline'])('rejects missing %s bindings before model calls', async step => {
    const s = await setup(), command = await s.command(step, { bindings: { idea: s.byRole.idea } })
    await expect(s.service.runStep(auth, command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(s.calls).toHaveLength(0)
  })
  it('prevents a historical writer reviewing its own subjects after reconfiguration', async () => {
    const s = await fullStory(), command = await s.command('planning_review', { executor: { role: 'reviewer', executor_id: 'writer_a', configuration_ref: s.configuration.review.configuration_ref } })
    const service = new StoryDevelopmentService(s.store, { ...s.configuration, generation: { ...s.configuration.generation, identity: 'new_writer' }, review: { ...s.configuration.review, identity: 'writer_a' } })
    await expect(service.planningReview(auth, command)).rejects.toMatchObject({ code: 'ROLE_SEPARATION' })
    expect(s.reviewCalls).toHaveLength(0)
  })
  it.each(['missing', 'duplicate', 'reordered', 'extra'])('rejects %s generated episode coverage atomically', async attack => {
    const s = await setup({ generate: async (r: any, generate: any) => {
      const b = await generate(r)
      if (contextOf(r).operation === 'episode_outlines') {
        if (attack === 'missing') b.proposals.pop()
        if (attack === 'duplicate') b.proposals[1] = b.proposals[0]
        if (attack === 'reordered') b.proposals.reverse()
        if (attack === 'extra') b.proposals.push(b.proposals[0])
      }
      return b
    } })
    for (const step of steps.slice(0, -1)) expect((await s.execute(step)).run.status).toBe('succeeded')
    failed(s, await s.execute('episode_outlines'), 'INVALID_GENERATION_OUTPUT')
    expect([...s.store._state.versions.values()].filter((v: any) => v.kind === 'episode_outline')).toEqual([])
  })
  it.each(['partial', 'false-pass', 'hidden-blocker', 'blocked-without-blocker', 'unbound-finding', 'approval'])('rejects resealed invalid review evidence: %s', async attack => {
    const s = await fullStory({ review: async (r: any, review: any) => {
      const b = await review(r), c = b.proposals[0].content
      const finding = { finding_id: 'cause', code: 'causality', remediation: 'Connect cause and consequence', message: 'Missing consequence', severity: 'blocker', subject_refs: [c.subject_refs[0]] }
      if (attack === 'partial') c.subject_refs.shift()
      if (attack === 'false-pass') { c.findings = [finding]; c.blockers = ['cause'] }
      if (attack === 'hidden-blocker') { c.outcome = 'BLOCKED'; c.findings = [finding] }
      if (attack === 'blocked-without-blocker') c.outcome = 'BLOCKED'
      if (attack === 'unbound-finding') c.findings = [{ ...finding, severity: 'warning', subject_refs: [{ ...c.subject_refs[0], version_id: 'av_unreviewed' }] }]
      if (attack === 'approval') c.approval = { decision: 'approved' }
      b.proposals = b.proposals.map(seal); return b
    } })
    failed(s, await s.execute('planning_review'), 'INVALID_REVIEW_OUTPUT')
  })
  it.each(['PASS', 'FAIL', 'BLOCKED'])('persists %s as independent evidence; only P1 may approve', async outcome => {
    const s = await fullStory({ review: async (r: any, review: any) => {
      const b = await review(r), c = b.proposals[0].content
      c.outcome = outcome
      if (outcome !== 'PASS') { c.blockers = ['cause']; c.findings = [{ finding_id: 'cause', code: 'causality', remediation: 'Connect cause and consequence', message: 'Missing consequence', severity: 'blocker', subject_refs: [c.subject_refs[0]] }] }
      b.proposals = b.proposals.map(seal); return b
    } })
    const e = await s.execute('planning_review')
    expect(e.run.status).toBe('succeeded'); expect(e.outputs[0].content.outcome).toBe(outcome)
    expect(e.outputs[0].content.reviewed_writer_ids).toEqual(['writer_a'])
    expect(await s.service.planningReview(auth, e.request)).toEqual(e.result)
    expect(s.reviewCalls).toHaveLength(1); expect(s.store._state.approvals.size).toBe(0)
    const input = await approvalInput(s, e), approval = createDramaApplication(s.store).approvePlanningBaseline({ ...auth, scopes: ['story.approve'] }, input)
    if (outcome === 'PASS') { expect((await approval).baseline.manifest).toEqual(input.baseline.manifest); expect(s.store._state.approvals.size).toBe(1) }
    else { await expect(approval).rejects.toMatchObject({ code: 'BASELINE_INCOMPLETE' }); expect(s.store._state.approvals.size).toBe(0) }
  })
})