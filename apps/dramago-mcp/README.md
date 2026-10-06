# DramaGo internal composition

This package is an internal dispatcher, not a Remote MCP transport or a deployed server. It implements no OAuth, listener, provider runtime, or USVDS stage execution.

## Catalog and wiring

`createDramaGoMcp({ services, storyService, mediaPorts, authorize })` reads the sole production catalog at `packages/dramago-contracts/contracts/tool-catalog.v1.json`, relative to the source entry point, not the current working directory. The contracts package is a merge dependency: absence, malformed JSON, invalid descriptors or duplicate names fail startup. There is no production fallback catalog. Legacy composition tests explicitly inject `tests/dramago/helpers/catalog-fixture.mjs` via `catalog`; the P2 Story composition tests exercise the production catalog directly.

Inject an existing MediaApplicationService through `createLocalMediaPorts(service)` from `./media-ports`. Its five public names are `quote_create`, `generate_image`, `generate_video`, `job_get`, and `asset_get`. Only top-level command/result fields are mapped to snake_case; nested requests, whitespace and input ordering are preserved for request hashes. No Drama fields are injected into generic Media. Quote confirmation, spend authority, transactions, idempotency and resource ownership stay in Media Application. Private storage/provider/spend fields are not exposed. Access URL issuance is not wired; `include_access_url: true` rejects after asset authorization instead of inventing a URL.

`services` is a trusted application dependency with methods accepting `(auth, input)`. Its registration allowlist contains only fact-layer methods: createProject, getProject, getArtifact, createArtifactRevision, getBaseline, getApproval, revokeApproval, getRun, approvePlanningBaseline and approveScriptBaseline. A tool must exist in the catalog and have its corresponding method injected to be callable. No service is fabricated when an application package is absent. `descriptors` shows declared status; `listTools()` exposes callable tools only.

### P2 Story composition

The optional `storyService` uses the internal, type-only `StoryService` interface in `story-ports.ts`:

- `storyService.writer.runStoryStep(auth, input)` registers only `dramago_story_step_run` (`story.execute`).
- `storyService.reviewer.reviewPlanning(auth, input)` registers only `dramago_planning_review` (`story.review`).
- Either role may be omitted. Review never falls back to the writer, and methods injected into the wrong role, `services`, or `mediaPorts` do not register Story tools.
- `dramago_planning_baseline_approve` still registers exclusively through `services.approvePlanningBaseline` with `story.approve`. Neither Story role exposes approval; PASS and blockers are returned as evidence, not interpreted as approval.

Both Story methods receive the unchanged frozen wire command, including exact refs, `idempotency_key` and `expected_revision`, and return an object containing the durable `run_id` (the catalog result kind is `creative_run_id`). Application errors use the existing sanitized Drama error mapper. Composition performs no retries, caching, output synthesis, candidate assembly or automatic next step.

The injected Story application, not this dispatcher, owns step allowlisting, writer/reviewer independence, research requirements and immutable snapshots, exact ref/digest/ownership validation, complete ordered episode coverage, immutable artifact/review evidence persistence, durable CreativeRun facts, and transactional idempotency/CAS. The broad internal command type deliberately does not duplicate the domain schema. Registration does not prove those domain invariants; composition tests use injected probes, while domain acceptance belongs to the Story implementation.

Workbench, Script drafting/review (Stages 03/04), and Production tools (05–09) remain `declared_unimplemented` / `TOOL_NOT_IMPLEMENTED`, even if similarly named functions are supplied. No LLM, web, browser, CLI, external USVDS runtime, remote transport, UI or background queue is introduced. Generic Media code and contracts are unchanged.

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
