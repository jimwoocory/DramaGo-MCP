import { describe, it, expect } from 'vitest'
import { InMemoryDramaRepository, JournalDramaRepository } from '../../packages/dramago-persistence/index.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalHash, createDramaApplication } from '../../packages/dramago-application/index.js'
import { StoryDevelopmentService } from '../../packages/story-development/src/index.js'

const auth = { tenantId: 'tenant', subjectId: 'author', clientId: 'test', scopes: ['story.execute', 'story.review'] }
const ref = (v: any) => ({ artifact_id: v.artifact_id, version_id: v.version_id, content_digest: v.content_digest })
async function setup(options: any = {}) {
  const actions: string[] = []
  const store = options.store ?? new InMemoryDramaRepository({ tenantId: 'tenant', authorize: (_: any, action: string) => { actions.push(action); return true } })
  const artifact = async (id: string, kind: string, content: any, extra = {}) => {
    const v = { schema_version: 'dramago.artifact-version/v1', project_id: 'project', workspace_id: 'ws', artifact_id: `art_${id}`, version_id: `av_${id}`, content_digest: canonicalHash(content), kind, content, created_at: '2026-01-01T00:00:00Z', ...extra }
    await store.putArtifactVersion(v)
    return v
  }
  await store.createProject({ schema_version: 'dramago.drama-project/v1', project_id: 'project', workspace_id: 'ws', name: 'Story', revision: 0, planning_range: { range_id: 'season1', ordered_episode_ids: ['EP01', 'EP02'] }, created_at: '2026-01-01T00:00:00Z' })
  const range = await artifact('range', 'planning_range', { ordered_episode_ids: ['EP01', 'EP02'] })
  await store.compareAndSetProject('project', 0, { planning_range: { range_id: 'season1', ordered_episode_ids: ['EP01', 'EP02'], definition_ref: ref(range) } })
  const idea = await artifact('idea', 'other_drama', 'A delivery driver discovers a secret.')
  const research = await artifact('research', 'other_drama', { schema_version: 'dramago.research-snapshot/v1', snapshot_version: 'synthetic/v1', captured_at: '2026-01-01T00:00:00Z', sources: [{ uri: 'urn:test:market', retrieved_at: '2026-01-01T00:00:00Z' }], evidence: { note: 'Synthetic test evidence, not current market data' } })
  const calls: any[] = []
  const generation = options.generation ?? { identity: 'writer', generate: async (request: any) => { calls.push(request); return { proposals: [{ role: 'direction', data: { premise: 'Trust has a cost.' } }] } } }
  const review = options.review ?? { identity: 'reviewer', review: async () => { throw new Error('not expected') } }
  const researchPort = options.research ?? { resolve: async () => ref(research) }
  const service = new StoryDevelopmentService(store, { generation, review, research: researchPort, ...options.config })
  const command = { project_id: 'project', workspace_id: 'ws', expected_revision: 1, idempotency_key: 'direction-1', step: 'direction', input_refs: [ref(idea)] }
  return { store, service, command, actions, artifact, idea, range, research, calls }
}

const generateAll = async (r: any) => ({ proposals: r.step === 'episode_outlines'
  ? r.project.planning_range.ordered_episode_ids.map((episode_id: string) => ({ role: 'episode_outline', episode_id, data: { causal_outline: `Consequences in ${episode_id}` } }))
  : (r.step === 'bible' ? ['story_foundation', 'story_bible'] : [r.step]).map(role => ({ role, data: { text: `Synthetic ${role}` } })) })
async function advance(s: any, step: string, input_refs: any[]) {
  return s.service.runStep(auth, { ...s.command, step, input_refs, expected_revision: (await s.store.getProject('project')).revision, idempotency_key: `step-${step}` })
}
async function fullStory(options: any = {}) {
  const s = await setup({ generation: { identity: 'writer', generate: generateAll }, ...options })
  let refs = [ref(s.idea)]
  const byRole: any = {}
  for (const step of ['direction', 'adaptation', 'bible', 'master_outline', 'season_architecture', 'episode_outlines']) {
    const result = await advance(s, step, refs)
    expect(result.status).toBe('succeeded')
    for (const r of result.output_refs) {
      const v = await s.store.getArtifactVersion(r.version_id)
      byRole[v.episode_id ?? v.content.artifact_role] = r
    }
    refs = [...refs, ...result.output_refs]
  }
  return { ...s, byRole }
}

