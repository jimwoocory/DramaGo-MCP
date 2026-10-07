# DramaGo internal composition

This package is an internal dispatcher, not a Remote MCP transport or a deployed server. It implements no OAuth, listener, provider runtime, or USVDS stage execution.

## Catalog and wiring

`createDramaGoMcp({ services, storyService, mediaPorts, authorize })` reads the sole production catalog at `packages/dramago-contracts/contracts/tool-catalog.v1.json`, relative to the source entry point, not the current working directory. The contracts package is a merge dependency: absence, malformed JSON, invalid descriptors or duplicate names fail startup. There is no production fallback catalog. Legacy composition tests explicitly inject `tests/dramago/helpers/catalog-fixture.mjs` via `catalog`; the P2 Story composition tests exercise the production catalog directly.

Inject an existing MediaApplicationService through `createLocalMediaPorts(service)` from `./media-ports`. Its five public names are `quote_create`, `generate_image`, `generate_video`, `job_get`, and `asset_get`. Only top-level command/result fields are mapped to snake_case; nested requests, whitespace and input ordering are preserved for request hashes. No Drama fields are injected into generic Media. Quote confirmation, spend authority, transactions, idempotency and resource ownership stay in Media Application. Private storage/provider/spend fields are not exposed. Access URL issuance is not wired; `include_access_url: true` rejects after asset authorization instead of inventing a URL.

`services` is a trusted application dependency with methods accepting `(auth, input)`. Its registration allowlist contains only fact-layer methods: createProject, getProject, getArtifact, createArtifactRevision, getBaseline, getApproval, revokeApproval, getRun, approvePlanningBaseline and approveScriptBaseline. A tool must exist in the catalog and have its corresponding method injected to be callable. No service is fabricated when an application package is absent. `descriptors` shows declared status; `listTools()` exposes callable tools only.

### P2 Story composition

Inject `createLocalStoryPorts(runtime, repository)` from `./story-ports`, where `runtime` is the actual `StoryDevelopmentService` and `repository` is the same tenant-bound fact repository. Pass the returned `StoryService` to `createDramaGoMcp({ storyService, services, mediaPorts, authorize })`. This is a local dependency-injected adapter, not a transport or synthetic Story implementation:

- `storyService.writer.runStoryStep(auth, input)` registers only `dramago_story_step_run` (`story.execute`).
- `storyService.reviewer.reviewPlanning(auth, input)` registers only `dramago_planning_review` (`story.review`).
- Either role may be omitted. Review never falls back to the writer, and methods injected into the wrong role, `services`, or `mediaPorts` do not register Story tools.
- `dramago_planning_baseline_approve` still registers exclusively through `services.approvePlanningBaseline` with `story.approve`. Neither Story role exposes approval; PASS and blockers remain persisted review evidence, never approval.

Public requests/results are the checked-in `story-development.schema.json` definitions `step_request`, `review_request`, and `run_result`. A request supplies `project_id`, `expected_revision`, `idempotency_key`, and an exact `context_ref` (plus `step` for generation). Runtime-only `workspace_id`, `input_refs`, and `planning_scope` are rejected on the wire. Both tools return only `{ creative_run_id }`; its value is exactly the stored CreativeRun's `run_id`, usable with the existing run fact query. Internal project revision, status, outputs and error details are not added to this result. Composition validates the wire shape and projects results even for custom injected Story ports.

The adapter resolves the project workspace from repository facts and reauthorizes it; an auth default is not used to invent workspace ownership. It preflights the exact immutable context, digest, ownership, declared planning range, role bindings, configuration, sources and research selection, then forwards the published context-ref command unchanged to the authoritative runtime. It does not reconstruct a legacy Bible DTO, recover a separate direction prerequisite, or assemble review input refs. The runtime interprets the context and its exact dependency graph, owns operation/revision compatibility and replay ordering, and never selects head/latest inputs. Context and configuration remain in runtime provenance and replay identity. Explicit optional research omission suppresses discovery; a supplied snapshot must be preserved by the research port. The selected executor must match the runtime's configured role identity.

The runtime still owns independent review, transitive provenance checks, immutable artifacts/evidence, durable run facts and transactional idempotency/CAS. Its internal proposal/research content formats are not redefined by this request/result adapter. Incompatible stored content fails closed rather than being rewritten under an existing digest. No retries, caching, approvals, provider execution, candidate assembly or automatic next step are introduced. Node tests retain registration/authorization probes; `story-runtime-composition.test.ts` additionally drives public tool calls through this adapter into the actual service and InMemory repository.

Workbench, Script drafting/review (Stages 03/04), and Production tools (05–09) remain `declared_unimplemented` / `TOOL_NOT_IMPLEMENTED`, even if similarly named functions are supplied. No LLM, web, browser, CLI, external USVDS runtime, remote transport, UI or background queue is introduced. Generic Media code and contracts are unchanged.

### Dependency direction

`packages/story-development` must not depend on Media Core or Media Application. `scripts/story-dependency-boundaries.mjs`, exercised by the Node boundary suite, checks source imports/re-exports, dynamic/require/type imports, relative paths, package dependencies and aliases, package mappings, inherited tsconfig paths/references and applicable workspace overrides. The composition app may depend on Story and Media together. Mutation fixtures run the real guard in isolated repositories and check both forbidden dependencies and allowed composition; generic Media's existing reverse-boundary and USVDS guards remain in force.

## Authorization and errors

The caller must supply an already authenticated context. This module does not authenticate credentials. Exact catalog scope membership and a strict `true` response from `authorize(auth, authorizationClass, { toolName, workspaceId, input })` are both required. No authorizer means deny. The authorizer must enforce resource/workspace policy; application handlers must still enforce ownership and transactional invariants. Explicit invalid workspace selectors, invalid idempotency keys and required revision preconditions fail before authorization/handler execution. Auth and input are frozen JSON snapshots across awaits.

Unknown and declared-unimplemented tools fail closed. Fact-layer errors are mapped to sanitized structured errors. Injected Media envelopes and thrown Media errors pass through unchanged rather than being converted by the Drama error mapper; an eventual transport must handle those rejections according to the Media contract.

## JS/TS boundary and verification

Keep the existing monorepo source-entry convention. `index.js` remains native ESM (behavior checked by Node tests); `media-ports.ts` and `story-ports.ts` are strict TypeScript and need a TS-aware consumer, as do the existing Media packages. The app's composite project uses `allowJs`, `checkJs: false`, and declaration-only emission. This avoids relocating the JS catalog-relative URL into `dist` and does not claim a runnable distribution build. No generic Media package configuration is changed.

From the repository root:

- `pnpm install --frozen-lockfile`
- `pnpm test:dramago` (Media wire + USVDS type checks + Node composition/boundary suites)
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

`packages/dramago-usvds-adapter` is a separate type-only external adapter boundary, not a vendored engine or a working creative runtime.
