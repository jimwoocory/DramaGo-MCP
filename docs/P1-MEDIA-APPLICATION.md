# P1 generic Media application boundary

`@xiaoshuren/media-application` exposes `MediaApplicationService`. It has no
product/project-domain fields or imports. This is an application API, not a
Remote MCP server or an OAuth implementation.

## Application surface

| Method | Required scope | Ownership |
| --- | --- | --- |
| `modelsList`, `modelsGet` | `media.models.read` | Catalog read |
| `quoteCreate`, `quoteGet` | `media.quotes.create` | Active workspace membership; stored quotes also bind tenant, subject and client |
| `generateImage`, `generateVideo` | `media.generate.image`, `media.generate.video` respectively | Quote owner plus active workspace membership |
| `jobGet(auth, jobId, workspaceId?)` | `media.jobs.read` | Job tenant and subject plus active workspace membership |
| `assetGet(auth, assetId, workspaceId?)` | `media.assets.read` | Asset tenant plus active workspace membership |
| `jobCancel(auth, { jobId, workspaceId?, idempotencyKey })` | `media.jobs.cancel` | Same job ownership checks as `jobGet` |

An explicit workspace must match the resource. An omitted workspace on a read
is resolved from the resource, not used to bypass membership checks. Jobs have
subject ownership; assets are workspace-owned and can be read by other members
of that workspace. No asset subject/project ownership is invented.

The application uses camelCase method arguments and results. A future tool
adapter must map these to the frozen snake_case tool catalog, including
`job_get`, `asset_get`, and `job_cancel`. Returned domain records are detached;
transport adapters must construct their public response DTOs rather than expose
internal storage metadata directly.

Cancellation atomically records `cancel_requested`, increments the job version
once, and stores an idempotent result. Repeated requests do not repeat the
transition. Terminal `cancelled`, `succeeded`, and `failed` states are preserved.
This does not call a provider, dispatch a provider cancellation event, or claim
that cancellation has completed. A host cancellation worker is still needed for
external cancellation. Authorization is checked even on idempotent replay.

## Schema and input assets

Quote creation validates normalized JSON against the selected model's
`inputSchema` before spend authorization. Generation validates against the
schema frozen in the quote before creating a job. The bounded, local JSON Schema
subset supports:

- Single `type`: object, array, string, boolean, null, number, integer.
- `properties`, `required`, `additionalProperties` (boolean or schema).
- `items` (boolean or schema), `minItems`, `maxItems`.
- `enum`, `minimum`, `maximum`, `minLength`, `maxLength`.
- Non-mutating annotations: `title`, `description`, `default`, `examples`.
- Boolean nested schemas and an explicitly unconstrained empty schema `{}`.

Unknown keywords (including references, formats, and combinators), malformed
schemas, and nesting beyond the supported depth fail closed with
`VALIDATION_ERROR`. The entire schema is checked, including absent optional
properties. There is no coercion, default injection, prompt trimming, network
schema resolution, or dependency on a live provider.

Both `request.input_asset_ids` and the existing `request.inputAssetIds` spelling
are checked without changing their hash, order, or spelling. If both appear,
all referenced IDs are checked. Values must be arrays of non-empty string IDs.
`MediaApplicationTransaction.findAsset(auth, id)` resolves each ID; the
application verifies its identity, tenant, exact request workspace, and `ready`
status. A missing/foreign asset returns `NOT_FOUND`; a non-ready asset returns
`ASSET_NOT_READY`. Generation resolves assets again after spend verification.

The in-memory application store accepts an optional `AssetLookupPort` compatible
with the core asset store's `findAsset` signature. Without an adapter, all asset
lookups are unresolved (fail closed), not implicitly authorized. Reads through
this port do not perform downloads or provider calls.

## Spend and transaction gates

Fresh generation requires explicit confirmation, the exact frozen request hash,
and valid quote/spend expiry. Expiry is checked before and after asynchronous
spend verification, again at the core job creation gate after core authorization
and idempotency lookup, and after core persistence. Expiry at the boundary is
rejected; a failure rolls back quote confirmation, application/core idempotency,
Job, ProviderExecution, Audit, and Outbox facts.

`JobService` accepts an optional trusted synchronous `beforeCreate` gate in its
constructor, never in caller request data. It runs immediately before persisting
a new job, not for a completed core idempotent replay. The application likewise
returns an authorized original successful result before expiry/spend/asset
revalidation, so later expiry or asset removal does not invalidate a replay.

A durable `MediaApplicationStore` implementation must serialize conflicting
commands and job cancellation/worker updates, bind the core store to the same
commit/rollback, and keep asset authorization/readiness reads consistent or locked
through that transaction. The included in-memory adapter is a local reference
store, not a durable production repository. The host must supply the catalog,
asset store and trusted spend authority; budget settlement/refunds are outside
this package.

## Offline verification

The workspace lockfile includes the `packages/media-application` importer.
Use the pinned pnpm version from `package.json`:

```
pnpm install --offline --lockfile-only --ignore-scripts
pnpm install --offline --frozen-lockfile --ignore-scripts
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Leave `POSTGRES_URL` unset for the offline test run. The real PostgreSQL tests
then remain explicitly skipped; local persistence tests use pg-mem. Provider
adapter tests use injected fakes. These checks do not establish Remote MCP,
OAuth, live PostgreSQL, or live provider end-to-end operation.
