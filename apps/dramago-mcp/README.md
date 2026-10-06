# DramaGo internal composition

This package is an internal dispatcher, not a Remote MCP transport or a deployed server. It implements no OAuth, listener, provider runtime, or USVDS stage execution.

## Catalog and wiring

`createDramaGoMcp({ services, mediaPorts, authorize })` reads the sole production catalog at `packages/dramago-contracts/contracts/tool-catalog.v1.json`, relative to the source entry point, not the current working directory. The contracts package is a merge dependency: absence, malformed JSON, invalid descriptors or duplicate names fail startup. There is no production fallback catalog. Tests explicitly inject `tests/dramago/helpers/catalog-fixture.mjs` via `catalog` until the contracts branch is merged.

Inject an existing MediaApplicationService through `createLocalMediaPorts(service)` from `./media-ports`. Its five public names are `quote_create`, `generate_image`, `generate_video`, `job_get`, and `asset_get`. Only top-level command/result fields are mapped to snake_case; nested requests, whitespace and input ordering are preserved for request hashes. No Drama fields are injected into generic Media. Quote confirmation, spend authority, transactions, idempotency and resource ownership stay in Media Application. Private storage/provider/spend fields are not exposed. Access URL issuance is not wired; `include_access_url: true` rejects after asset authorization instead of inventing a URL.

`services` is a trusted application dependency with methods accepting `(auth, input)`. The registration allowlist contains only fact-layer methods: createProject, getProject, getArtifact, createArtifactRevision, getBaseline, getApproval, revokeApproval, getRun, approvePlanningBaseline and approveScriptBaseline. A tool must exist in the catalog and have its corresponding method injected to be callable. No service is fabricated when an application package is absent. Workbench and P2 creative methods (Story execution, Script drafting, Production execution) are not registered even if similarly named functions are supplied. They remain `declared_unimplemented` when declared by the catalog. `descriptors` shows declared status; `listTools()` exposes callable tools only.

## Authorization and errors

The caller must supply an already authenticated context. This module does not authenticate credentials. Exact catalog scope membership and a strict `true` response from `authorize(auth, authorizationClass, { toolName, workspaceId, input })` are both required. No authorizer means deny. The authorizer must enforce resource/workspace policy; application handlers must still enforce ownership and transactional invariants. Explicit invalid workspace selectors, invalid idempotency keys and required revision preconditions fail before authorization/handler execution. Auth and input are frozen JSON snapshots across awaits.

Unknown and declared-unimplemented tools fail closed. Fact-layer errors are mapped to sanitized structured errors. Injected Media envelopes and thrown Media errors pass through unchanged rather than being converted by the Drama error mapper; an eventual transport must handle those rejections according to the Media contract.

## JS/TS boundary and verification

Keep the existing monorepo source-entry convention. `index.js` remains native ESM (behavior checked by Node tests); `media-ports.ts` is strict TypeScript and needs a TS-aware consumer, as do the existing Media packages. The app's composite project uses `allowJs`, `checkJs: false`, and declaration-only emission. This avoids relocating the JS catalog-relative URL into `dist` and does not claim a runnable distribution build. No generic Media package configuration is changed.

From the repository root:

- `pnpm install --frozen-lockfile`
- `pnpm test:dramago` (Media wire + USVDS type checks + Node composition/boundary suites)
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

`packages/dramago-usvds-adapter` is a separate type-only external adapter boundary, not a vendored engine or a working creative runtime.
