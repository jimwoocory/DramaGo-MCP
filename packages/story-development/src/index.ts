import { randomUUID } from 'node:crypto'
import { canonicalHash, snapshot, equal, DomainError } from '@xiaoshuren/dramago-application/domain.js'
import type { ArtifactRef, ArtifactVersion, AuthContext, CreativeRun, JsonObject, PlanningReviewInput, RunResult, RunStepInput, StoryOptions, StoryRepository } from './ports.js'
import { check, commandValid, exact, freeze, projectAt, ref, reference, text, uniqueRefs } from './validation.js'
import { STEP_POLICIES, STORY_POLICY_VERSION, stepDependencies, researchSnapshot, roleKind, proposalsValid } from './policy.js'
import { independentReviewer, planningInputs, reviewValid } from './review.js'
import { resolveDependencies } from './dependencies.js'
export type * from './ports.js'
export { STEP_POLICIES, STORY_POLICY_VERSION } from './policy.js'

export class StoryDevelopmentService {
  private readonly now: () => Date
  private readonly id: () => string
  private readonly timeout: number
  private readonly options: StoryOptions
  constructor(private readonly store: StoryRepository, options: StoryOptions) {
    text(options.generation?.identity); text(options.review?.identity)
    check(typeof options.generation.generate === 'function' && typeof options.review.review === 'function' && typeof options.research?.resolve === 'function', 'all three injected ports are required')
    check((options.generation as unknown) !== options.review && options.generation.identity !== options.review.identity && (options.generation.generate as unknown) !== options.review.review, 'writer and reviewer must be separate roles', 'ROLE_SEPARATION')
    // Capture identities and callables now: later host mutation cannot switch a role.
    this.options = {
      generation: Object.freeze({ identity: options.generation.identity, generate: options.generation.generate.bind(options.generation) }),
      review: Object.freeze({ identity: options.review.identity, review: options.review.review.bind(options.review) }),
      research: Object.freeze({ resolve: options.research.resolve.bind(options.research) }),
    }
    this.now = options.now ?? (() => new Date())
    this.id = options.id ?? randomUUID
    this.timeout = options.timeout_ms ?? 30_000
    check(Number.isSafeInteger(this.timeout) && this.timeout > 0 && this.timeout <= 60_000, 'timeout must be 1..60000ms')
  }
  private artifact(project: { project_id: string; workspace_id: string }, kind: string, content: JsonObject | string): ArtifactVersion {
    return { schema_version: 'dramago.artifact-version/v1', artifact_id: `art_${this.id()}`, version_id: `av_${this.id()}`, project_id: project.project_id, workspace_id: project.workspace_id, kind, content, content_digest: canonicalHash(content), created_at: this.now().toISOString() }
  }
  private async bounded<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        Promise.resolve().then(() => call(controller.signal)),
        new Promise<never>((_, reject) => { timer = setTimeout(() => {
          reject(new DomainError('PORT_TIMEOUT', 'injected port timed out'))
          controller.abort()
        }, this.timeout) }),
      ])
    } finally { clearTimeout(timer) }
  }
  async runStep(auth: AuthContext, input: RunStepInput): Promise<RunResult> {
    const command = freeze(snapshot(input))
    check(!Object.hasOwn(command, 'planning_scope'), 'runStep cannot accept review scope')
    check(Object.hasOwn(STEP_POLICIES, command.step), 'step outside Story allowlist')
    check(Array.isArray(command.input_refs) && command.input_refs.length > 0 && uniqueRefs(command.input_refs).length === command.input_refs.length, 'nonempty unique input refs required')
    return this.execute(freeze(snapshot(auth)), command)
  }
  async planningReview(auth: AuthContext, input: PlanningReviewInput): Promise<RunResult> {
    const command = freeze(snapshot(input))
    check(Object.hasOwn(command, 'planning_scope') && !Object.hasOwn(command, 'step') && !Object.hasOwn(command, 'input_refs'), 'planningReview requires planning scope only')
    return this.execute(freeze(snapshot(auth)), command)
  }
  private async execute(auth: AuthContext, command: RunStepInput | PlanningReviewInput): Promise<RunResult> {
    const isReview = 'planning_scope' in command
    const step = isReview ? 'planning_review' : command.step
    const action = isReview ? 'story.review' : 'story.execute'
    commandValid(auth, command, action)
    check(await this.store.authorize(auth, action, { project_id: command.project_id, workspace_id: command.workspace_id }) === true, 'authorization denied', 'FORBIDDEN')
    const { idempotency_key: key, ...payload } = command
    const scope = { project_id: command.project_id, command: isReview ? 'story.planning.review' : 'story.step.run' }
    const payloadHash = canonicalHash(payload)
    return this.store.transaction(async tx => {
      // Repository transaction/replay lock, not a service-local in-flight map.
      const previous = await tx.findIdempotency(scope, key)
      if (previous) {
        check(previous.payloadHash === payloadHash, 'changed idempotent payload', 'IDEMPOTENCY_CONFLICT')
        return snapshot(previous.result)
      }
      const project = await projectAt(tx, command)
      let inputs: ArtifactVersion[] = []
      let subjectRefs: ArtifactRef[] = []
      let contextRefs: ArtifactRef[] = []
      if (isReview) {
        ({ inputs, subjectRefs, contextRefs } = await planningInputs(tx, project, command.planning_scope))
        independentReviewer(this.options.review.identity, inputs)
      } else {
        for (const r of uniqueRefs([...command.input_refs, project.planning_range.definition_ref])) inputs.push(await exact(tx, project, r))
        stepDependencies(command.step, inputs)
      }
      const selectedRefs = inputs.map(ref)
      inputs = await resolveDependencies(tx, project, inputs, isReview)
      const researchPolicy = isReview ? 'required' : STEP_POLICIES[command.step].research
      const research = snapshot(await this.bounded(signal => this.options.research.resolve(freeze(snapshot({ project, step, requested_ref: command.research_ref ?? null })), signal)))
      if (research !== null) reference(research)
      if (command.research_ref) check(equal(command.research_ref, research), 'research port substituted requested snapshot')
      check(research || researchPolicy === 'optional', 'required research snapshot missing', 'RESEARCH_REQUIRED')
      if (research) {
        const evidence = await exact(tx, project, research)
        researchSnapshot(evidence)
        if (!inputs.some(v => equal(ref(v), research))) inputs.push(evidence)
        if (isReview) contextRefs.push(research)
      }
      // Keep the original scope's coherence and order; selected research adds
      // evidence, not replacement planning subjects. Expand its dependencies too.
      inputs = await resolveDependencies(tx, project, inputs, false)
      if (isReview) independentReviewer(this.options.review.identity, inputs)
      const context = this.artifact(project, 'other_drama', {
        schema_version: 'dramago.story-run-context/v1', project_revision: project.revision, project: snapshot(project) as unknown as JsonObject,
        ordered_episode_ids: project.planning_range.ordered_episode_ids, command: snapshot(payload) as unknown as JsonObject,
        writer_identity: this.options.generation.identity, reviewer_identity: this.options.review.identity,
        research_ref: research as unknown as JsonObject | null, research_policy: researchPolicy,
      })
      inputs.push(context)
      const inputRefs = uniqueRefs(inputs.map(ref))
      const manifest = { schema_version: 'dramago.run-input-manifest/v1' as const, policy_version: STORY_POLICY_VERSION, input_refs: inputRefs }
      const digest = canonicalHash(manifest)
      const request = { project, input_manifest: manifest, input_manifest_digest: digest, inputs }
      const directRefs = uniqueRefs([...selectedRefs, ...(research ? [research] : []), ref(context)])
      const envelope = { schema_version: 'dramago.story-proposal/v1', status: 'proposal', generated_by: isReview ? this.options.review.identity : this.options.generation.identity, dependency_refs: inputRefs as unknown as JsonObject[], direct_dependency_refs: directRefs as unknown as JsonObject[], input_manifest_digest: digest }
      let outputs: ArtifactVersion[] = []
      let errorCode: string | undefined
      try {
        if (isReview) {
          const report = snapshot(await this.bounded(signal => this.options.review.review(freeze(snapshot({ ...request, planning_scope: command.planning_scope, subject_refs: subjectRefs, context_refs: contextRefs })), signal)))
          reviewValid(report, subjectRefs, contextRefs)
          outputs = [this.artifact(project, 'review_report', { ...envelope, ...report as unknown as JsonObject, review_kind: 'planning' })]
        } else {
          const generated = snapshot(await this.bounded(signal => this.options.generation.generate(freeze(snapshot({ ...request, step: command.step })), signal)))
          proposalsValid(generated, command.step, project.planning_range.ordered_episode_ids)
          outputs = generated.proposals.map(p => ({ ...this.artifact(project, roleKind(p.role), { ...envelope, artifact_role: p.role, data: p.data }), ...(p.episode_id ? { episode_id: p.episode_id } : {}) }))
          if (command.step === 'episode_outlines') outputs.push(this.artifact(project, 'other_drama', {
            ...envelope, artifact_role: 'episode_outline_set', ordered_episodes: outputs.map(v => ({ episode_id: v.episode_id!, outline_ref: ref(v) })) as unknown as JsonObject[],
          }))
        }
      } catch (error) {
        outputs = []
        errorCode = error instanceof DomainError && ['PORT_TIMEOUT', 'INVALID_GENERATION_OUTPUT', 'INVALID_REVIEW_OUTPUT'].includes(error.code) ? error.code : isReview ? 'REVIEW_FAILED' : 'GENERATION_FAILED'
      }
      const status = errorCode ? 'failed' : 'succeeded'
      await tx.putArtifactVersion(context)
      for (const output of outputs) await tx.putArtifactVersion(output)
      const run: CreativeRun = {
        schema_version: 'dramago.creative-run/v1', run_id: `run_${this.id()}`, project_id: project.project_id, workspace_id: project.workspace_id,
        domain: 'story', revision: 0, status, input_manifest: manifest, input_manifest_digest: digest,
        steps: [{ step_id: `step_${this.id()}`, stage: `story.${step}`, attempts: [{ attempt: 1, status, input_manifest_digest: digest, output_refs: outputs.map(ref) }] }],
        created_at: this.now().toISOString(),
      }
      await tx.putRun(run)
      const head = await tx.compareAndSetProject(project.project_id, command.expected_revision, {})
      const result: RunResult = { creative_run_id: run.run_id, project_revision: head.revision, status, output_refs: outputs.map(ref), ...(errorCode ? { error_code: errorCode } : {}) }
      await tx.putIdempotency({ scope, key, payloadHash, result })
      await tx.appendAudit({ event_id: `audit_${this.id()}`, project_id: project.project_id, workspace_id: project.workspace_id, action: scope.command, creative_run_id: run.run_id, status, ...(errorCode ? { error_code: errorCode } : {}) })
      return snapshot(result)
    })
  }
}
