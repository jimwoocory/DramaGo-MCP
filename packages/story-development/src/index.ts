import { randomUUID } from 'node:crypto'
import { canonicalHash, snapshot, equal, DomainError } from '@xiaoshuren/dramago-application/domain.js'
import type { ArtifactRef, ArtifactVersion, AuthContext, Command, CreativeRun, GenerationRequest, JsonObject, PlanningReviewInput, ProjectFact, RunContext, RunResult, RunStepInput, StoryOptions, StoryRepository } from './ports.js'
import { check, commandValid, exact, freeze, projectAt, ref, reference, text, uniqueRefs } from './validation.js'
import { STORY_POLICY_VERSION, artifactRole, contentObject, researchSnapshot, marketClaimsValid, validateContent } from './policy.js'
import { assertShape, policy } from './contracts.js'
import { independentReviewer, reviewValid } from './review.js'
import { coherentBindings, contextOf, executionId, manifestRefs, resolveDependencies, resolveIn, validateContext, validateGraph, validateResearchGraph, validateSet } from './dependencies.js'
export type * from './ports.js'
export { STEP_POLICIES, STORY_POLICY_VERSION } from './policy.js'

export class StoryDevelopmentService {
  private readonly now: () => Date
  private readonly id: () => string
  private readonly timeout: number
  private readonly options: StoryOptions
  constructor(private readonly store: StoryRepository, options: StoryOptions) {
    text(options.generation?.identity); text(options.review?.identity)
    check(typeof options.generation.generate === 'function' && typeof options.review.review === 'function' && typeof options.research?.resolve_snapshot === 'function', 'all three injected ports are required')
    reference(options.generation.configuration_ref); reference(options.review.configuration_ref)
    check((options.generation as unknown) !== options.review && options.generation.identity !== options.review.identity && (options.generation.generate as unknown) !== options.review.review, 'writer and reviewer must be separate roles', 'ROLE_SEPARATION')
    check(options.authorship === undefined || typeof options.authorship.attest === 'function', 'invalid trusted authorship port')
    // Capture trusted identities/configuration/callables before any async boundary.
    this.options = {
      generation: Object.freeze({ identity: options.generation.identity, configuration_ref: freeze(snapshot(options.generation.configuration_ref)), generate: options.generation.generate.bind(options.generation) }),
      review: Object.freeze({ identity: options.review.identity, configuration_ref: freeze(snapshot(options.review.configuration_ref)), review: options.review.review.bind(options.review) }),
      research: Object.freeze({ resolve_snapshot: options.research.resolve_snapshot.bind(options.research) }),
      allowSyntheticResearch: options.allowSyntheticResearch === true || options.allow_synthetic_research === true,
      ...(options.authorship ? { authorship: Object.freeze({ attest: options.authorship.attest.bind(options.authorship) }) } : {}),
    }
    this.now = options.now ?? (() => new Date())
    this.id = options.id ?? randomUUID
    this.timeout = options.timeout_ms ?? 30_000
    check(Number.isSafeInteger(this.timeout) && this.timeout > 0 && this.timeout <= 60_000, 'timeout must be 1..60000ms')
  }
  private artifact(project: ProjectFact, kind: string, content: JsonObject): ArtifactVersion {
    return { schema_version: 'dramago.artifact-version/v1', artifact_id: `art_${this.id()}`, version_id: `av_${this.id()}`, project_id: project.project_id, workspace_id: project.workspace_id, kind, content, content_digest: canonicalHash(content), created_at: this.now().toISOString() }
  }
  private async bounded<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        Promise.resolve().then(() => call(controller.signal)),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new DomainError('PORT_TIMEOUT', 'injected port timed out')); controller.abort() }, this.timeout) }),
      ])
    } finally { clearTimeout(timer) }
  }
  async runStep(auth: AuthContext, input: RunStepInput): Promise<RunResult> {
    return this.execute(freeze(snapshot(auth)), freeze(snapshot(input)), false)
  }
  async planningReview(auth: AuthContext, input: PlanningReviewInput): Promise<RunResult> {
    return this.execute(freeze(snapshot(auth)), freeze(snapshot(input)), true)
  }
  private async execute(auth: AuthContext, command: Command | RunStepInput, isReview: boolean): Promise<RunResult> {
    const action = isReview ? 'story.review' : 'story.execute'
    commandValid(auth, command, action)
    // Workspace comes from the tenant-bound project, never a caller payload label.
    const owner = await this.store.getProject(command.project_id)
    check(owner && owner.project_id === command.project_id, 'project not found', 'NOT_FOUND')
    check(await this.store.authorize(auth, action, { project_id: owner.project_id, workspace_id: owner.workspace_id }) === true, 'authorization denied', 'FORBIDDEN')
    const step = isReview ? 'planning_review' : (command as RunStepInput).step
    const scope = { workspace_id: owner.workspace_id, project_id: command.project_id, command: isReview ? 'dramago_planning_review' : 'dramago_story_step_run' }
    const payloadHash = canonicalHash(command)
    const admission = await this.store.transaction(async tx => {
      const previous = await tx.findIdempotency(scope, command.idempotency_key)
      if (previous) {
        check(previous.payloadHash === payloadHash, 'changed idempotent payload', 'IDEMPOTENCY_CONFLICT')
        return { result: snapshot(previous.result) }
      }
      const project = await projectAt(tx, command)
      check(project.workspace_id === owner.workspace_id, 'project ownership changed')
      const context = await exact(tx, project, command.context_ref)
      assertShape('run_context', context.content)
      const c = contextOf(context)
      check(c.operation === step && c.project_revision === project.revision && equal(c.planning_scope, project.planning_range), 'context operation/revision/scope mismatch')
      const executor = isReview ? this.options.review : this.options.generation
      check(c.executor.executor_id === executor.identity && equal(c.executor.configuration_ref, executor.configuration_ref), 'context executor differs from trusted port', 'ROLE_SEPARATION')
      const artifacts = await resolveDependencies(tx, project, [command.context_ref])
      validateContext(context, artifacts)
      await validateGraph(tx, artifacts, this.options.allowSyntheticResearch === true)
      coherentBindings(c, artifacts)
      validateResearchGraph(command.context_ref, artifacts)
      if (isReview) await independentReviewer(tx, project, executor.identity, artifacts,
        this.options.authorship ? { attest: request => this.bounded(signal => this.options.authorship!.attest(request, signal)) } : undefined,
        this.options.allowSyntheticResearch === true, [this.options.generation.configuration_ref, this.options.review.configuration_ref])
      if (c.research.status === 'supplied') {
        const selected = resolveIn(artifacts, c.research.snapshot_ref)
        const request = { workspace_id: project.workspace_id, project_id: project.project_id, snapshot_ref: c.research.snapshot_ref }
        assertShape('research_request', request)
        const research = snapshot(await this.bounded(signal => this.options.research.resolve_snapshot(freeze(snapshot(request)), signal)))
        assertShape('research_response', research)
        check(equal(research, selected), 'research port substituted frozen snapshot')
        researchSnapshot(research, this.options.allowSyntheticResearch === true)
      }
      const manifest = { schema_version: 'dramago.run-input-manifest/v1' as const, policy_version: STORY_POLICY_VERSION, input_refs: manifestRefs(command.context_ref, c, artifacts) }
      const request: GenerationRequest = freeze(snapshot({ context_ref: command.context_ref, input_manifest: manifest, input_manifest_digest: canonicalHash(manifest), artifacts }))
      assertShape('frozen_input', request)
      const run: CreativeRun = {
        schema_version: 'dramago.creative-run/v1', run_id: executionId(command.context_ref), project_id: project.project_id, workspace_id: project.workspace_id,
        domain: 'story', status: 'running', input_manifest: manifest, input_manifest_digest: request.input_manifest_digest,
        steps: [{ step_id: `step_${this.id()}`, stage: `story.${step}`, attempts: [{ attempt: 1, status: 'running', input_manifest_digest: request.input_manifest_digest, output_refs: [] }] }], created_at: this.now().toISOString(),
      }
      assertShape('creative-run.schema.json', run)
      const result = { creative_run_id: run.run_id }
      await tx.putRun(run)
      await tx.putIdempotency({ scope, key: command.idempotency_key, payloadHash, result })
      return { result, project, c, request, run }
    })
    // Durable replay (including an in-flight run) never invokes a port again.
    if (!admission.request || !admission.run || !admission.project || !admission.c) return admission.result
    const { request, run, project, c } = admission
    let outputs: ArtifactVersion[] = [], errorCode: string | undefined
    try {
      const bundle = snapshot(await this.bounded(signal => isReview ? this.options.review.review(request, signal) : this.options.generation.generate(request, signal)))
      const code = isReview ? 'INVALID_REVIEW_OUTPUT' : 'INVALID_GENERATION_OUTPUT'
      assertShape('proposal_bundle', bundle, code)
      outputs = bundle.proposals
      const expected = step === 'episode_outlines' ? project.planning_range.ordered_episode_ids.map(() => 'episode_outline') : policy.steps[step].outputs
      check(equal(outputs.map(artifactRole), expected), 'incorrect proposal output types/count', code)
      if (step === 'episode_outlines') check(equal(outputs.map(v => v.episode_id), project.planning_range.ordered_episode_ids), 'complete ordered episodes required', code)
      for (const output of outputs) {
        validateContent(output, c, request.artifacts, code)
        marketClaimsValid(output.content, c.research.status === 'supplied' ? resolveIn(request.artifacts, c.research.snapshot_ref) : undefined, code)
        check(equal(contentObject(output).run_context_ref, command.context_ref) && equal(contentObject(output).dependency_refs, request.input_manifest.input_refs), 'proposal provenance mismatch', code)
      }
      if (isReview) reviewValid(outputs[0], c, request.artifacts)
      if (step === 'episode_outlines') {
        outputs.push(this.artifact(project, 'other_drama', {
          schema_version: 'dramago.episode-outline-set/v1', run_context_ref: command.context_ref as unknown as JsonObject,
          dependency_refs: uniqueRefs([...request.input_manifest.input_refs, ...outputs.map(ref)]) as unknown as JsonObject[],
          planning_scope: c.planning_scope as unknown as JsonObject,
          ordered_episodes: outputs.map(v => ({ episode_id: v.episode_id!, outline_ref: ref(v) })) as unknown as JsonObject[],
        }))
        validateContent(outputs.at(-1)!, c, request.artifacts, code)
        validateSet(outputs.at(-1)!, c, [...request.artifacts, ...outputs])
      }
      // Validate fresh output identity and CAS inside the same publication transaction.
      await this.store.transaction(async tx => {
        await projectAt(tx, command)
        await this.freshOutputs(tx, project, outputs, request, code)
        for (const output of outputs) await tx.putArtifactVersion(output)
        await tx.compareAndSetProject(project.project_id, command.expected_revision, {})
        await this.finish(tx, run, outputs)
      })
    } catch (error) {
      outputs = []
      const allowed = ['PORT_TIMEOUT', 'INVALID_GENERATION_OUTPUT', 'INVALID_REVIEW_OUTPUT', 'REVISION_CONFLICT']
      errorCode = error instanceof DomainError && allowed.includes(error.code) ? error.code : isReview ? 'REVIEW_FAILED' : 'GENERATION_FAILED'
      await this.store.transaction(tx => this.finish(tx, run, [], errorCode))
    }
    return admission.result
  }
  private async freshOutputs(tx: StoryRepository, project: ProjectFact, outputs: ArtifactVersion[], request: GenerationRequest, code: string) {
    check(new Set(outputs.map(v => v.version_id)).size === outputs.length, 'duplicate proposal versions', code)
    for (const v of outputs) {
      assertShape('artifact-version.schema.json', v, code)
      check(v.workspace_id === project.workspace_id && v.project_id === project.project_id && v.content_digest === canonicalHash(v.content), 'proposal owner/digest mismatch', code)
      check(!await tx.getArtifactVersion(v.version_id) && !await tx.getBaselineByVersion(v.version_id, project.project_id), 'proposal version must be new', code)
      if (v.parent_ref) {
        const parent = resolveIn(request.artifacts, v.parent_ref)
        check(v.artifact_id === parent.artifact_id && v.kind === parent.kind && v.episode_id === parent.episode_id, 'invalid revision parent', code)
      }
    }
  }
  private async finish(tx: StoryRepository, run: CreativeRun, outputs: ArtifactVersion[], errorCode?: string) {
    const status = errorCode ? 'failed' as const : 'succeeded' as const
    const terminal: CreativeRun = { ...run, status, steps: [{ ...run.steps[0], attempts: [{ ...run.steps[0].attempts[0], status, output_refs: outputs.map(ref) }] }] }
    assertShape('creative-run.schema.json', terminal)
    await tx.compareAndSetRun(run.run_id, 0, { status: terminal.status, steps: terminal.steps })
    await tx.appendAudit({ event_id: `audit_${this.id()}`, project_id: run.project_id, workspace_id: run.workspace_id, action: run.steps[0].stage, creative_run_id: run.run_id, status, ...(errorCode ? { error_code: errorCode } : {}) })
  }
}
