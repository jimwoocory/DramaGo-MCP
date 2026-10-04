# P0-02 Foundation Status

Branch: `p0-02-provider-job-asset`

This checkpoint starts P0-02. It does not claim the full P0-02 Gate is complete.

## Implemented in this checkpoint

- Provider submit uncertainty moves the internal Job to `reconciling` and blocks blind resubmission.
- Provider status polling and reconciliation use bounded backoff: 5s, 15s, 30s, 60s, 5min.
- A Provider `succeeded` observation does not mark the internal Job `succeeded`; it schedules Asset ingest and leaves the Job `running` until archival completes.
- Webhook verification is part of the Provider Adapter contract.
- Webhook payloads can be AES-256-GCM protected before persistence.
- Webhook event dedupe uses the database `provider_id + provider_event_id` unique boundary.
- URL import policy requires HTTPS and rejects loopback, private, link-local, metadata, documentation, multicast, and reserved address ranges.
- Redirect-aware fetch validates the URL again before each redirect hop and enforces timeout / maximum bytes.
- Media ingest validates MIME against magic bytes for PNG, JPEG, WebP, and MP4.
- Provider output is SHA-256 hashed and written to private ObjectStore before the Job can complete.
- S3-compatible / R2-compatible storage adapter supports server-side put, presigned PUT, and short-lived signed reads.
- PostgreSQL completion transaction inserts Asset, advances Job to `succeeded`, and writes Audit + completion Outbox.
- Development MemoryObjectStore remains available for deterministic tests.

## Verification

Company workstation verification:

- `corepack pnpm test`: 22 passed, 3 skipped.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm build`: passed.
- The skipped tests are the existing real-PostgreSQL suite gated by `POSTGRES_URL`.

## Remaining P0-02 work

- Connect 1–2 real image/video Provider adapters with real server-side credentials.
- Run a real image generation chain and a real video generation chain.
- Run provider-specific webhook signature verification against real callbacks.
- Add a production queue adapter with at-least-once delivery, delayed retry, concurrency, metrics, and failed/dead-letter handling.
- Run Asset ingest against a real private S3/R2 bucket.
- Exercise presigned upload against real object storage.
- Add deeper media probing (dimensions, duration, codec/container validation) and optional malware scanning.
- Add a production Secret Manager/Vault adapter; the current interface and environment-backed development adapter are server-only boundaries, not a production secret store.
- Run the real PostgreSQL rollback/concurrency integration suite with `POSTGRES_URL`.

## Next recommended implementation slice

Select the first real Provider and implement its adapter end-to-end behind the current Provider Adapter interface. Prefer a Provider with asynchronous jobs plus either webhook support or a stable polling API, then verify image first and video second.
