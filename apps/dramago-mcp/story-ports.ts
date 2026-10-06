/** Internal application boundary only; not a model/provider or public domain schema. */
export type StoryAuth = Readonly<{
  tenantId: string;
  subjectId: string;
  clientId: string;
  scopes: readonly string[];
  defaultWorkspaceId?: string;
}>;

/** Domain payloads and exact refs pass through without projection or normalization. */
export type StoryCommand = Readonly<Record<string, unknown> & {
  idempotency_key: string;
  expected_revision: number;
  workspace_id?: string;
}>;

/** The catalog's creative_run_id result kind uses the durable run_id wire field. */
export type StoryRunResult = Readonly<Record<string, unknown> & { run_id: string }>;

export interface StoryWriterPort {
  runStoryStep(auth: StoryAuth, input: StoryCommand): StoryRunResult | Promise<StoryRunResult>;
}

export interface StoryReviewerPort {
  reviewPlanning(auth: StoryAuth, input: StoryCommand): StoryRunResult | Promise<StoryRunResult>;
}

/**
 * Explicit roles: no writer fallback for review and no approval capability.
 * Injected applications own independent review, research policy, immutable facts,
 * exact refs/scope, durable idempotency and transactional revision checks.
 * Omitted roles remain unimplemented; composition never fabricates a service.
 */
export interface StoryService {
  readonly writer?: StoryWriterPort;
  readonly reviewer?: StoryReviewerPort;
}
