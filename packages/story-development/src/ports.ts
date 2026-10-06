export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }
export interface ArtifactRef { artifact_id: string; version_id: string; content_digest: string }
export interface ArtifactVersion extends ArtifactRef {
  schema_version: 'dramago.artifact-version/v1'
  project_id: string
  workspace_id: string
  kind: string
  content: JsonObject | string
  created_at: string
  episode_id?: string
}
export interface AuthContext { tenantId: string; subjectId: string; clientId: string; scopes: string[] }
export interface ProjectFact {
  project_id: string
  workspace_id: string
  revision: number
  planning_range: { range_id: string; definition_ref: ArtifactRef; ordered_episode_ids: string[] }
}
export type StoryStep = 'direction' | 'adaptation' | 'bible' | 'master_outline' | 'season_architecture' | 'episode_outlines'
export type ArtifactRole = 'direction' | 'adaptation' | 'story_foundation' | 'story_bible' | 'master_outline' | 'season_architecture' | 'episode_outline' | 'episode_outline_set'
export interface Command {
  project_id: string
  workspace_id: string
  expected_revision: number
  idempotency_key: string
}
export interface RunStepInput extends Command {
  step: StoryStep
  input_refs: ArtifactRef[]
  research_ref?: ArtifactRef
}
export interface PlanningScope {
  direction_ref: ArtifactRef
  story_foundation: ArtifactRef
  story_bible: ArtifactRef
  master_outline: ArtifactRef
  season_architecture: ArtifactRef
  episode_outline_set_ref: ArtifactRef
  ordered_episodes: { episode_id: string; outline_ref: ArtifactRef }[]
}
export interface PlanningReviewInput extends Command { planning_scope: PlanningScope; research_ref?: ArtifactRef }
export interface InputManifest {
  schema_version: 'dramago.run-input-manifest/v1'
  policy_version: string
  input_refs: ArtifactRef[]
}
export interface GenerationRequest {
  step: StoryStep
  project: ProjectFact
  input_manifest: InputManifest
  input_manifest_digest: string
  inputs: ArtifactVersion[]
}
export interface Proposal { role: ArtifactRole; data: JsonObject | string; episode_id?: string }
/** No repository, approval capability, or provider SDK is exposed to a writer. */
export interface StoryGenerationPort {
  readonly identity: string
  generate(request: GenerationRequest, signal: AbortSignal): Promise<{ proposals: Proposal[] }>
}
export interface ReviewRequest extends Omit<GenerationRequest, 'step'> {
  planning_scope: PlanningScope
  subject_refs: ArtifactRef[]
  context_refs: ArtifactRef[]
}
export interface Finding {
  code: string
  message: string
  severity: 'info' | 'warning' | 'blocker'
  subject_refs: ArtifactRef[]
}
export interface ReviewResult {
  outcome: 'PASS' | 'FAIL' | 'BLOCKED'
  subject_refs: ArtifactRef[]
  context_refs: ArtifactRef[]
  findings: Finding[]
  blockers: string[]
}
/** Separate role and identity; all outcomes are evidence, never authority to approve. */
export interface PlanningReviewPort {
  readonly identity: string
  review(request: ReviewRequest, signal: AbortSignal): Promise<ReviewResult>
}
/** Resolves an already imported immutable research snapshot; performs no network I/O. */
export interface ResearchContextPort {
  resolve(request: { project: ProjectFact; step: StoryStep | 'planning_review'; requested_ref: ArtifactRef | null }, signal: AbortSignal): Promise<ArtifactRef | null>
}
export interface CreativeRun {
  schema_version: 'dramago.creative-run/v1'
  run_id: string
  project_id: string
  workspace_id: string
  domain: 'story'
  revision: number
  status: 'succeeded' | 'failed'
  input_manifest: InputManifest
  input_manifest_digest: string
  steps: { step_id: string; stage: string; attempts: { attempt: number; status: 'succeeded' | 'failed'; input_manifest_digest: string; output_refs: ArtifactRef[] }[] }[]
  created_at: string
}
export interface RunResult {
  creative_run_id: string
  project_revision: number
  status: 'succeeded' | 'failed'
  output_refs: ArtifactRef[]
  error_code?: string
}
/**
 * Structural subset of the existing tenant-bound DramaRepository, NOT a new store.
 * Transactions must atomically commit/rollback all writes. findIdempotency must
 * reserve (tenant, scope, key) through commit so concurrent retries replay before
 * CAS. These are repository guarantees, not optional service-local locking.
 */
export interface StoryRepository {
  authorize(auth: AuthContext, action: string, resource: { project_id: string; workspace_id: string }): Promise<unknown>
  transaction<T>(fn: (tx: StoryRepository) => Promise<T>): Promise<T>
  getProject(id: string): Promise<ProjectFact | null>
  compareAndSetProject(id: string, revision: number, patch: object): Promise<ProjectFact>
  getArtifactVersion(id: string): Promise<ArtifactVersion | null>
  putArtifactVersion(version: ArtifactVersion): Promise<unknown>
  getBaselineByVersion(versionId: string, projectId: string): Promise<unknown>
  putRun(run: CreativeRun): Promise<unknown>
  findIdempotency(scope: object, key: string): Promise<{ payloadHash: string; result: RunResult } | null>
  putIdempotency(record: { scope: object; key: string; payloadHash: string; result: RunResult }): Promise<unknown>
  appendAudit(event: object): Promise<unknown>
}
export interface StoryOptions {
  generation: StoryGenerationPort
  review: PlanningReviewPort
  research: ResearchContextPort
  now?: () => Date
  id?: () => string
  timeout_ms?: number
}
