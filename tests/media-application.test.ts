import { describe, expect, it } from "vitest";
import { InMemoryMediaStore } from "../packages/media-core/src/index.js";
import { ModelCatalogEntry } from "../packages/contracts/src/index.js";
import { MediaApplicationService, InMemoryMediaApplicationStore } from "../packages/media-application/src/index.js";

const auth = {
  tenantId: "tenant-a", subjectId: "subject-a", clientId: "test", defaultWorkspaceId: "ws-a",
  scopes: ["media.models.read", "media.quotes.create", "media.generate.image", "media.generate.video", "media.jobs.read", "media.assets.read", "media.jobs.cancel", "media.assets.write"],
};
const image: ModelCatalogEntry = {
  id: "image-entry", publicModelId: "image-v1", version: "1", providerId: "fake", providerModelId: "fake-image",
  capability: "image_generation", inputSchema: {}, pricingRuleVersion: "price-1", availability: "available", limits: {},
  features: { supportsWebhook: false, supportsCancel: true, supportsProviderIdempotency: true },
};
const video: ModelCatalogEntry = { ...image, id: "video-entry", publicModelId: "video-v1", providerModelId: "fake-video", capability: "video_generation" };
function fixture() {
  const jobs = new InMemoryMediaStore();
  jobs.addWorkspace({ id: "ws-a", tenantId: auth.tenantId, name: "A", status: "active" }, [auth.subjectId, "other"]);
  jobs.addWorkspace({ id: "ws-b", tenantId: auth.tenantId, name: "B", status: "active" }, ["other"]);
  const store = new InMemoryMediaApplicationStore(jobs);
  let now = new Date("2026-01-01T00:00:00Z");
  const spend = {
    async authorize(_auth: typeof auth, input: { workspaceId: string; requestHash: string }) {
      return { reference: "budget-grant", tenantId: auth.tenantId, subjectId: auth.subjectId, workspaceId: input.workspaceId,
        requestHash: input.requestHash, mode: "preauthorized_workspace_budget" as const,
        maxCharge: { currency: "USD", amountMinor: 10 }, expiresAt: new Date("2026-01-02T00:00:00Z") };
    },
    async verify() { return true; },
  };
  const service = new MediaApplicationService({ store, spend, now: () => now, quoteTtlMs: 60_000, catalog: {
    async list() { return [image, video]; },
    async get(id: string) { return [image, video].find(m => m.publicModelId === id); },
  } });
  return { jobs, store, service, spend, setNow: (value: Date) => { now = value; } };
}
const quoteInput = { publicModelId: "image-v1", idempotencyKey: "quote-key-00000001", request: { prompt: "a kite", outputCount: 1 } };

