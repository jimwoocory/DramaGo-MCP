import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { InMemoryMediaStore } from "../../packages/media-core/src/index.js";
import { MediaApplicationService, InMemoryMediaApplicationStore } from "../../packages/media-application/src/index.js";
import { Asset, ModelCatalogEntry, stableHash } from "../../packages/contracts/src/index.js";
import { createDramaGoMcp } from "../../apps/dramago-mcp/index.js";
import { fixtureCatalog } from "./helpers/catalog-fixture.mjs";

const auth = { tenantId: "tenant", subjectId: "subject", clientId: "client", defaultWorkspaceId: "ws",
  scopes: ["media.quotes.create", "media.generate.image", "media.generate.video", "media.jobs.read", "media.assets.read"] };
const image: ModelCatalogEntry = { id: "image", publicModelId: "image-v1", version: "1", providerId: "fake", providerModelId: "fake-image",
  capability: "image_generation", inputSchema: {}, pricingRuleVersion: "price-1", availability: "available", limits: {},
  features: { supportsWebhook: false, supportsCancel: false, supportsProviderIdempotency: true } };
const video: ModelCatalogEntry = { ...image, id: "video", publicModelId: "video-v1", capability: "video_generation" };
const now = new Date("2026-01-01T00:00:00Z");
function fixture() {
  const jobs = new InMemoryMediaStore();
  jobs.addWorkspace({ id: "ws", tenantId: auth.tenantId, name: "Workspace", status: "active" }, [auth.subjectId]);
  const asset: Asset = { id: "asset", tenantId: auth.tenantId, workspaceId: "ws", kind: "input", status: "ready",
    storageBucket: "private-bucket", storageKey: "private-key", mimeType: "image/png", byteSize: 42, createdAt: now, updatedAt: now };
  const assets = new Map([[asset.id, asset]]);
  const store = new InMemoryMediaApplicationStore(jobs, { async findAsset(_auth, id) { return structuredClone(assets.get(id)); } });
  const service = new MediaApplicationService({ store, now: () => now, catalog: {
    async get(id) { return [image, video].find(m => m.publicModelId === id); }, async list() { return [image, video]; },
  }, spend: {
    async authorize(context, input) { return { reference: "private-budget-grant", tenantId: context.tenantId, subjectId: context.subjectId,
      workspaceId: input.workspaceId, requestHash: input.requestHash, mode: "preauthorized_workspace_budget",
      maxCharge: { currency: "USD", amountMinor: 10 }, expiresAt: new Date("2026-01-02T00:00:00Z") }; },
    async verify() { return true; },
  } });
  return { service, jobs, assets };
}
async function loadAdapter() {
  expect(existsSync(new URL('../../apps/dramago-mcp/media-ports.ts', import.meta.url)), 'local Media adapter must exist').toBe(true);
  return import('../../apps/dramago-mcp/media-ports.js');
}
const request = { prompt: "  unchanged prompt  ", input_asset_ids: ["asset"], aspect_ratio: "9:16",
  options: { video_resolution: "720p", nested_key: [2, 1], camelCase: "retained" } };
const quoteInput = { public_model_id: "image-v1", idempotency_key: "quote-key-00000001", request };