const passReview = async (request: any) => ({ outcome: 'PASS', subject_refs: request.subject_refs, context_refs: request.context_refs, findings: [], blockers: [] })
async function reviewCommand(s: any) {
  return { project_id: 'project', workspace_id: 'ws', expected_revision: (await s.store.getProject('project')).revision, idempotency_key: 'review-1', planning_scope: {
    direction_ref: s.byRole.direction, story_foundation: s.byRole.story_foundation, story_bible: s.byRole.story_bible,
    master_outline: s.byRole.master_outline, season_architecture: s.byRole.season_architecture,
    episode_outline_set_ref: s.byRole.episode_outline_set,
    ordered_episodes: ['EP01', 'EP02'].map(episode_id => ({ episode_id, outline_ref: s.byRole[episode_id] })),
  } }
}
async function approvalInput(s: any, command: any, result: any) {
  const report = await s.store.getArtifactVersion(result.output_refs[0].version_id)
  const policy_version = 'planning-baseline/v1'
  const authorization = await s.artifact('authority', 'authorization_evidence', { actor_id: 'author', policy_version })
  const manifest = { schema_version: 'dramago.planning-manifest/v1', workspace_id: 'ws', project_id: 'project', range_id: 'season1', range_definition_ref: ref(s.range),
    ...Object.fromEntries(['story_foundation', 'story_bible', 'master_outline', 'season_architecture', 'ordered_episodes'].map(k => [k, command.planning_scope[k]])),
    review_evidence: [{ evidence_ref: ref(report), subject_refs: report.content.subject_refs, outcome: report.content.outcome }], policy_version }
  const baseline: any = { schema_version: 'dramago.planning-baseline/v1', artifact_id: 'art_baseline', version_id: 'av_baseline', planning_baseline_id: 'pb_story', manifest, content_digest: canonicalHash(manifest), created_at: '2026-01-01T00:00:00Z' }
  const body = { schema_version: 'dramago.approval-decision/v1', approval_id: 'approve-story', project_id: 'project', workspace_id: 'ws', decision: 'approved', target_refs: [ref(baseline)], evidence_refs: [ref(report)], actor: { actor_type: 'human', actor_id: 'author', authorization_ref: ref(authorization) }, policy_version, decided_at: '2026-01-01T00:00:00Z' }
  const approval = { ...body, artifact_id: 'art_approval', version_id: 'av_approval', content_digest: canonicalHash(body) }
  baseline.approval_refs = [ref(approval)]
  return { project_id: 'project', workspace_id: 'ws', expected_revision: result.project_revision, idempotency_key: 'approval-1', baseline, approval }
}

