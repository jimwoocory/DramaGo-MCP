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
  parent_ref?: ArtifactRef
}
export interface AuthContext { tenantId: string; subjectId: string; clientId: string; scopes: string[] }
export interface PlanningScope { range_id: string; definition_ref: ArtifactRef; ordered_episode_ids: string[] }
export interface ProjectFact { project_id: string; workspace_id: string; revision: number; planning_range: PlanningScope }
export type StoryStep = 'direction' | 'adaptation' | 'bible' | 'master_outline' | 'season_architecture' | 'episode_outlines'
export type ArtifactRole = 'idea' | 'direction' | 'story_foundation' | 'story_bible' | 'master_outline' | 'season_architecture' | 'episode_outline' | 'episode_outline_set' | 'planning_review_evidence'
export interface Command { project_id: string; expected_revision: number; idempotency_key: string; context_ref: ArtifactRef }
export interface RunStepInput extends Command { step: StoryStep }
export type PlanningReviewInput = Command
export interface RunContext {
  schema_version: 'dramago.story-run-context/v1'
  policy_version: string
  operation: StoryStep | 'planning_review'
  project_revision: number
  planning_scope: PlanningScope
  instructions: string
  executor: { role: 'writer' | 'reviewer'; executor_id: string; configuration_ref: ArtifactRef }
  bindings: Record<string, ArtifactRef>
  source_refs: ArtifactRef[]
  research: { status: 'supplied'; snapshot_ref: ArtifactRef } | { status: 'omitted'; reason: string }
}
export interface InputManifest { schema_version: 'dramago.run-input-manifest/v1'; policy_version: string; input_refs: ArtifactRef[] }
/** Exactly the published frozen_input; no live project or ambient prompt fields. */
export interface GenerationRequest { context_ref: ArtifactRef; input_manifest: InputManifest; input_manifest_digest: string; artifacts: ArtifactVersion[] }
export type ReviewRequest = GenerationRequest
export interface ProposalBundle { proposals: ArtifactVersion[] }
export type Proposal = ArtifactVersion
export interface StoryGenerationPort {
  readonly identity: string
  readonly configuration_ref: ArtifactRef
  generate(request: GenerationRequest, signal: AbortSignal): Promise<ProposalBundle>
}
export interface PlanningReviewPort {
  readonly identity: string
  readonly configuration_ref: ArtifactRef
  review(request: ReviewRequest, signal: AbortSignal): Promise<ProposalBundle>
}
export interface ResearchContextPort {
  resolve_snapshot(request: { workspace_id: string; project_id: string; snapshot_ref: ArtifactRef }, signal: AbortSignal): Promise<ArtifactVersion>
}
export interface CreativeRun {
  schema_version: 'dramago.creative-run/v1'
  run_id: string
  project_id: string
  workspace_id: string
  domain: 'story'
  status: 'running' | 'succeeded' | 'failed'
  input_manifest: InputManifest
  input_manifest_digest: string
  steps: { step_id: string; stage: string; attempts: { attempt: number; status: 'running' | 'succeeded' | 'failed'; input_manifest_digest: string; output_refs: ArtifactRef[] }[] }[]
  created_at: string
}
export interface RunResult { creative_run_id: string }
/** Existing tenant-bound repository. Transactions/CAS/idempotency are durable repository guarantees. */
export interface StoryRepository {
  authorize(auth: AuthContext, action: string, resource: { project_id: string; workspace_id: string }): Promise<unknown>
  transaction<T>(fn: (tx: StoryRepository) => Promise<T>): Promise<T>
  getProject(id: string): Promise<ProjectFact | null>
  compareAndSetProject(id: string, revision: number, patch: object): Promise<ProjectFact>
  getArtifactVersion(id: string): Promise<ArtifactVersion | null>
  putArtifactVersion(version: ArtifactVersion): Promise<unknown>
  getBaselineByVersion(versionId: string, projectId: string): Promise<unknown>
  getRun(id: string): Promise<(CreativeRun & { revision: number }) | null>
  putRun(run: CreativeRun): Promise<unknown>
  compareAndSetRun(id: string, revision: number, patch: object): Promise<unknown>
  findIdempotency(scope: object, key: string): Promise<{ payloadHash: string; result: RunResult } | null>
  putIdempotency(record: { scope: object; key: string; payloadHash: string; result: RunResult }): Promise<unknown>
  appendAudit(event: object): Promise<unknown>
}
export interface StoryOptions {
  generation: StoryGenerationPort
  review: PlanningReviewPort
  research: ResearchContextPort
  /** Offline tests only; never treat synthetic data as observed market research. */
  allowSyntheticResearch?: boolean
  now?: () => Date
  id?: () => string
  timeout_ms?: number
}
