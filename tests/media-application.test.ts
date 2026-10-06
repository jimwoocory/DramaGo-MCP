import { describe, expect, it } from "vitest";
import { InMemoryMediaStore } from "../packages/media-core/src/index.js";
import { Asset, ModelCatalogEntry } from "../packages/contracts/src/index.js";
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
function fixture(inputSchema: Record<string, unknown> = image.inputSchema) {
  const jobs = new InMemoryMediaStore();
  jobs.addWorkspace({ id: "ws-a", tenantId: auth.tenantId, name: "A", status: "active" }, [auth.subjectId, "other"]);
  jobs.addWorkspace({ id: "ws-b", tenantId: auth.tenantId, name: "B", status: "active" }, ["other"]);
  const assets = new Map<string, Asset>();
  const store = new InMemoryMediaApplicationStore(jobs, {
    async findAsset(_auth, id) { return structuredClone(assets.get(id)); },
  });
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
    async get(id: string) { const model = [image, video].find(m => m.publicModelId === id); return model && { ...model, inputSchema }; },
  } });
  return { jobs, store, service, spend, assets, setNow: (value: Date) => { now = value; } };
}
const quoteInput = { publicModelId: "image-v1", idempotencyKey: "quote-key-00000001", request: { prompt: "a kite", outputCount: 1 } };

const readyAsset = (id: string): Asset => ({
  id, tenantId: auth.tenantId, workspaceId: "ws-a", kind: "input", status: "ready",
  createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
});
const requestSchema = {
  type: "object", required: ["prompt"], additionalProperties: false,
  properties: {
    prompt: { type: "string", minLength: 1, maxLength: 80 },
    outputCount: { type: "integer", minimum: 1, maximum: 4 },
    options: { type: "object", properties: { quality: { enum: ["high", "low"] } }, additionalProperties: false },
    input_asset_ids: { type: "array", items: { type: "string" }, maxItems: 4 },
  },
};

async function queued(f: ReturnType<typeof fixture>) {
  const quote = await f.service.quoteCreate(auth, quoteInput);
  return f.service.generateImage(auth, { quoteId: quote.id, requestHash: quote.requestHash,
    confirmQuote: true, request: quoteInput.request, idempotencyKey: "generate-key-0001" });
}

