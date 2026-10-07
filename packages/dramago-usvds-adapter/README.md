# External USVDS boundary

Type-only contracts for a future externally supplied USVDS capability. This package has no runtime entry point, implementation, dependencies, filesystem access, transport, vendored source or creative stage logic. The local P2 Story Development runtime is implemented separately in [`packages/story-development`](../story-development/README.md), with injected offline ports; external USVDS stage execution remains unimplemented.

Consume with `import type` from `@xiaoshuren/dramago-usvds-adapter`. The TypeScript project follows the workspace's composite NodeNext style but emits declarations only. The package export intentionally supplies only a `types` condition.

## Contracts

- `UsvdsCapabilityMetadata`: capability identity, contract version, immutable external source pin and externally owned stage identifiers. Listing a stage does not implement it.
- `UsvdsSourcePin`: portable logical repository identity and exact immutable revision. No branch, floating tag, local checkout path or actual source revision is selected here.
- `UsvdsArtifactReference`: opaque artifact/version identifiers and digest. These are handles, not embedded artifact contents, URLs or local paths. Storage and resolution remain outside this package.
- `UsvdsExecutionContext`: tenant, project, actor, correlation, execution and idempotency identities. Identity fields are not credentials and do not establish authorization.
- `UsvdsStagePort`: advertises metadata and declares `runStage(request): Promise<UsvdsRunStageResult>`.
- Requests select a capability and stage, pin the source, supply identity context and reference input artifacts. Results distinguish completion with output references from failure with a structured error, echoing source and context for provenance.

## Obligations of a future implementation

Validate source pins, reference integrity, identity and authorization at runtime; TypeScript declarations do not enforce their string semantics. Require the request capability, stage and source pin to match the advertised metadata. Never silently execute another source revision.

Scope idempotency by tenant, project, capability and stage. For the same idempotency key and equivalent request, replay the original outcome without repeating effects; reject reuse with changed source, inputs or execution identity. Correlation identifies tracing, not deduplication. Preserve the original request context and actual executing source in results. Define persistence, retries, cancellation, transport failures and artifact resolution in the external implementation, not here.

No external checkout is required or inspected by this package. There is intentionally no local USVDS integration or working `runStage` implementation.