describe('P2 Story runtime', () => {
  it('recovers a committed review, frozen inputs and replay after journal reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dramago-p2-'))
    const options = { tenantId: 'tenant', directory, authorize: () => true }
    let store = new JournalDramaRepository(options)
    try {
      const s = await fullStory({ store, review: { identity: 'reviewer', review: passReview } })
      const command = await reviewCommand(s)
      const result = await s.service.planningReview(auth, command)
      const saved = await store.getRun(result.creative_run_id)
      await store.close()
      store = new JournalDramaRepository(options)
      const noCall = async () => { throw new Error('ports must not run on replay') }
      const service = new StoryDevelopmentService(store, { generation: { identity: 'writer', generate: noCall }, review: { identity: 'reviewer', review: async () => noCall() }, research: { resolve: noCall } })
      expect(await service.planningReview(auth, command)).toEqual(result)
      expect(await store.getRun(result.creative_run_id)).toEqual(saved)
      for (const r of [...saved.input_manifest.input_refs, ...result.output_refs]) {
        const v = await store.getArtifactVersion(r.version_id)
        expect(ref(v)).toEqual(r)
        expect(canonicalHash(v.content)).toBe(r.content_digest)
      }
      expect(store._state.approvals.size).toBe(0)
      expect(store._state.runs.size).toBe(7)
    } finally { await store.close(); rmSync(directory, { recursive: true, force: true }) }
  })

  it('a late writer result after timeout cannot publish artifacts', async () => {
    let finish: any
    let signal: AbortSignal | undefined
    const s = await setup({ config: { timeout_ms: 10 }, generation: { identity: 'writer', generate: async (_: any, abort: AbortSignal) => {
      signal = abort
      return new Promise(resolve => { finish = resolve })
    } } })
    const result = await s.service.runStep(auth, s.command)
    expect(result.error_code).toBe('PORT_TIMEOUT')
    expect(signal?.aborted).toBe(true)
    const before = s.store._state.versions.size
    finish({ proposals: [{ role: 'direction', data: 'too late' }] })
    await new Promise(resolve => setImmediate(resolve))
    expect(s.store._state.versions.size).toBe(before)
    expect((await s.store.getRun(result.creative_run_id)).status).toBe('failed')
  })

  it('outputs cannot be overwritten and a new command creates new proposal versions', async () => {
    const s = await setup()
    const first = await s.service.runStep(auth, s.command)
    const original = await s.store.getArtifactVersion(first.output_refs[0].version_id)
    const next = await s.service.runStep(auth, { ...s.command, expected_revision: first.project_revision, idempotency_key: 'new-direction' })
    expect(next.output_refs[0].version_id).not.toBe(original.version_id)
    await expect(s.store.putArtifactVersion({ ...original, content: 'silently changed' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(await s.store.getArtifactVersion(original.version_id)).toEqual(original)
  })

  it('does not let caller fields switch the execute/review authorization class', async () => {
    const s = await fullStory({ review: { identity: 'reviewer', review: passReview } })
    const review = await reviewCommand(s)
    await expect(s.service.runStep({ ...auth, scopes: ['story.review'] }, { ...s.command, ...review } as any)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(s.service.planningReview({ ...auth, scopes: ['story.execute'] }, s.command as any)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it.each(['project-id', 'null-research-ref', 'false-research-ref'])('rejects invalid ownership or explicit research input: %s', async (attack) => {
    const s = await setup()
    const before = structuredClone(s.store._state)
    const input: any = { ...s.command }
    if (attack === 'project-id') {
      const getProject = s.store.getProject.bind(s.store)
      s.store.getProject = async (id: string) => ({ ...await getProject(id), project_id: 'another-project' })
    }
    if (attack === 'null-research-ref') input.research_ref = null
    if (attack === 'false-research-ref') input.research_ref = false
    await expect(s.service.runStep(auth, input)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(s.calls).toHaveLength(0)
    expect(s.store._state).toEqual(before)
  })

  it('fails closed when a permissive repository returns false authorization', async () => {
    const s = await setup()
    s.store.authorize = async () => false
    await expect(s.service.runStep(auth, s.command)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(s.calls).toHaveLength(0)
  })

  it('freezes all project values exposed to the writer in the fixed manifest', async () => {
    const s = await setup()
    const result = await s.service.runStep(auth, s.command)
    const run = await s.store.getRun(result.creative_run_id)
    const context = await s.store.getArtifactVersion(run.input_manifest.input_refs.at(-1).version_id)
    expect(context.content.project).toEqual(s.calls[0].project)
    expect(context.content.project.name).toBe('Story')
  })

  it('rejects a review mixing exact but causally inconsistent story versions', async () => {
    const s = await fullStory({ review: { identity: 'reviewer', review: passReview } })
    const alternative = await s.artifact('alternative-foundation', 'story_foundation', { text: 'Another foundation' })
    const c = await reviewCommand(s)
    c.planning_scope.story_foundation = ref(alternative)
    await expect(s.service.planningReview(auth, c)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('resolves and verifies transitive dependencies before running review', async () => {
    const s = await fullStory({ review: { identity: 'reviewer', review: passReview } })
    s.store._state.versions.get(s.idea.version_id).content = 'tampered upstream idea'
    await expect(s.service.planningReview(auth, await reviewCommand(s))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  describe.each(['generation', 'review'])('newly selected research for %s', (mode) => {
    it.each(['missing', 'foreign', 'corrupt'])('rejects a %s dependency before model calls or mutation', async (attack) => {
      const s = mode === 'review' ? await fullStory() : await setup()
      if (attack === 'foreign') await s.store.createProject({ project_id: 'foreign', workspace_id: 'ws', revision: 0 })
      const dependency = await s.artifact('research-dependency', 'other_drama', { note: 'Research source' }, attack === 'foreign' ? { project_id: 'foreign' } : {})
      const selected = await s.artifact('selected-research', 'other_drama', { ...s.research.content, dependency_refs: [ref(dependency)] })
      if (attack === 'missing') s.store._state.versions.delete(dependency.version_id)
      if (attack === 'corrupt') s.store._state.versions.get(dependency.version_id).content = 'tampered research source'
      const calls: string[] = []
      const service = new StoryDevelopmentService(s.store, {
        generation: { identity: 'writer', generate: async (r: any) => { calls.push('generation'); return generateAll(r) } },
        review: { identity: 'reviewer', review: async (r: any) => { calls.push('review'); return passReview(r) } },
        research: { resolve: async () => ref(selected) },
      })
      const command = mode === 'review' ? await reviewCommand(s) : s.command
      const before = structuredClone(s.store._state)
      const result = mode === 'review' ? service.planningReview(auth, command) : service.runStep(auth, command)
      await expect(result).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: attack === 'corrupt' ? 'stored content digest mismatch' : 'unresolved or foreign artifact reference' })
      expect(calls).toEqual([])
      expect(s.store._state).toEqual(before)
    })

    it('appends exact transitive dependencies while preserving existing manifest order', async () => {
      const s = mode === 'review' ? await fullStory() : await setup()
      let selected = ref(s.research)
      const requests: any[] = []
      const service = new StoryDevelopmentService(s.store, {
        generation: { identity: 'writer', generate: async (r: any) => { requests.push(r); return generateAll(r) } },
        review: { identity: 'reviewer', review: async (r: any) => { requests.push(r); return passReview(r) } },
        research: { resolve: async () => selected },
      })
      const command = mode === 'review' ? await reviewCommand(s) : s.command
      const first = mode === 'review' ? await service.planningReview(auth, command) : await service.runStep(auth, command)
      expect(first.status).toBe('succeeded')
      const previous = (await s.store.getRun(first.creative_run_id)).input_manifest.input_refs.slice(0, -1)
      const leaf = await s.artifact('research-leaf', 'other_drama', { note: 'Original research source' })
      const dependency = await s.artifact('research-dependency', 'other_drama', { dependency_refs: [ref(leaf)] })
      selected = ref(await s.artifact('selected-research', 'other_drama', { ...s.research.content, dependency_refs: [ref(dependency)] }))
      const next = { ...command, expected_revision: first.project_revision, idempotency_key: 'new-research' }
      const result = mode === 'review' ? await service.planningReview(auth, next) : await service.runStep(auth, next)
      expect(result.status).toBe('succeeded')
      const run = await s.store.getRun(result.creative_run_id)
      const existing = mode === 'review' ? previous : previous.filter((r: any) => r.version_id !== s.research.version_id)
      expect(run.input_manifest.input_refs.slice(0, -1)).toEqual([...existing, selected, ref(dependency), ref(leaf)])
      expect(requests[1].inputs.map(ref)).toEqual(run.input_manifest.input_refs)
      expect(run.input_manifest_digest).toBe(canonicalHash(run.input_manifest))
      const context = requests[1].inputs.at(-1)
      expect(context.content.schema_version).toBe('dramago.story-run-context/v1')
      expect(context.content.research_ref).toEqual(selected)
      const output = await s.store.getArtifactVersion(result.output_refs[0].version_id)
      expect(output.content.dependency_refs).toEqual(run.input_manifest.input_refs)
    })
  })

  it.each(['snapshot', 'dependency'])('rejects reviewer-authored newly selected research %s before model calls or mutation', async (authored) => {
    const s = await fullStory()
    const dependency = await s.artifact('research-dependency', 'other_drama', { note: 'Research source', generated_by: authored === 'dependency' ? 'reviewer' : 'researcher' })
    const selected = await s.artifact('selected-research', 'other_drama', {
      ...s.research.content, generated_by: authored === 'snapshot' ? 'reviewer' : 'researcher', dependency_refs: [ref(dependency)],
    })
    const calls: string[] = []
    const service = new StoryDevelopmentService(s.store, {
      generation: { identity: 'writer', generate: async (r: any) => { calls.push('generation'); return generateAll(r) } },
      review: { identity: 'reviewer', review: async (r: any) => { calls.push('review'); return passReview(r) } },
      research: { resolve: async () => ref(selected) },
    })
    const command = await reviewCommand(s)
    const before = structuredClone(s.store._state)
    await expect(service.planningReview(auth, command)).rejects.toMatchObject({ code: 'ROLE_SEPARATION' })
    expect(calls).toEqual([])
    expect(s.store._state).toEqual(before)
  })

  it('prevents a historical writer reviewing its own subjects after service reconfiguration', async () => {
    const s = await fullStory()
    const service = new StoryDevelopmentService(s.store, { generation: { identity: 'new-writer', generate: generateAll }, review: { identity: 'writer', review: passReview }, research: { resolve: async () => ref(s.research) } })
    await expect(service.planningReview(auth, await reviewCommand(s))).rejects.toMatchObject({ code: 'ROLE_SEPARATION' })
  })

  it('review replay is payload-bound and reauthorized, including when research is now absent', async () => {
    const s = await fullStory({ review: { identity: 'reviewer', review: passReview } })
    const command = await reviewCommand(s)
    const first = await s.service.planningReview(auth, command)
    const service = new StoryDevelopmentService(s.store, { generation: { identity: 'writer', generate: generateAll }, review: { identity: 'reviewer', review: async () => { throw new Error('must replay') } }, research: { resolve: async () => null } })
    expect(await service.planningReview(auth, command)).toEqual(first)
    await expect(service.planningReview(auth, { ...command, expected_revision: first.project_revision })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    await expect(service.planningReview({ ...auth, scopes: [] }, command)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(service.planningReview(auth, { ...command, expected_revision: first.project_revision, idempotency_key: 'new-review' })).rejects.toMatchObject({ code: 'RESEARCH_REQUIRED' })
  })

  it('rolls back artifacts, run, replay and revision when audit persistence fails', async () => {
    const s = await setup()
    const count = s.store._state.versions.size
    s.store.appendAudit = async () => { throw new Error('storage unavailable') }
    await expect(s.service.runStep(auth, s.command)).rejects.toThrow('storage unavailable')
    expect(s.store._state.runs.size).toBe(0)
    expect(s.store._state.idempotency.size).toBe(0)
    expect(s.store._state.versions.size).toBe(count)
    expect((await s.store.getProject('project')).revision).toBe(1)
  })

  it('concurrent identical calls commit one run; different keys at the same revision have one winner', async () => {
    const s = await setup()
    const [a, b] = await Promise.all([s.service.runStep(auth, s.command), s.service.runStep(auth, s.command)])
    expect(a).toEqual(b)
    expect(s.calls).toHaveLength(1)
    const outcomes = await Promise.allSettled(['next-a', 'next-b'].map(idempotency_key => s.service.runStep(auth, { ...s.command, expected_revision: 2, idempotency_key })))
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'REVISION_CONFLICT' } })
    expect(s.store._state.runs.size).toBe(2)
    expect(s.store._state.audit.size).toBe(2)
  })

  it('independently reviews the complete scope, persists exact evidence, and leaves approval solely to P1', async () => {
    const requests: any[] = []
    const s = await fullStory({ review: { identity: 'reviewer', review: async (r: any) => { requests.push(r); return passReview(r) } } })
    const command = await reviewCommand(s)
    const result = await s.service.planningReview(auth, command)
    expect(result.status).toBe('succeeded')
    const report = await s.store.getArtifactVersion(result.output_refs[0].version_id)
    expect(report.kind).toBe('review_report')
    expect(report.content).toMatchObject({ review_kind: 'planning', outcome: 'PASS', findings: [], blockers: [], generated_by: 'reviewer' })
    expect(result).not.toHaveProperty('error_code')
    expect(result.output_refs).toHaveLength(1)
    expect(report.content_digest).toBe(canonicalHash(report.content))
    const run = await s.store.getRun(result.creative_run_id)
    expect(run.status).toBe('succeeded')
    expect(run.steps[0].attempts).toEqual([{ attempt: 1, status: 'succeeded', input_manifest_digest: run.input_manifest_digest, output_refs: result.output_refs }])
    expect(report.content.subject_refs).toEqual([ref(s.range), s.byRole.story_foundation, s.byRole.story_bible, s.byRole.master_outline, s.byRole.season_architecture, s.byRole.EP01, s.byRole.EP02])
    expect(report.content.context_refs).toEqual([s.byRole.direction, s.byRole.episode_outline_set, ref(s.research)])
    expect(requests[0].inputs.map(ref)).toEqual((await s.store.getRun(result.creative_run_id)).input_manifest.input_refs)
    expect(await s.service.planningReview(auth, command)).toEqual(result)
    expect(requests).toHaveLength(1)
    expect(s.actions.at(-1)).toBe('story.review')
    expect(s.store._state.approvals.size).toBe(0)
    expect(s.store._state.baselines.size).toBe(0)
    const approval = await approvalInput(s, command, result)
    const published = await createDramaApplication(s.store).approvePlanningBaseline({ ...auth, scopes: ['story.approve'] }, approval)
    expect(published.baseline.manifest).toEqual(approval.baseline.manifest)
    expect(s.store._state.approvals.size).toBe(1)
  })

  it.each(['same-identity', 'same-object', 'same-function'])('refuses writer/reviewer role reuse: %s', async (mode) => {
    const shared = async () => ({ proposals: [] })
    const both = { identity: 'writer', generate: shared, review: shared }
    await expect(setup({ generation: both, review: mode === 'same-object' ? both : { identity: mode === 'same-identity' ? 'writer' : 'reviewer', review: mode === 'same-function' ? shared : passReview } })).rejects.toMatchObject({ code: 'ROLE_SEPARATION' })
  })

  it.each(['missing-episode', 'duplicate-episode', 'reordered', 'wrong-outline', 'missing-foundation', 'false-digest', 'unauthorized', 'stale'])('rejects incomplete or invalid review scope: %s', async (attack) => {
    let calls = 0
    const s = await fullStory({ review: { identity: 'reviewer', review: async (r: any) => { calls++; return passReview(r) } } })
    const c: any = await reviewCommand(s)
    let actor = auth
    if (attack === 'missing-episode') c.planning_scope.ordered_episodes.pop()
    if (attack === 'duplicate-episode') c.planning_scope.ordered_episodes[1] = c.planning_scope.ordered_episodes[0]
    if (attack === 'reordered') c.planning_scope.ordered_episodes.reverse()
    if (attack === 'wrong-outline') c.planning_scope.ordered_episodes[1].outline_ref = s.byRole.EP01
    if (attack === 'missing-foundation') delete c.planning_scope.story_foundation
    if (attack === 'false-digest') c.planning_scope.master_outline.content_digest = `sha256:${'0'.repeat(64)}`
    if (attack === 'unauthorized') actor = { ...auth, scopes: ['story.execute'] }
    if (attack === 'stale') c.expected_revision--
    await expect(s.service.planningReview(actor, c)).rejects.toMatchObject({ code: attack === 'unauthorized' ? 'FORBIDDEN' : attack === 'stale' ? 'REVISION_CONFLICT' : 'VALIDATION_ERROR' })
    expect(calls).toBe(0)
    expect(s.store._state.runs.size).toBe(6)
  })

  it.each(['partial', 'false-pass', 'hidden-blocker', 'blocked-without-blocker', 'unbound-finding', 'approval'])('rejects invalid reviewer evidence: %s', async (attack) => {
    const s = await fullStory({ review: { identity: 'reviewer', review: async (r: any) => {
      const result: any = await passReview(r)
      if (attack === 'partial') result.subject_refs = result.subject_refs.slice(1)
      if (attack === 'false-pass') { result.blockers = ['CAUSE']; result.findings = [{ code: 'CAUSE', message: 'Broken causal chain', severity: 'blocker', subject_refs: [r.subject_refs[0]] }] }
      if (attack === 'hidden-blocker') { result.outcome = 'BLOCKED'; result.findings = [{ code: 'CAUSE', message: 'Broken causal chain', severity: 'blocker', subject_refs: [r.subject_refs[0]] }] }
      if (attack === 'blocked-without-blocker') result.outcome = 'BLOCKED'
      if (attack === 'unbound-finding') result.findings = [{ code: 'X', message: 'x', severity: 'warning', subject_refs: [{ ...r.subject_refs[0], version_id: 'unreviewed' }] }]
      if (attack === 'approval') result.approval = { decision: 'approved' }
      return result
    } } })
    const result = await s.service.planningReview(auth, await reviewCommand(s))
    expect(result).toMatchObject({ status: 'failed', error_code: 'INVALID_REVIEW_OUTPUT', output_refs: [] })
    const run = await s.store.getRun(result.creative_run_id)
    expect(run.status).toBe('failed')
    expect(run.steps[0].attempts).toEqual([{ attempt: 1, status: 'failed', input_manifest_digest: run.input_manifest_digest, output_refs: [] }])
    expect([...s.store._state.versions.values()].filter((v: any) => v.kind === 'review_report')).toEqual([])
    expect(s.store._state.approvals.size).toBe(0)
  })

  it.each(['FAIL', 'BLOCKED'])('persists %s and blockers as evidence, which P1 refuses to approve', async (outcome) => {
    const s = await fullStory({ review: { identity: 'reviewer', review: async (r: any) => ({ ...await passReview(r), outcome, blockers: ['CAUSE'], findings: [{ code: 'CAUSE', severity: 'blocker', message: 'Missing consequence', subject_refs: [r.subject_refs[3]] }] }) } })
    const command = await reviewCommand(s)
    const result = await s.service.planningReview(auth, command)
    expect(result.status).toBe('succeeded')
    const report = await s.store.getArtifactVersion(result.output_refs[0].version_id)
    expect(result).not.toHaveProperty('error_code')
    expect(result.output_refs).toHaveLength(1)
    expect(report.kind).toBe('review_report')
    expect(report.content.blockers).toEqual(['CAUSE'])
    expect(report.content.outcome).toBe(outcome)
    expect(report.content.findings).toEqual([{ code: 'CAUSE', severity: 'blocker', message: 'Missing consequence', subject_refs: [s.byRole.master_outline] }])
    expect(report.content_digest).toBe(canonicalHash(report.content))
    const run = await s.store.getRun(result.creative_run_id)
    expect(run.status).toBe('succeeded')
    expect(run.steps[0].attempts).toEqual([{ attempt: 1, status: 'succeeded', input_manifest_digest: run.input_manifest_digest, output_refs: result.output_refs }])
    expect(await s.service.planningReview(auth, command)).toEqual(result)
    const input = await approvalInput(s, command, result)
    await expect(createDramaApplication(s.store).approvePlanningBaseline({ ...auth, scopes: ['story.approve'] }, input)).rejects.toMatchObject({ code: 'BASELINE_INCOMPLETE' })
    expect(s.store._state.approvals.size).toBe(0)
  })

  it('runs all six steps with role-specific immutable versions and an exact episode set', async () => {
    const s = await fullStory()
    expect(s.store._state.runs.size).toBe(6)
    const set = await s.store.getArtifactVersion(s.byRole.episode_outline_set.version_id)
    expect(set.content.ordered_episodes).toEqual(['EP01', 'EP02'].map(episode_id => ({ episode_id, outline_ref: s.byRole[episode_id] })))
    for (const role of ['story_foundation', 'story_bible', 'master_outline', 'season_architecture']) {
      const v = await s.store.getArtifactVersion(s.byRole[role].version_id)
      expect(v.kind).toBe(role)
      expect(v.content.status).toBe('proposal')
    }
    expect(s.store._state.approvals.size).toBe(0)
  })

  it.each(['missing', 'duplicate', 'reordered', 'extra'])('records failed run for %s episode coverage with no output proposals', async (attack) => {
    const generation = { identity: 'writer', generate: async (r: any) => {
      const result = await generateAll(r)
      if (r.step === 'episode_outlines') {
        if (attack === 'missing') result.proposals.pop()
        if (attack === 'duplicate') result.proposals[1].episode_id = 'EP01'
        if (attack === 'reordered') result.proposals.reverse()
        if (attack === 'extra') result.proposals.push({ ...result.proposals[0], episode_id: 'EP03' })
      }
      return result
    } }
    const s = await setup({ generation })
    let refs = [ref(s.idea)]
    for (const step of ['direction', 'bible', 'master_outline', 'season_architecture']) refs.push(...(await advance(s, step, refs)).output_refs)
    const result = await advance(s, 'episode_outlines', refs)
    expect(result).toMatchObject({ status: 'failed', error_code: 'INVALID_GENERATION_OUTPUT', output_refs: [] })
    expect((await s.store.getRun(result.creative_run_id)).status).toBe('failed')
    expect([...s.store._state.versions.values()].filter((v: any) => v.kind === 'episode_outline')).toEqual([])
  })

  it('requires research for later steps but explicitly permits direction without it', async () => {
    const s = await setup({ research: { resolve: async () => null } })
    const first = await s.service.runStep(auth, s.command)
    expect(first.status).toBe('succeeded')
    await expect(advance(s, 'adaptation', first.output_refs)).rejects.toMatchObject({ code: 'RESEARCH_REQUIRED' })
    expect(s.store._state.runs.size).toBe(1)
    const run = await s.store.getRun(first.creative_run_id)
    const context = await s.store.getArtifactVersion(run.input_manifest.input_refs.at(-1).version_id)
    expect(context.content.research_policy).toBe('optional')
    expect(context.content.research_ref).toBeNull()
  })

  it.each(['wrong-kind', 'false-digest', 'substituted', 'unversioned', 'invalid-port-ref'])('rejects %s research without inventing evidence', async (attack) => {
    let selected: any
    const s = await setup({ research: { resolve: async () => selected } })
    selected = ref(s.research)
    if (attack === 'invalid-port-ref') selected = false
    if (attack === 'wrong-kind') selected = ref(s.idea)
    if (attack === 'false-digest') selected.content_digest = `sha256:${'0'.repeat(64)}`
    if (attack === 'unversioned') {
      const v = structuredClone(s.research); delete v.content.snapshot_version; v.content_digest = canonicalHash(v.content)
      s.store._state.versions.set(v.version_id, v); selected = ref(v)
    }
    const input: any = { ...s.command }
    if (attack === 'substituted') input.research_ref = ref(s.idea)
    await expect(s.service.runStep(auth, input)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(s.store._state.runs.size).toBe(0)
    expect(s.calls).toHaveLength(0)
  })

  it('rejects missing step dependencies instead of allowing a master outline from only an idea', async () => {
    const s = await setup()
    await expect(advance(s, 'master_outline', [ref(s.idea)])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(s.calls).toHaveLength(0)
  })

  it.each(['throws', 'timeout', 'wrong-role', 'approval'])('persists sanitized failed runs for %s and replays failures', async (failure) => {
    let calls = 0
    const s = await setup({ config: { timeout_ms: 15 }, generation: { identity: 'writer', generate: async () => {
      calls++
      if (failure === 'throws') throw new Error('secret provider detail')
      if (failure === 'timeout') return new Promise(() => {})
      return { proposals: [{ role: failure === 'wrong-role' ? 'review_report' : 'direction', data: 'bad' }], ...(failure === 'approval' ? { approval: { decision: 'approved' } } : {}) }
    } } })
    const result = await s.service.runStep(auth, s.command)
    expect(result.status).toBe('failed')
    expect(result.output_refs).toEqual([])
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(await s.service.runStep(auth, s.command)).toEqual(result)
    expect(calls).toBe(1)
    expect(s.store._state.approvals.size).toBe(0)
  })

  it('replays across service instances without re-resolving research or generating, and conflicts on changed payload', async () => {
    const s = await setup()
    const first = await s.service.runStep(auth, s.command)
    const again = new StoryDevelopmentService(s.store, {
      generation: { identity: 'writer', generate: async () => { throw new Error('must not generate') } },
      review: { identity: 'reviewer', review: async () => { throw new Error('must not review') } },
      research: { resolve: async () => { throw new Error('must not re-resolve') } },
    })
    expect(await again.runStep(auth, s.command)).toEqual(first)
    await expect(again.runStep(auth, { ...s.command, expected_revision: 2 })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    expect(s.store._state.runs.size).toBe(1)
    expect(s.calls).toHaveLength(1)
  })

  it.each(['stale', 'missing-key', 'negative-revision', 'unauthorized', 'wrong-workspace', 'foreign', 'false-digest', 'corrupt-body', 'duplicate', 'bad-step'])('rejects %s before generation or writes', async (attack) => {
    const s = await setup()
    const input: any = structuredClone(s.command)
    let context = auth
    if (attack === 'stale') input.expected_revision = 0
    if (attack === 'missing-key') delete input.idempotency_key
    if (attack === 'negative-revision') input.expected_revision = -1
    if (attack === 'unauthorized') context = { ...auth, scopes: [] }
    if (attack === 'wrong-workspace') input.workspace_id = 'different'
    if (attack === 'foreign') {
      await s.store.createProject({ project_id: 'foreign', workspace_id: 'ws', revision: 0 })
      input.input_refs = [ref(await s.artifact('foreign', 'other_drama', 'foreign', { project_id: 'foreign' }))]
    }
    if (attack === 'false-digest') input.input_refs[0].content_digest = `sha256:${'0'.repeat(64)}`
    if (attack === 'corrupt-body') s.store._state.versions.get(s.idea.version_id).content = 'tampered'
    if (attack === 'duplicate') input.input_refs.push(input.input_refs[0])
    if (attack === 'bad-step') input.step = 'usvds.03'
    const count = s.store._state.versions.size
    await expect(s.service.runStep(context, input)).rejects.toMatchObject({ code: attack === 'stale' ? 'REVISION_CONFLICT' : attack === 'unauthorized' ? 'FORBIDDEN' : 'VALIDATION_ERROR' })
    expect(s.store._state.versions.size).toBe(count)
    expect(s.store._state.runs.size).toBe(0)
    expect(s.calls).toHaveLength(0)
    expect((await s.store.getProject('project')).revision).toBe(1)
  })

  it('snapshots caller input before authorization awaits and freezes port inputs', async () => {
    const s = await setup({ generation: { identity: 'writer', generate: async (request: any) => {
      expect(Object.isFrozen(request)).toBe(true)
      expect(Object.isFrozen(request.inputs[0].content)).toBe(true)
      return { proposals: [{ role: 'direction', data: 'frozen input' }] }
    } } })
    const input = structuredClone(s.command)
    s.store._authorize = async () => { input.input_refs[0].version_id = 'injected'; input.expected_revision = 200; return true }
    const result = await s.service.runStep(auth, input)
    const run = await s.store.getRun(result.creative_run_id)
    expect(run.input_manifest.input_refs).toContainEqual(ref(s.idea))
    const context = await s.store.getArtifactVersion(run.input_manifest.input_refs.at(-1).version_id)
    expect(context.content.schema_version).toBe('dramago.story-run-context/v1')
    expect(context.content.project_revision).toBe(1)
    expect(context.content.ordered_episode_ids).toEqual(['EP01', 'EP02'])
  })

  it('persists a direction proposal and CreativeRun over existing facts without approving', async () => {
    const s = await setup()
    const result = await s.service.runStep(auth, s.command)
    expect(result.status).toBe('succeeded')
    expect(result.project_revision).toBe(2)
    const run = await s.store.getRun(result.creative_run_id)
    expect(run.domain).toBe('story')
    expect(run.steps[0].stage).toBe('story.direction')
    expect(run.input_manifest_digest).toBe(canonicalHash(run.input_manifest))
    expect(run.input_manifest.input_refs).toContainEqual(ref(s.idea))
    expect(run.input_manifest.input_refs).toContainEqual(ref(s.research))
    const output = await s.store.getArtifactVersion(result.output_refs[0].version_id)
    expect(output.content.artifact_role).toBe('direction')
    expect(output.content.status).toBe('proposal')
    expect(output.content.dependency_refs).toEqual(run.input_manifest.input_refs)
    expect(output.content_digest).toBe(canonicalHash(output.content))
    expect(await s.store.listApprovals(ref(output))).toEqual([])
    expect(s.calls).toHaveLength(1)
    expect(s.actions).toEqual(['story.execute'])
  })
})
