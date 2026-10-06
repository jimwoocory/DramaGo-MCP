import type { AuthContext, Asset, Job } from "@xiaoshuren/contracts";
import { DomainError } from "@xiaoshuren/contracts";
import type { MediaApplicationService } from "@xiaoshuren/media-application";

/** Structural application port: accepts the real service, not a legacy remote client. */
export type LocalMediaApplication = Pick<MediaApplicationService,
  "quoteCreate" | "generateImage" | "generateVideo" | "jobGet" | "assetGet">;
export type QuoteCreateDto = {
  workspace_id?: string; public_model_id: string; request: Record<string, unknown>; idempotency_key: string;
};
export type GenerateDto = {
  workspace_id?: string; quote_id: string; request_hash: string; confirm_quote: true;
  request: Record<string, unknown>; idempotency_key: string;
};
export type JobGetDto = { workspace_id?: string; job_id: string };
export type AssetGetDto = { workspace_id?: string; asset_id: string; include_access_url?: boolean };

function jobDto(job: Job) {
  return {
    job_id: job.id, workspace_id: job.workspaceId, kind: job.kind, public_model_id: job.publicModelId,
    status: job.status, created_at: job.createdAt.toISOString(), updated_at: job.updatedAt.toISOString(),
    ...(job.quoteId === undefined ? {} : { quote_id: job.quoteId }),
  };
}
function assetDto(asset: Asset) {
  return {
    asset_id: asset.id, workspace_id: asset.workspaceId, kind: asset.kind, status: asset.status,
    created_at: asset.createdAt.toISOString(), updated_at: asset.updatedAt.toISOString(),
    ...(asset.mimeType === undefined ? {} : { mime_type: asset.mimeType }),
    ...(asset.byteSize === undefined ? {} : { byte_size: asset.byteSize }),
    ...(asset.width === undefined ? {} : { width: asset.width }),
    ...(asset.height === undefined ? {} : { height: asset.height }),
    ...(asset.durationMs === undefined ? {} : { duration_ms: asset.durationMs }),
  };
}

/** No transport, providers, stage execution, spend inference, or nested request rewriting. */
export function createLocalMediaPorts(media: LocalMediaApplication) {
  const generate = async (kind: "image" | "video", input: GenerateDto, auth: AuthContext) => {
    const command = {
      workspaceId: input.workspace_id, quoteId: input.quote_id, requestHash: input.request_hash,
      confirmQuote: input.confirm_quote, request: input.request, idempotencyKey: input.idempotency_key,
    };
    const result = kind === "image" ? await media.generateImage(auth, command) : await media.generateVideo(auth, command);
    return { job_id: result.jobId, status: result.status, quote_id: result.quoteId, request_hash: result.requestHash };
  };
  return Object.freeze({
    async quote_create(input: QuoteCreateDto, auth: AuthContext) {
      const quote = await media.quoteCreate(auth, {
        workspaceId: input.workspace_id, publicModelId: input.public_model_id,
        idempotencyKey: input.idempotency_key, request: input.request,
      });
      return {
        quote_id: quote.id, workspace_id: quote.workspaceId, public_model_id: quote.publicModelId,
        request_hash: quote.requestHash, status: quote.status, expires_at: quote.expiresAt.toISOString(),
        max_charge: { currency: quote.maxCharge.currency, amount_minor: quote.maxCharge.amountMinor },
      };
    },
    generate_image: (input: GenerateDto, auth: AuthContext) => generate("image", input, auth),
    generate_video: (input: GenerateDto, auth: AuthContext) => generate("video", input, auth),
    async job_get(input: JobGetDto, auth: AuthContext) {
      return jobDto(await media.jobGet(auth, input.job_id, input.workspace_id));
    },
    async asset_get(input: AssetGetDto, auth: AuthContext) {
      const asset = await media.assetGet(auth, input.asset_id, input.workspace_id);
      if (input.include_access_url !== undefined && typeof input.include_access_url !== "boolean") {
        throw new DomainError("VALIDATION_ERROR", "include_access_url must be a boolean");
      }
      if (input.include_access_url === true) {
        throw new DomainError("NOT_IMPLEMENTED", "Authorized asset access URL issuance is not wired");
      }
      return assetDto(asset);
    },
  });
}
