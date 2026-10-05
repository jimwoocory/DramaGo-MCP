import { randomUUID } from "node:crypto";
import { AuthContext, Capability, DomainError, ModelCatalogEntry, stableHash } from "@xiaoshuren/contracts";
import { JobService } from "@xiaoshuren/media-core";
import type { MediaApplicationStore, MediaApplicationTransaction, MediaQuote, ModelCatalogPort, QuoteCreateInput, SpendAuthorizationPort } from "./ports.js";
export * from "./ports.js";
export { InMemoryMediaApplicationStore } from "./memory-store.js";

/** Canonical JSON only: no coercion, dropped values, prompt trimming or injected domain metadata. */
export function normalizeRequest(request: Record<string, unknown>): Record<string, unknown> {
  const visit = (value: unknown, ancestors: Set<object>): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object" || value === null || ancestors.has(value)) throw new DomainError("VALIDATION_ERROR", "Request must contain finite JSON values");
    const next = new Set(ancestors).add(value);
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) throw new DomainError("VALIDATION_ERROR", "Sparse arrays are not JSON");
      return value.map(v => visit(v, next));
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new DomainError("VALIDATION_ERROR", "Request must contain plain JSON objects");
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, visit((value as Record<string, unknown>)[key], next)]));
  };
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new DomainError("VALIDATION_ERROR", "Request must be an object");
  return visit(request, new Set()) as Record<string, unknown>;
}
export type GenerateInput = { workspaceId?: string; quoteId: string; requestHash: string; confirmQuote: true; request: Record<string, unknown>; idempotencyKey: string };
export type GenerateResult = { jobId: string; status: "queued"; quoteId: string; requestHash: string };
export interface MediaApplicationOptions {
  store: MediaApplicationStore;
  catalog: ModelCatalogPort;
  spend?: SpendAuthorizationPort;
  now?: () => Date;
  quoteTtlMs?: number;
}
export class MediaApplicationService {
  constructor(private readonly options: MediaApplicationOptions) {}
  private now(): Date { return new Date(this.options.now?.() ?? new Date()); }
  private scope(auth: AuthContext, scope: string): void {
    if (!auth.scopes.includes(scope)) throw new DomainError("FORBIDDEN", "Required scope is missing");
  }
  private key(key: string): void {
    if (typeof key !== "string" || key.length < 16 || key.length > 128) throw new DomainError("VALIDATION_ERROR", "idempotency key must be 16..128 characters");
  }
  private scopeKey(auth: AuthContext, action: string): string { return JSON.stringify([auth.tenantId, auth.subjectId, auth.clientId, action]); }
  private async replay<T>(tx: MediaApplicationTransaction, scope: string, key: string, hash: string): Promise<{ result: T } | undefined> {
    const previous = await tx.findIdempotency(scope, key);
    if (!previous) return undefined;
    if (previous.requestHash !== hash) throw new DomainError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for another request");
    return { result: structuredClone(previous.result) as T };
  }
  async modelsList(auth: AuthContext, input: { capability?: Capability } = {}): Promise<ModelCatalogEntry[]> {
    this.scope(auth, "media.models.read");
    return structuredClone((await this.options.catalog.list()).filter(m => !input.capability || m.capability === input.capability));
  }
  async modelsGet(auth: AuthContext, publicModelId: string): Promise<ModelCatalogEntry> {
    this.scope(auth, "media.models.read");
    const model = await this.options.catalog.get(publicModelId);
    if (!model) throw new DomainError("NOT_FOUND", "Model not found");
    return structuredClone(model);
  }
  private requestHash(workspaceId: string, model: ModelCatalogEntry, request: Record<string, unknown>): string {
    return stableHash({ workspaceId, publicModelId: model.publicModelId, version: model.version, capability: model.capability,
      providerId: model.providerId, providerModelId: model.providerModelId, pricingRuleVersion: model.pricingRuleVersion, request });
  }
  async quoteCreate(auth: AuthContext, input: QuoteCreateInput): Promise<MediaQuote> {
    this.key(input.idempotencyKey);
    const request = normalizeRequest(input.request);
    return this.options.store.transaction(async tx => {
      const workspace = await tx.authorize(auth, "media.quotes.create", input);
      const scope = this.scopeKey(auth, "quote_create");
      const hash = stableHash({ workspaceId: workspace.id, publicModelId: input.publicModelId, request });
      const previous = await this.replay<MediaQuote>(tx, scope, input.idempotencyKey, hash);
      if (previous) return previous.result;
      const model = structuredClone(await this.options.catalog.get(input.publicModelId));
      if (!model) throw new DomainError("NOT_FOUND", "Model not found");
      if (model.availability !== "available" || !["image_generation", "video_generation"].includes(model.capability)) throw new DomainError("VALIDATION_ERROR", "Model unavailable or unsupported");
      if (!this.options.spend) throw new DomainError("FORBIDDEN", "A spend authority is required");
      const requestHash = this.requestHash(workspace.id, model, request);
      const spendEvidence = structuredClone(await this.options.spend.authorize(auth, { workspaceId: workspace.id, requestHash, model: structuredClone(model), request: structuredClone(request) }));
      const now = this.now();
      if (spendEvidence.tenantId !== auth.tenantId || spendEvidence.subjectId !== auth.subjectId || spendEvidence.workspaceId !== workspace.id || spendEvidence.requestHash !== requestHash || spendEvidence.mode !== "preauthorized_workspace_budget" || !spendEvidence.reference || !(spendEvidence.expiresAt instanceof Date) || !(spendEvidence.expiresAt.getTime() > now.getTime())) throw new DomainError("FORBIDDEN", "Invalid spend evidence");
      if (!spendEvidence.maxCharge?.currency || !Number.isSafeInteger(spendEvidence.maxCharge.amountMinor) || spendEvidence.maxCharge.amountMinor < 0) throw new DomainError("VALIDATION_ERROR", "Invalid maximum charge");
      const ttl = this.options.quoteTtlMs ?? 300_000;
      if (!Number.isSafeInteger(ttl) || ttl <= 0) throw new DomainError("VALIDATION_ERROR", "Invalid quote lifetime");
      const quote: MediaQuote = { id: randomUUID(), tenantId: auth.tenantId, subjectId: auth.subjectId, clientId: auth.clientId,
        workspaceId: workspace.id, publicModelId: model.publicModelId, requestHash, normalizedRequest: request,
        pricingRuleVersion: model.pricingRuleVersion, status: "reserved", expiresAt: new Date(Math.min(now.getTime() + ttl, spendEvidence.expiresAt.getTime())),
        model, spendEvidence, maxCharge: structuredClone(spendEvidence.maxCharge), createdAt: now };
      await tx.putQuote(quote);
      await tx.putIdempotency({ scope, key: input.idempotencyKey, requestHash: hash, result: quote });
      return structuredClone(quote);
    });
  }
  generateImage(auth: AuthContext, input: GenerateInput): Promise<GenerateResult> { return this.generate(auth, input, "image"); }
  generateVideo(auth: AuthContext, input: GenerateInput): Promise<GenerateResult> { return this.generate(auth, input, "video"); }
  private async generate(auth: AuthContext, input: GenerateInput, kind: "image" | "video"): Promise<GenerateResult> {
    this.key(input.idempotencyKey);
    const request = normalizeRequest(input.request);
    return this.options.store.transaction(async tx => {
      const quote = await tx.getQuote(input.quoteId);
      if (!quote || quote.tenantId !== auth.tenantId || quote.subjectId !== auth.subjectId || quote.clientId !== auth.clientId || (input.workspaceId !== undefined && input.workspaceId !== quote.workspaceId)) throw new DomainError("NOT_FOUND", "Resource not found");
      const workspace = await tx.authorize(auth, `media.generate.${kind}`, { workspaceId: quote.workspaceId });
      const scope = this.scopeKey(auth, `generate_${kind}`);
      const hash = stableHash({ workspaceId: workspace.id, quoteId: quote.id, requestHash: input.requestHash, confirmQuote: input.confirmQuote, request, kind });
      const previous = await this.replay<GenerateResult>(tx, scope, input.idempotencyKey, hash);
      if (previous) return previous.result;
      if (quote.model.capability !== `${kind}_generation`) throw new DomainError("VALIDATION_ERROR", "Quote capability does not match generation tool");
      if (quote.status !== "reserved" || quote.jobId) throw new DomainError("INVALID_STATE_TRANSITION", "Quote cannot create another job");
      if (input.confirmQuote !== true) throw new DomainError("FORBIDDEN", "Explicit quote confirmation is required");
      if (input.requestHash !== quote.requestHash || this.requestHash(workspace.id, quote.model, request) !== quote.requestHash) throw new DomainError("VALIDATION_ERROR", "Quote request hash mismatch");
      if (!(quote.expiresAt.getTime() > this.now().getTime())) throw new DomainError("VALIDATION_ERROR", "Quote has expired");
      if (!this.options.spend || !(quote.spendEvidence.expiresAt.getTime() > this.now().getTime()) || !await this.options.spend.verify(auth, structuredClone(quote.spendEvidence))) throw new DomainError("FORBIDDEN", "Spend authorization is no longer valid");
      const created = await new JobService(tx.jobs).create(auth, {
        workspaceId: workspace.id, idempotencyKey: stableHash({ scope, key: input.idempotencyKey }),
        request, modelId: quote.publicModelId, quoteId: quote.id, kind,
        providerId: quote.model.providerId, providerModelId: quote.model.providerModelId,
      });
      quote.status = "confirmed";
      quote.jobId = created.jobId;
      quote.confirmation = { subjectId: auth.subjectId, clientId: auth.clientId, confirmedAt: this.now(), requestHash: quote.requestHash, evidenceReference: quote.spendEvidence.reference };
      const result: GenerateResult = { ...created, quoteId: quote.id, requestHash: quote.requestHash };
      await tx.putQuote(quote);
      await tx.putIdempotency({ scope, key: input.idempotencyKey, requestHash: hash, result });
      return result;
    });
  }
  async quoteGet(auth: AuthContext, quoteId: string, workspaceId?: string): Promise<MediaQuote> {
    return this.options.store.transaction(async tx => {
      const quote = await tx.getQuote(quoteId);
      if (!quote || quote.tenantId !== auth.tenantId || quote.subjectId !== auth.subjectId || quote.clientId !== auth.clientId || (workspaceId !== undefined && workspaceId !== quote.workspaceId)) throw new DomainError("NOT_FOUND", "Resource not found");
      await tx.authorize(auth, "media.quotes.create", { workspaceId: quote.workspaceId });
      return structuredClone(quote);
    });
  }
}