describe("generic Media application", () => {
  it("fails closed when an asset lookup adapter is not configured", async () => {
    const jobs = new InMemoryMediaStore();
    jobs.addWorkspace({ id: "ws-a", tenantId: auth.tenantId, name: "A", status: "active" }, [auth.subjectId]);
    const service = new MediaApplicationService({
      store: new InMemoryMediaApplicationStore(jobs), spend: fixture().spend,
      catalog: { async list() { return [image]; }, async get() { return image; } },
    });
    await expect(service.quoteCreate(auth, { ...quoteInput, request: { input_asset_ids: ["missing"] } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.assetGet(auth, "missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("rechecks assets after asynchronous spend verification", async () => {
    const f = fixture();
    f.assets.set("asset-1", readyAsset("asset-1"));
    const request = { prompt: "kite", input_asset_ids: ["asset-1"] };
    const quote = await f.service.quoteCreate(auth, { ...quoteInput, request, publicModelId: "video-v1" });
    f.spend.verify = async () => { f.assets.delete("asset-1"); return true; };
    await expect(f.service.generateVideo(auth, { quoteId: quote.id, requestHash: quote.requestHash,
      confirmQuote: true, request, idempotencyKey: "generate-key-0001" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.jobs.jobs).toHaveLength(0);
    expect(f.jobs.outbox).toHaveLength(0);
  });
  it("uses the frozen schema and preserves a successful replay after spend revocation", async () => {
    const schema = structuredClone(requestSchema);
    const f = fixture(schema);
    const quote = await f.service.quoteCreate(auth, quoteInput);
    schema.properties.prompt.type = "integer";
    const input = { quoteId: quote.id, requestHash: quote.requestHash, confirmQuote: true as const,
      request: quoteInput.request, idempotencyKey: "generate-key-0001" };
    const first = await f.service.generateImage(auth, input);
    f.spend.verify = async () => { throw new Error("must not reauthorize original success"); };
    f.setNow(new Date("2026-01-03T00:00:00Z"));
    expect(await f.service.generateImage(auth, input)).toEqual(first);
    expect(f.jobs.jobs).toHaveLength(1);
  });
  it("records one cancellation intent and replays concurrent retries", async () => {
    const f = fixture();
    const created = await queued(f);
    const input = { jobId: created.jobId, idempotencyKey: "cancel-key-000001" };
    const [first, retry] = await Promise.all([f.service.jobCancel(auth, input), f.service.jobCancel(auth, input)]);
    expect(first).toEqual({ jobId: created.jobId, status: "cancel_requested" });
    expect(retry).toEqual(first);
    expect(await f.service.jobGet(auth, created.jobId)).toMatchObject({ status: "cancel_requested", version: 2 });
    expect(await f.service.jobCancel(auth, { ...input, idempotencyKey: "cancel-key-000002" })).toEqual(first);
    expect(f.jobs.jobs[0].version).toBe(2);
    f.jobs.jobs.push({ ...structuredClone(f.jobs.jobs[0]), id: "another-job" });
    await expect(f.service.jobCancel(auth, { ...input, jobId: "another-job" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    f.jobs.jobs[0].status = "cancelled";
    expect(await f.service.jobCancel(auth, input)).toEqual(first);
    expect(await f.service.jobCancel(auth, { ...input, idempotencyKey: "cancel-key-000003" })).toEqual({ jobId: created.jobId, status: "cancelled" });
  });
  it.each(["submitting", "submitted", "running", "unknown", "reconciling"] as const)("records cancellation from %s", async status => {
    const f = fixture();
    const created = await queued(f);
    f.jobs.jobs[0].status = status;
    await expect(f.service.jobCancel(auth, { jobId: created.jobId, idempotencyKey: "cancel-key-000001" })).resolves.toMatchObject({ status: "cancel_requested" });
  });
  it.each(["succeeded", "failed", "cancelled"] as const)("does not overwrite terminal %s", async status => {
    const f = fixture();
    const created = await queued(f);
    f.jobs.jobs[0].status = status;
    await expect(f.service.jobCancel(auth, { jobId: created.jobId, idempotencyKey: "cancel-key-000001" })).resolves.toEqual({ jobId: created.jobId, status });
    expect(f.jobs.jobs[0].version).toBe(1);
  });
  it("checks cancellation ownership, workspace, membership, key and scope before mutation or replay", async () => {
    const f = fixture();
    const created = await queued(f);
    const input = { jobId: created.jobId, idempotencyKey: "cancel-key-000001" };
    for (const other of [{ ...auth, tenantId: "tenant-b" }, { ...auth, subjectId: "other" }]) {
      await expect(f.service.jobCancel(other, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(f.service.jobCancel({ ...auth, scopes: [] }, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.service.jobCancel(auth, { ...input, workspaceId: "ws-b" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(f.service.jobCancel(auth, { ...input, jobId: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(f.service.jobCancel(auth, { ...input, idempotencyKey: "short" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(f.jobs.jobs[0]).toMatchObject({ status: "queued", version: 1 });
    await f.service.jobCancel(auth, input);
    f.jobs.workspaces[0].status = "disabled";
    await expect(f.service.jobCancel(auth, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(f.service.jobGet(auth, created.jobId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("rolls back a failed cancellation without consuming its idempotency key", async () => {
    const f = fixture();
    const created = await queued(f);
    const update = f.jobs.updateJob.bind(f.jobs);
    f.jobs.updateJob = async job => { await update(job); throw new Error("write failure"); };
    const input = { jobId: created.jobId, idempotencyKey: "cancel-key-000001" };
    await expect(f.service.jobCancel(auth, input)).rejects.toThrow("write failure");
    expect(f.jobs.jobs[0]).toMatchObject({ status: "queued", version: 1 });
    f.jobs.updateJob = update;
    await expect(f.service.jobCancel(auth, input)).resolves.toMatchObject({ status: "cancel_requested" });
  });
  it("reads detached jobs and assets via generic application methods", async () => {
    const f = fixture();
    const created = await queued(f);
    const job = await f.service.jobGet(auth, created.jobId);
    expect(job).toMatchObject({ id: created.jobId, workspaceId: "ws-a", status: "queued" });
    job.frozenRequest.prompt = "mutated";
    expect((await f.service.jobGet(auth, created.jobId)).frozenRequest).toEqual(quoteInput.request);
    f.assets.set("asset-1", readyAsset("asset-1"));
    const asset = await f.service.assetGet(auth, "asset-1");
    expect(asset).toEqual(readyAsset("asset-1"));
    asset.status = "deleted";
    expect((await f.service.assetGet(auth, "asset-1")).status).toBe("ready");
    // Assets have workspace ownership, not an invented subject/project owner.
    expect(await f.service.assetGet({ ...auth, subjectId: "other" }, "asset-1")).toEqual(readyAsset("asset-1"));
  });
  it("isolates job owners and asset workspaces and enforces read scopes", async () => {
    const f = fixture();
    const created = await queued(f);
    f.assets.set("asset-1", readyAsset("asset-1"));
    for (const other of [{ ...auth, tenantId: "tenant-b" }, { ...auth, subjectId: "other" }]) {
      await expect(f.service.jobGet(other, created.jobId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    for (const other of [{ ...auth, tenantId: "tenant-b" }, { ...auth, subjectId: "outsider" }]) {
      await expect(f.service.assetGet(other, "asset-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    for (const method of ["jobGet", "assetGet"] as const) {
      const id = method === "jobGet" ? created.jobId : "asset-1";
      await expect(f.service[method]({ ...auth, scopes: [] }, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(f.service[method](auth, "missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(f.service[method](auth, id, "ws-b")).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    f.assets.set("foreign", { ...readyAsset("foreign"), tenantId: "tenant-b" });
    await expect(f.service.assetGet(auth, "foreign")).rejects.toMatchObject({ code: "NOT_FOUND" });
    f.assets.set("foreign", { ...readyAsset("foreign"), workspaceId: "ws-b" });
    await expect(f.service.assetGet(auth, "foreign")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  describe.each(["quote", "evidence"])("%s expiry", resource => {
    it.each(["verify", "core authorization", "core idempotency", "core persistence"])("rejects expiry during %s and rolls back all facts", async stage => {
      const { service, store, jobs, spend, setNow } = fixture();
      const quote = await service.quoteCreate(auth, quoteInput);
      const boundary = quote.expiresAt;
      if (resource === "evidence") {
        await store.transaction(async tx => {
          const stored = (await tx.getQuote(quote.id))!;
          stored.spendEvidence.expiresAt = boundary;
          stored.expiresAt = new Date(boundary.getTime() + 60_000);
          await tx.putQuote(stored);
        });
      }
      let verified = false;
      spend.verify = async () => {
        verified = true;
        if (stage === "verify") setNow(boundary);
        return true;
      };
      const authorize = jobs.authorize.bind(jobs);
      jobs.authorize = async (...args) => {
        const result = await authorize(...args);
        if (stage === "core authorization" && verified) setNow(boundary);
        return result;
      };
      const find = jobs.findIdempotency.bind(jobs);
      jobs.findIdempotency = async (...args) => {
        const result = await find(...args);
        if (stage === "core idempotency") setNow(boundary);
        return result;
      };
      const persist = jobs.persistCreatedJob.bind(jobs);
      let persistenceCalls = 0;
      jobs.persistCreatedJob = async (...args) => {
        persistenceCalls++;
        if (stage === "core persistence") setNow(boundary);
        return persist(...args);
      };
      const input = { quoteId: quote.id, requestHash: quote.requestHash, confirmQuote: true as const,
        request: quoteInput.request, idempotencyKey: "generate-key-0001" };
      await expect(service.generateImage(auth, input)).rejects.toMatchObject({ code: resource === "quote" ? "VALIDATION_ERROR" : "FORBIDDEN" });
      expect(verified).toBe(true);
      if (stage !== "core persistence") expect(persistenceCalls).toBe(0);
      expect(jobs.jobs).toHaveLength(0);
      expect(jobs.providerExecutions).toHaveLength(0);
      expect(jobs.outbox).toHaveLength(0);
      expect(jobs.audits).toHaveLength(0);
      expect(jobs.idempotency).toHaveLength(0);
      expect((await service.quoteGet(auth, quote.id)).status).toBe("reserved");
      // A rejected attempt must not consume either the quote or the application key.
      setNow(new Date("2026-01-01T00:00:00Z"));
      spend.verify = async () => true;
      jobs.authorize = authorize;
      jobs.findIdempotency = find;
      jobs.persistCreatedJob = persist;
      await expect(service.generateImage(auth, input)).resolves.toMatchObject({ status: "queued" });
    });
  });
  describe.each(["input_asset_ids", "inputAssetIds"])("%s asset references", field => {
    it.each<[string, Partial<Asset> | undefined, string]>([
      ["missing", undefined, "NOT_FOUND"],
      ["foreign tenant", { tenantId: "tenant-b" }, "NOT_FOUND"],
      ["foreign workspace", { workspaceId: "ws-b" }, "NOT_FOUND"],
      ...(["pending_upload", "processing", "rejected", "deleted"] as const).map<[string, Partial<Asset>, string]>(status => [status, { status }, "ASSET_NOT_READY"]),
    ])("rejects %s at quote and generation", async (_label, change, code) => {
      const { service, jobs, assets } = fixture();
      // Both workspaces are accessible; membership must not allow cross-workspace references.
      jobs.addWorkspace({ id: "ws-b", tenantId: auth.tenantId, name: "B", status: "active" }, [auth.subjectId]);
      const request = { prompt: "kite", [field]: ["asset-1"] };
      const asset = readyAsset("asset-1");
      const invalid: Asset | undefined = change ? { ...asset, ...change } : undefined;
      if (invalid) assets.set(asset.id, invalid);
      await expect(service.quoteCreate(auth, { ...quoteInput, request })).rejects.toMatchObject({ code });
      assets.set(asset.id, asset);
      const quote = await service.quoteCreate(auth, { ...quoteInput, request });
      if (invalid) assets.set(asset.id, invalid); else assets.delete(asset.id);
      await expect(service.generateImage(auth, {
        quoteId: quote.id, requestHash: quote.requestHash, confirmQuote: true,
        request, idempotencyKey: "generate-key-0001",
      })).rejects.toMatchObject({ code });
      expect(jobs.jobs).toHaveLength(0);
      expect(jobs.outbox).toHaveLength(0);
      expect((await service.quoteGet(auth, quote.id)).status).toBe("reserved");
    });
    it.each([null, "asset-1", [42], [""], [false]].map(ids => [ids]))("rejects malformed asset references: %j", async ids => {
      const { service } = fixture();
      await expect(service.quoteCreate(auth, { ...quoteInput, request: { prompt: "kite", [field]: ids } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });
  });
  it("checks both asset spellings instead of allowing one to hide the other", async () => {
    const { service, assets } = fixture();
    assets.set("asset-1", readyAsset("asset-1"));
    await expect(service.quoteCreate(auth, { ...quoteInput, request: {
      prompt: "kite", inputAssetIds: ["asset-1"], input_asset_ids: ["missing"],
    } })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it.each([
    { prompt: 42 }, { prompt: null }, { prompt: [] }, {}, { prompt: "" },
    { prompt: "x".repeat(81) }, { prompt: "ok", outputCount: 1.5 },
    { prompt: "ok", outputCount: 0 }, { prompt: "ok", outputCount: 5 },
    { prompt: "ok", extra: true }, { prompt: "ok", options: { quality: "wrong" } },
    { prompt: "ok", input_asset_ids: [42] },
  ])("rejects invalid model input before spend authorization: %j", async request => {
    const { service, spend, jobs } = fixture(requestSchema);
    let authorizations = 0;
    const authorize = spend.authorize;
    spend.authorize = async (...args) => { authorizations++; return authorize(...args); };
    await expect(service.quoteCreate(auth, { ...quoteInput, request })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(authorizations).toBe(0);
    expect(jobs.jobs).toHaveLength(0);
  });
  it.each([
    { type: "strnig" }, { type: "string", minLength: -1 }, { required: "prompt" },
    { properties: { absent: { format: "email" } } }, { additionalProperties: 1 },
    { allOf: [] }, { properties: { absent: { type: "array", items: 42 } } },
  ])("fails closed on unsupported or malformed schemas: %j", async schema => {
    const { service } = fixture(schema);
    await expect(service.quoteCreate(auth, quoteInput)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it("validates valid nested inputs without coercing or trimming them", async () => {
    const { service } = fixture(requestSchema);
    const request = { prompt: "  kite  ", outputCount: 2, options: { quality: "high" } };
    expect((await service.quoteCreate(auth, { ...quoteInput, request })).normalizedRequest).toEqual(request);
  });
  it("validates the frozen model schema again during generation", async () => {
    const { service, store, jobs } = fixture();
    const quote = await service.quoteCreate(auth, quoteInput);
    await store.transaction(async tx => {
      const stored = (await tx.getQuote(quote.id))!;
      stored.model.inputSchema = { type: "object", properties: { prompt: { type: "integer" } } };
      await tx.putQuote(stored);
    });
    await expect(service.generateImage(auth, {
      quoteId: quote.id, requestHash: quote.requestHash, confirmQuote: true,
      request: quoteInput.request, idempotencyKey: "generate-key-0001",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(jobs.outbox).toHaveLength(0);
  });
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
    const { service, jobs, setNow, assets } = fixture();
    for (const id of ["asset-1", "asset-2"]) assets.set(id, readyAsset(id));
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
    assets.clear();
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
