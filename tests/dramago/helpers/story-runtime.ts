import { randomUUID } from 'node:crypto'
import { canonicalHash } from '../../../packages/dramago-application/index.js'
import { InMemoryDramaRepository } from '../../../packages/dramago-persistence/index.js'
import { StoryDevelopmentService } from '../../../packages/story-development/src/index.js'
import { storyFixture, exactRef } from './p2-story-fixtures.mjs'
import { policy } from './p2-story-conformance.mjs'

export const auth = { tenantId: 'tenant', subjectId: 'author', clientId: 'test', scopes: ['story.execute', 'story.review'] }
export const ref = exactRef
export const seal = (v: any) => ({ ...v, content_digest: canonicalHash(v.content) })
export const contextOf = (r: any) => r.artifacts.find((a: any) => a.version_id === r.context_ref.version_id).content

// Only seed immutable imported inputs. Every generated record below is produced
// by an injected offline port during an actual service invocation and persisted.
export async function setup(options: any = {}) {
  const fixture = storyFixture()
  const store = options.store ?? new InMemoryDramaRepository({ tenantId: 'tenant', authorize: () => true })
  const project = fixture.project
  await store.createProject(project)
  const seeds = fixture.artifacts.filter((a: any) => ['av_range', 'av_idea', 'av_research', 'av_writer_config', 'av_reviewer_config'].includes(a.version_id))
  for (const a of seeds) await store.putArtifactVersion(a)
  const seed = (id: string) => seeds.find((a: any) => a.version_id === `av_${id}`)
  const byRole: any = { idea: ref(seed('idea')) }
  const calls: any[] = [], reviewCalls: any[] = [], researchCalls: any[] = []
  const proposal = (request: any, role: string, episode?: string) => {
    const template = fixture.artifacts.find((a: any) => episode ? a.episode_id === episode : a.content.schema_version === `dramago.${role.replaceAll('_', '-')}/v1`)
    const content = { ...structuredClone(template.content), run_context_ref: request.context_ref, dependency_refs: request.input_manifest.input_refs }
    return seal({ ...structuredClone(template), artifact_id: `art_${randomUUID()}`, version_id: `av_${randomUUID()}`, content })
  }
  const generate = async (request: any) => {
    const c = contextOf(request)
    const result = { proposals: c.operation === 'episode_outlines' ? c.planning_scope.ordered_episode_ids.map((id: string) => proposal(request, 'episode_outline', id)) : policy.steps[c.operation].outputs.map((role: string) => proposal(request, role)) }
    if (c.operation === 'direction' && c.research.status === 'omitted') result.proposals[0].content.market_claim_ids = []
    result.proposals = result.proposals.map(seal)
    return result
  }
  const review = async (request: any) => {
    const c = contextOf(request), b = c.bindings
    const set = request.artifacts.find((a: any) => a.version_id === b.episode_outline_set.version_id)
    const episodes = set.content.ordered_episodes.map((e: any) => e.outline_ref)
    const report = proposal(request, 'planning_review_evidence')
    report.content.planning_scope = c.planning_scope
    report.content.subject_refs = [c.planning_scope.definition_ref, ...['story_foundation', 'story_bible', 'master_outline', 'season_architecture'].map(n => b[n]), ...episodes]
    report.content.inspected_refs = [c.planning_scope.definition_ref, ...policy.steps.planning_review.required_bindings.map((n: string) => b[n]), ...episodes, c.research.snapshot_ref]
    report.content.reviewer_id = 'reviewer_a'
    report.content.reviewed_writer_ids = ['writer_a']
    return { proposals: [seal(report)] }
  }
  const configuration = {
    generation: { identity: 'writer_a', configuration_ref: ref(seed('writer_config')), generate: async (r: any, signal: AbortSignal) => { calls.push(r); return options.generate ? options.generate(r, generate, signal) : generate(r) } },
    review: { identity: 'reviewer_a', configuration_ref: ref(seed('reviewer_config')), review: async (r: any, signal: AbortSignal) => { reviewCalls.push(r); return options.review ? options.review(r, review, signal) : review(r) } },
    research: { resolve_snapshot: async (r: any) => { researchCalls.push(r); return options.research ? options.research(r) : store.getArtifactVersion(r.snapshot_ref.version_id) } },
    allowSyntheticResearch: true, ...options.config,
  }
  const service = new StoryDevelopmentService(store, configuration)
  const put = async (content: any, kind = 'other_drama', extra: any = {}) => {
    const a = seal({ schema_version: 'dramago.artifact-version/v1', workspace_id: project.workspace_id, project_id: project.project_id, artifact_id: `art_${randomUUID()}`, version_id: `av_${randomUUID()}`, kind, content, created_at: '2026-01-01T00:00:00Z', ...extra })
    await store.putArtifactVersion(a)
    return a
  }
  const command = async (step: string, edits: any = {}) => {
    const p = await store.getProject(project.project_id)
    const c = await put({ schema_version: 'dramago.story-run-context/v1', policy_version: policy.policy_version, operation: step,
      project_revision: p.revision, planning_scope: p.planning_range, instructions: 'Offline runtime integration test',
      executor: { role: step === 'planning_review' ? 'reviewer' : 'writer', executor_id: step === 'planning_review' ? 'reviewer_a' : 'writer_a', configuration_ref: ref(seed(step === 'planning_review' ? 'reviewer_config' : 'writer_config')) },
      bindings: Object.fromEntries(policy.steps[step].required_bindings.map((name: string) => [name, byRole[name]])), source_refs: [],
      research: { status: 'supplied', snapshot_ref: ref(seed('research')) }, ...edits,
    })
    return { project_id: project.project_id, expected_revision: p.revision, idempotency_key: `request_${randomUUID()}`, context_ref: ref(c), ...(step === 'planning_review' ? {} : { step }) }
  }
  const execute = async (step: string, cmd?: any) => {
    const request = cmd ?? await command(step)
    const result = await (step === 'planning_review' ? service.planningReview(auth, request) : service.runStep(auth, request))
    const run = await store.getRun(result.creative_run_id)
    const outputs = await Promise.all(run.steps[0].attempts[0].output_refs.map((r: any) => store.getArtifactVersion(r.version_id)))
    for (const a of outputs) byRole[a.episode_id ?? a.content.schema_version.slice(8, -3).replaceAll('-', '_')] = ref(a)
    return { request, result, run, outputs }
  }
  const fullStory = async () => {
    const results = []
    for (const step of Object.keys(policy.steps).filter(s => s !== 'planning_review')) results.push(await execute(step))
    return results
  }
  return { store, project, seed, byRole, calls, reviewCalls, researchCalls, configuration, service, put, command, execute, fullStory }
}
