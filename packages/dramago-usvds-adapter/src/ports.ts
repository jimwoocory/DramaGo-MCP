/** External source identity. revision must be immutable, never a branch or floating tag. */
export interface UsvdsSourcePin {
  readonly repository: string
  readonly revision: string
}

/** Advertised external capability; stage identifiers are owned by that capability. */
export interface UsvdsCapabilityMetadata {
  readonly capabilityId: string
  readonly contractVersion: string
  readonly source: UsvdsSourcePin
  readonly stageIds: readonly string[]
}

/** Opaque versioned handle, not a local path, URL, payload or storage implementation. */
export interface UsvdsArtifactReference {
  readonly artifactId: string
  readonly versionId: string
  readonly digest: string
}

/** Identity is supplied by the caller; this contract does not authorize requests. */
export interface UsvdsExecutionContext {
  readonly tenantId: string
  readonly projectId: string
  readonly actorId: string
  readonly correlationId: string
  readonly executionId: string
  readonly idempotencyKey: string
}

export interface UsvdsRunStageRequest {
  readonly capabilityId: string
  readonly source: UsvdsSourcePin
  readonly stageId: string
  readonly context: UsvdsExecutionContext
  readonly inputArtifacts: readonly UsvdsArtifactReference[]
}

export interface UsvdsStageError {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
}

/** Results echo the executing source and request identity for provenance. */
export type UsvdsRunStageResult =
  | {
      readonly status: 'completed'
      readonly source: UsvdsSourcePin
      readonly context: UsvdsExecutionContext
      readonly outputArtifacts: readonly UsvdsArtifactReference[]
      readonly error?: never
    }
  | {
      readonly status: 'failed'
      readonly source: UsvdsSourcePin
      readonly context: UsvdsExecutionContext
      readonly error: UsvdsStageError
      readonly outputArtifacts?: never
    }

/** Declaration only: composition must supply any future external implementation. */
export interface UsvdsStagePort {
  readonly capability: UsvdsCapabilityMetadata
  runStage(request: UsvdsRunStageRequest): Promise<UsvdsRunStageResult>
}
