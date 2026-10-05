import type { AuthContext, ModelCatalogEntry, Quote, Workspace } from "@xiaoshuren/contracts";
import type { JobStore } from "@xiaoshuren/media-core";

export interface ModelCatalogPort {
  list(): Promise<ModelCatalogEntry[]>;
  get(publicModelId: string): Promise<ModelCatalogEntry | undefined>;
}
export type Charge = { currency: string; amountMinor: number };
export type SpendEvidence = {
  reference: string; tenantId: string; subjectId: string; workspaceId: string; requestHash: string;
  mode: "preauthorized_workspace_budget"; maxCharge: Charge; expiresAt: Date;
};
/** Trusted server-side budget authority, never supplied by a tool caller.
 * authorize must be side-effect-free (or already reserved/idempotent in the host).
 * This package does not implement budget reservation, settlement or refunds.
 */
export interface SpendAuthorizationPort {
  authorize(auth: AuthContext, input: { workspaceId: string; requestHash: string; model: ModelCatalogEntry; request: Record<string, unknown> }): Promise<SpendEvidence>;
  verify(auth: AuthContext, evidence: SpendEvidence): Promise<boolean>;
}
export type MediaQuote = Quote & {
  clientId: string; model: ModelCatalogEntry; maxCharge: Charge; spendEvidence: SpendEvidence; createdAt: Date;
  confirmation?: { subjectId: string; clientId: string; confirmedAt: Date; requestHash: string; evidenceReference: string };
  jobId?: string;
};
export type ApplicationIdempotency = { scope: string; key: string; requestHash: string; result: unknown };
export type MediaResource = { workspaceId?: string };
export interface MediaApplicationTransaction {
  /** Transaction-bound core store; must participate in the SAME commit/rollback. */
  jobs: JobStore;
  authorize(auth: AuthContext, action: string, resource: MediaResource): Promise<Workspace>;
  findIdempotency(scope: string, key: string): Promise<ApplicationIdempotency | undefined>;
  putIdempotency(record: ApplicationIdempotency): Promise<void>;
  getQuote(id: string): Promise<MediaQuote | undefined>;
  putQuote(quote: MediaQuote): Promise<void>;
}
export interface MediaApplicationStore {
  /** Serialize conflicting commands; atomically commit quotes, idempotency AND core job/outbox writes. */
  transaction<T>(fn: (tx: MediaApplicationTransaction) => Promise<T>): Promise<T>;
}
export type QuoteCreateInput = { workspaceId?: string; publicModelId: string; request: Record<string, unknown>; idempotencyKey: string };
