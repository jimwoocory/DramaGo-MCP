# DramaGo-MCP

DramaGo-MCP is the main repository for the DramaGo creation platform and its single MCP-facing composition layer.

It is built on the existing hardened media infrastructure, while keeping the media domain generic. The repository now contains four distinct internal boundaries:

- **Drama contracts and fact layer** — Project, immutable ArtifactVersion, Planning/Script Baseline, Approval/Revocation, CreativeRun, CAS and idempotency.
- **DramaGo composition** — the internal tool dispatcher/composition root under `apps/dramago-mcp`.
- **USVDS adapter boundary** — a narrow external capability port. `US-Vertical-Drama-Studio` remains an external read-only capability source and is not vendored here.
- **Media platform** — generic model/Quote/Job/Asset/provider/storage/queue infrastructure inherited from the hardened Media MCP foundation.

## Repository boundary

```text
DramaGo client / future Remote MCP transport
                 |
                 v
          apps/dramago-mcp
           /      |       \
          /       |        \
 Drama fact   Media app   USVDS port
    layer      (generic)   (external)
                 |
                 v
        Media Core / providers
```

Generic Media packages must not depend on Story, Canon, Drama approval, Planning/Script Baselines, or USVDS stage semantics.

The USVDS repository remains separate. This repository may consume stable USVDS capabilities through `packages/dramago-usvds-adapter`, but relocation does not authorize copying or modifying USVDS runtime sources.

## Current implementation status

The integrated relocation baseline includes:

- `packages/dramago-contracts`
- `packages/dramago-application`
- `packages/dramago-persistence`
- `packages/dramago-usvds-adapter`
- `apps/dramago-mcp`
- the existing generic Media packages and hardened Media application layer

P2 creative runtime is **not** implemented yet. In particular, Story generation, screenplay execution, USVDS stage execution, a deployed Remote MCP transport/OAuth server, and production infrastructure rollout are not claimed as complete.

See:

- `docs/dramago-mcp-v1/P1-INTEGRATED-STATUS.md`
- `docs/dramago-mcp-v1/P0-ARCHITECTURE-DECISIONS.md`
- `docs/dramago-mcp-v1/P0-MIGRATION-ROLLBACK.md`

## Development checks

```sh
corepack pnpm install --offline --frozen-lockfile
corepack pnpm run check:dramago-contracts
corepack pnpm run test:dramago
corepack pnpm run test:media
corepack pnpm typecheck
corepack pnpm build
```

Real PostgreSQL, deployed queue/storage, Remote MCP authentication, and paid Provider E2E remain separate later-stage acceptance gates.