describe("generic Media application", () => {
  it("creates a detached, normalized, expiring quote and replays identical concurrent retries", async () => {
    const { service } = fixture();
    const [first, retry] = await Promise.all([
      service.quoteCreate(auth, quoteInput),
      service.quoteCreate(auth, { ...quoteInput, request: { outputCount: 1, prompt: "a kite" } }),
    ]);
    expect(retry).toEqual(first);
    expect(first).toMatchObject({ status: "reserved", normalizedRequest: quoteInput.request, maxCharge: { currency: "USD", amountMinor: 10 } });
    expect(first.expiresAt).toEqual(new Date("2026-01-01T00:01:00Z"));
    first.normalizedRequest.prompt = "mutated";
    expect((await service.quoteGet(auth, first.id)).normalizedRequest).toEqual(quoteInput.request);
    await expect(service.quoteCreate(auth, { ...quoteInput, request: { prompt: "changed" } })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("generates exactly one core job with explicit spend confirmation and generic request fields", async () => {
    const { service, jobs, setNow } = fixture();
    const request = { prompt: "  a kite  ", inputAssetIds: ["asset-2", "asset-1"], options: { seed: 4, quality: "high" } };
    const quote = await service.quoteCreate(auth, { ...quoteInput, request });
    const input = { quoteId: quote.id, requestHash: quote.requestHash, confirmQuote: true as const, request, idempotencyKey: "generate-key-0001" };
    const [first, retry] = await Promise.all([service.generateImage(auth, input), service.generateImage(auth, input)]);
    expect(retry).toEqual(first);
    expect(jobs.jobs).toHaveLength(1);
    expect(jobs.jobs[0]).toMatchObject({ quoteId: quote.id, kind: "image", frozenRequest: request });
    expect(jobs.providerExecutions[0]).toMatchObject({ providerId: "fake", providerModelId: "fake-image" });
    expect(jobs.outbox).toHaveLength(1);
    expect((await service.quoteGet(auth, quote.id)).confirmation).toMatchObject({ subjectId: auth.subjectId, clientId: auth.clientId, requestHash: quote.requestHash, evidenceReference: "budget-grant" });
    expect(first).toEqual({ jobId: jobs.jobs[0].id, status: "queued", quoteId: quote.id, requestHash: quote.requestHash });
    setNow(new Date("2026-01-03T00:00:00Z"));
    expect(await service.generateImage(auth, input)).toEqual(first);
  });
  it.each([
    ["request mismatch", { request: { prompt: "different" } }, "VALIDATION_ERROR"],
    ["hash mismatch", { requestHash: "wrong" }, "VALIDATION_ERROR"],
    ["missing confirmation", { confirmQuote: undefined }, "FORBIDDEN"],
    ["creative approval is not spend confirmation", { confirmQuote: undefined, approval: "PASS", adopted: true }, "FORBIDDEN"],
    ["false confirmation", { confirmQuote: false }, "FORBIDDEN"],
  ])("rejects %s before creating any core facts", async (_label, change, code) => {
    const { service, jobs } = fixture();
    const quote = await service.quoteCreate(auth, quoteInput);
    const input = { quoteId: quote.id, requestHash: quote.requestHash, confirmQuote: true, request: quoteInput.request, idempotencyKey: "generate-key-0001", ...change };
    await expect(service.generateImage(auth, input as never)).rejects.toMatchObject({ code });
    expect(jobs.jobs).toHaveLength(0);
    expect(jobs.outbox).toHaveLength(0);
    expect((await service.quoteGet(auth, quote.id)).status).toBe("reserved");
  });
  it("rejects a quote at the exact expiry boundary", async () => {
    const { service, jobs, setNow } = fixture();
    const quote = await service.quoteCreate(auth, quoteInput);
    setNow(quote.expiresAt);
    await expect(service.generateImage(auth, { quoteId: quote.id, requestHash: quote.requestHash, confirmQuote: true, request: quoteInput.request, idempotencyKey: "generate-key-0001" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(jobs.jobs).toHaveLength(0);
  });
  it("rechecks trusted budget authority instead of inferring spend from workspace membership", async () => {
    const { service, jobs, spend } = fixture();
    const quote = await service.quoteCreate(auth, quoteInput);
    spend.verify = async () => false;
    await expect(service.generateImage(auth, { quoteId: quote.id, requestHash: quote.requestHash, confirmQuote: true, request: quoteInput.request, idempotencyKey: "generate-key-0001" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(jobs.jobs).toHaveLength(0);
  });
  it("creates video jobs only from video quotes and consumes a quote once", async () => {
    const { service, jobs } = fixture();
    const quote = await service.quoteCreate(auth, { ...quoteInput, publicModelId: "video-v1" });
    const input = { quoteId: quote.id, requestHash: quote.requestHash, confirmQuote: true as const, request: quoteInput.request, idempotencyKey: "generate-key-0001" };
    await expect(service.generateImage(auth, input)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const result = await service.generateVideo(auth, input);
    expect(jobs.jobs[0]).toMatchObject({ id: result.jobId, kind: "video", publicModelId: "video-v1" });
    await expect(service.generateVideo(auth, { ...input, idempotencyKey: "generate-key-0002" })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await expect(service.generateVideo(auth, { ...input, request: { prompt: "changed" } })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(jobs.jobs).toHaveLength(1);
  });
  it.each([
    { ...auth, tenantId: "tenant-b" },
    { ...auth, subjectId: "other" },
    { ...auth, clientId: "other" },
  ])("hides quote ownership from other principals: %j", async other => {
    const { service, jobs } = fixture();
    const quote = await service.quoteCreate(auth, quoteInput);
    await expect(service.quoteGet(other, quote.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.generateImage(other, { quoteId: quote.id, requestHash: quote.requestHash, confirmQuote: true, request: quoteInput.request, idempotencyKey: "generate-key-0001" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(jobs.jobs).toHaveLength(0);
  });
  it("isolates workspaces even for a subject who is a member of both", async () => {
    const { service } = fixture();
    await expect(service.quoteCreate(auth, { ...quoteInput, workspaceId: "ws-b" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const quote = await service.quoteCreate(auth, quoteInput);
    await expect(service.generateImage(auth, { workspaceId: "ws-b", quoteId: quote.id, requestHash: quote.requestHash, confirmQuote: true, request: quoteInput.request, idempotencyKey: "generate-key-0001" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("reads detached model catalog entries only with the model scope", async () => {
    const { service } = fixture();
    expect(await service.modelsList(auth, { capability: "image_generation" })).toEqual([image]);
    const model = await service.modelsGet(auth, "image-v1");
    model.limits.changed = true;
    expect(await service.modelsGet(auth, "image-v1")).toEqual(image);
    await expect(service.modelsList({ ...auth, scopes: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.modelsGet(auth, "missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
