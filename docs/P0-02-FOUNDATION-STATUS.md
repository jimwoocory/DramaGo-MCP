# P0-02 Foundation Status

Branch: `p0-02-provider-job-asset`

This checkpoint starts P0-02. It does not claim the full P0-02 Gate is complete.

## Implemented

- Provider submit uncertainty moves the internal Job to `reconciling` and blocks blind resubmission.
- ProviderExecution persists provider job id, provider status, and submission attempts.
- Provider status polling and reconciliation use bounded backoff: 5s, 15s, 30s, 60s, 5min.
- A Provider `succeeded` observation does not mark the internal Job `succeeded`; it schedules Asset ingest and leaves the Job `running` until archival completes.
- Optional Replicate Provider adapter:
  - asynchronous prediction submission
  - polling
  - cancel
  - completed webhook request
  - HMAC-SHA256 webhook verification
  - timestamp replay protection
  - output URL normalization
  - network / 5xx submit outcomes mapped to UNKNOWN reconciliation
- Webhook payloads can be AES-256-GCM protected before persistence.
- Webhook event dedupe uses the database `provider_id + provider_event_id` unique boundary.
- URL import policy requires HTTPS and rejects loopback, private, link-local, metadata, documentation, multicast, and reserved address ranges.
- Redirect-aware fetch validates every redirect hop and enforces timeout / maximum bytes.
- Media validation checks MIME against magic bytes for PNG, JPEG, WebP, and MP4.
- Provider output is SHA-256 hashed and written to private ObjectStore before the Job can complete.
- S3-compatible / R2-compatible ObjectStore:
  - server-side private put
  - presigned PUT
  - short-lived signed reads
  - HEAD verification
- Upload sessions are persisted and bound to tenant + subject + workspace + Asset.
- Upload confirmation verifies object existence, byte size, and content type before Asset `ready`.
- URL import authorizes the workspace before external fetch and persists a ready private Asset.
- PostgreSQL completion transaction inserts Asset, advances Job to `succeeded`, and writes Audit + completion Outbox.
- BullMQ / Redis production Queue adapter:
  - delayed jobs
  - default 8 attempts
  - exponential backoff
  - configurable concurrency
  - failed jobs retained
  - queue metrics
- Secret providers:
  - Environment provider for development
  - AWS Secrets Manager provider with logical-name mapping, JSON-key extraction, bounded cache, and no secret logging

## Verification

Company workstation verification:

- `corepack pnpm test`: 34 passed, 3 skipped.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm build`: passed.
- The skipped tests are the existing real-PostgreSQL suite gated by `POSTGRES_URL`.

## Remaining P0-02 work

External E2E is intentionally not claimed until real services/credentials are supplied:

- Configure Replicate server-side token and webhook signing secret.
- Run a real image generation chain.
- Run a real video generation chain.
- Run provider-specific real webhook callbacks.
- Configure live Redis and exercise BullMQ worker delivery/retry/failure behavior.
- Configure a private S3/R2 bucket and exercise presigned upload + HEAD confirm + Asset archive.
- Add deeper media probing (dimensions, duration, codec/container validation) and optional malware scanning.
- Exercise AWS Secrets Manager or another production secret backend with deployed credentials.
- Run the real PostgreSQL rollback/concurrency integration suite with `POSTGRES_URL`.

## Next recommended implementation slice

Provide server-side development credentials/services for the external E2E gates. The code path is ready to run Replicate image first, then video, with results archived to the configured private ObjectStore.
