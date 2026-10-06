# Relocated Drama Fact Layer tests

> Integrated status note: this file originated with the fact-layer relocation workstream. The current repository also includes the relocated Drama contracts package, composition app, Media wire, and external USVDS port. Current aggregate verification is tracked in `../../docs/dramago-mcp-v1/P1-INTEGRATED-STATUS.md`; the historical workstream counts below remain provenance for that slice only.

## Sources and selection

- Domain/security: `975464ff5840ec9781430e7c47cc422b9a258fee`.
  `p1-domain`, `p1-domain-security`, `p1-baseline-resolution`, and
  `p1-integrated-fact-flow` came from `dsh-plugin/test/` at that pin.
- Persistence: `e3bcbf0ac4778285f7d65fc532d3caa3a0d9c1b9`.
  `p1-persistence`, `p1-persistence-journal`, `p1-persistence-postgres`,
  `p1-persistence-parity`, and `helpers/p1-postgres-pool.mjs` came from that pin.
- The eight JSON files in `fixtures/contracts-examples/` are byte-preserving
  copies of the examples needed by these tests from
  `core/dramago-mcp/contracts/examples/` at the domain/security pin.
  They are test data, not another contracts package or a schema validator.

The relative imports into `../../packages/` remain correct at this directory
depth. Fixture loading is centralized in `helpers/fixtures.mjs`: it prefers
`packages/dramago-contracts/contracts/examples/` when that package directory
exists; otherwise it uses the test-only copies. A present but incomplete
contracts package fails rather than silently mixing fixture sources. Once the
contracts branch is merged, the fallback copies can be removed in a follow-up.
No contract schemas, catalogs or validators are embedded in either fact package.

## Deliberate scope adaptations

- The integrated suite invokes application services directly against the real
  memory repository. It retains project/artifact/planning-approval flow,
  idempotent replay, stale CAS, changed-payload and authorization assertions.
  MCP envelopes, dispatcher construction and the P2 tool-declaration test are
  not relocated.
- The one embedded MCP workbench test in the security suite now checks that
  the application does not expose `getWorkbench` and still permits authorized
  `getProject`. All actor/evidence/digest/run/approval security cases remain.
- No `p1-mcp-*.test.mjs` composition tests or MCP runtime were copied.
- Baseline-resolution coverage additionally checks the inherited journal
  read port across a close/reopen and verifies that returned facts are copies.
- `relocation-boundaries.test.mjs` guards generic Media dependencies, fact-layer
  package-local/Node imports, and usable ESM package exports.

## Commands (workspace root)

```sh
pnpm install --frozen-lockfile
pnpm test:dramago
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

`test:dramago` uses Node's test runner. The existing Media Vitest command
excludes only `tests/dramago/**`, so neither runner accidentally claims the
other runner's suites. `typecheck`/`build` remain Media TypeScript project
references; they do not claim to typecheck the relocated ESM JavaScript.
Both new packages are covered by the existing `packages/*` pnpm workspace.
They have no runtime package dependencies: repository, authorization and
PostgreSQL pool are injected.

## Relocation verification

Verified on Node v22.23.2 with pnpm 9.15.4:

- Frozen-lockfile install succeeds across all 16 workspace projects.
- Drama Node suites: 154 passed, no failures or skips.
- Media Vitest: 132 passed, 3 existing real-PostgreSQL integration tests skipped.
- Media `pnpm typecheck` and `pnpm build` pass.
- Staged and unstaged `git diff --check` pass.
- Application runtime matches the selected domain/security pin; persistence
  runtime and SQL match persistence-review except for the two required
  baseline-version lookup methods. Generic Media package sources are unchanged.

The journal baseline reopen regression closes the active repository before
removing its temporary directory; cleanup does not weaken writer-lock checks.
These results verify this fact-layer transplant, not MCP transport or completion
of work in the external USVDS repository.

## Verification limits

The PostgreSQL suites use query/interleaving doubles, not a live server.
They cover advisory replay serialization, READ COMMITTED visibility,
transaction-local fact/replay/audit/outbox rollback, JSON/approval parity,
and nested-transaction fail-closed behavior. They do not prove production
migration execution, every SQL constraint or crash recovery on PostgreSQL.
Journal tests use real local filesystem/child processes but journal remains
single-host development/reference-only. No MCP composition, transport or
creative execution readiness is asserted here.