describe("local Media wire adapter", () => {
  it('fails closed rather than silently ignoring requested asset access URLs', async () => {
    const { createLocalMediaPorts } = await loadAdapter();
    const ports = createLocalMediaPorts(fixture().service);
    await expect(ports.asset_get({ asset_id: 'asset', include_access_url: true }, auth)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    // Authorization still precedes the unsupported projection check.
    await expect(ports.asset_get({ asset_id: 'asset', include_access_url: true }, { ...auth, tenantId: 'other' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('preserves hash sensitivity, explicit confirmation, workspace isolation and original Media errors', async () => {
    const { createLocalMediaPorts } = await loadAdapter();
    const f = fixture();
    const app = createDramaGoMcp({ catalog: fixtureCatalog, mediaPorts: createLocalMediaPorts(f.service), authorize: () => true });
    const quote = (await app.callTool('quote_create', quoteInput, auth)).structuredContent;
    const input = { quote_id: quote.quote_id, request_hash: quote.request_hash, confirm_quote: true, request, idempotency_key: 'generate-key-0001' };
    for (const change of [{ request: { ...request, inputAssetIds: request.input_asset_ids, input_asset_ids: [] } },
      { request: { ...request, prompt: request.prompt.trim() } },
      { request: { ...request, options: { ...request.options, nested_key: [1, 2] } } }]) {
      await expect(app.callTool('generate_image', { ...input, ...change }, auth)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    await expect(app.callTool('generate_image', { ...input, confirm_quote: false }, auth)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(app.callTool('generate_image', { ...input, workspace_id: 'other' }, auth)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(f.jobs.jobs).toHaveLength(0);
    await expect(app.callTool('asset_get', { asset_id: 'asset', workspace_id: 'other' }, auth)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const error = new Error('exact Media error');
    f.service.jobGet = async () => { throw error; };
    await expect(app.callTool('job_get', { job_id: 'job' }, auth)).rejects.toBe(error);
  });
  it.each([['image', image], ['video', video]] as const)("connects all %s write/read DTOs to real MediaApplicationService offline", async (kind, model) => {
    const { createLocalMediaPorts } = await loadAdapter();
    const f = fixture();
    const ports = createLocalMediaPorts(f.service);
    expect(Object.keys(ports)).toEqual(['quote_create', 'generate_image', 'generate_video', 'job_get', 'asset_get']);
    const app = createDramaGoMcp({ catalog: fixtureCatalog, mediaPorts: ports, authorize: () => true });
    const quote = (await app.callTool('quote_create', { ...quoteInput, public_model_id: model.publicModelId }, auth)).structuredContent;
    expect(quote).toMatchObject({ quote_id: expect.any(String), request_hash: stableHash({ workspaceId: 'ws', publicModelId: model.publicModelId,
      version: model.version, capability: model.capability, providerId: model.providerId, providerModelId: model.providerModelId,
      pricingRuleVersion: model.pricingRuleVersion, request }), expires_at: '2026-01-01T00:05:00.000Z', status: 'reserved' });
    expect((await f.service.quoteGet(auth, quote.quote_id)).normalizedRequest).toEqual(request);
    expect(JSON.stringify(quote)).not.toMatch(/private|spendEvidence|tenantId|subjectId|providerModelId/);
    const generation = { quote_id: quote.quote_id, request_hash: quote.request_hash, confirm_quote: true,
      request, idempotency_key: 'generate-key-0001' };
    const result = await app.callTool(`generate_${kind}`, generation, auth);
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({ job_id: f.jobs.jobs[0].id, status: 'queued', quote_id: quote.quote_id, request_hash: quote.request_hash });
    expect(await app.callTool(`generate_${kind}`, generation, auth)).toEqual(result);
    expect(f.jobs.jobs).toHaveLength(1);
    expect(f.jobs.jobs[0].frozenRequest).toEqual(request);
    const job = (await app.callTool('job_get', { job_id: result.structuredContent.job_id }, auth)).structuredContent;
    expect(job).toMatchObject({ job_id: result.structuredContent.job_id, status: 'queued', created_at: expect.any(String) });
    expect(job).not.toHaveProperty('output_asset_ids'); // No projection exists in the application Job record.
    expect(job).not.toHaveProperty('frozenRequest');
    const asset = (await app.callTool('asset_get', { asset_id: 'asset', include_access_url: false }, auth)).structuredContent;
    expect(asset).toEqual({ asset_id: 'asset', workspace_id: 'ws', kind: 'input', status: 'ready', mime_type: 'image/png', byte_size: 42,
      created_at: now.toISOString(), updated_at: now.toISOString() });
    expect(JSON.stringify(asset)).not.toMatch(/storage|private|undefined/);
  });
});
