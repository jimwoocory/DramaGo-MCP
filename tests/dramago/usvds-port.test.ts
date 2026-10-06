import { fileURLToPath } from 'node:url'
import path from 'node:path'
import ts from 'typescript'
import { expect, test } from 'vitest'

test('external USVDS contracts require source pin, opaque references and identity/idempotency context', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const filename = path.join(root, 'tests/dramago/usvds-contract.fixture.ts')
  const source = `
    import type { UsvdsCapabilityMetadata, UsvdsRunStageRequest, UsvdsRunStageResult, UsvdsStagePort } from '../../packages/dramago-usvds-adapter/src/index.js';
    const source = { repository: 'external-usvds', revision: 'immutable-source-revision' };
    const capability: UsvdsCapabilityMetadata = {
      capabilityId: 'creative-stage', contractVersion: '1', source,
      stageIds: ['external-stage']
    };
    const request: UsvdsRunStageRequest = {
      capabilityId: capability.capabilityId, source, stageId: 'external-stage',
      context: { tenantId: 'tenant', projectId: 'project', actorId: 'actor',
        correlationId: 'correlation', executionId: 'execution', idempotencyKey: 'idempotency' },
      inputArtifacts: [{ artifactId: 'opaque-artifact', versionId: 'immutable-version', digest: 'sha256:opaque-digest' }]
    };
    const result: UsvdsRunStageResult = {
      status: 'completed', source, context: request.context,
      outputArtifacts: request.inputArtifacts
    };
    const failure: UsvdsRunStageResult = {
      status: 'failed', source, context: request.context,
      error: { code: 'STAGE_FAILED', message: 'External stage failed', retryable: false }
    };
    declare const port: UsvdsStagePort;
    const pending: Promise<UsvdsRunStageResult> = port.runStage(request);
    const metadata: UsvdsCapabilityMetadata = port.capability;
    // @ts-expect-error source must pin a revision, not just identify a repository
    const unpinned: UsvdsRunStageRequest = { ...request, source: { repository: 'external-usvds' } };
    // @ts-expect-error idempotency identity is mandatory
    const missingIdentity: UsvdsRunStageRequest = { ...request, context: { tenantId: 'tenant' } };
    // @ts-expect-error artifacts are references, not raw file path strings
    const pathInput: UsvdsRunStageRequest = { ...request, inputArtifacts: ['local-file'] };
    // @ts-expect-error failed results cannot claim successful output
    const mixedResult: UsvdsRunStageResult = { ...failure, outputArtifacts: [] };
  `
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: true, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  }
  const host = ts.createCompilerHost(options)
  const originalGetSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    path.resolve(name) === filename
      ? ts.createSourceFile(name, source, languageVersion, true)
      : originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)
  const program = ts.createProgram([filename], options, host)
  const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  expect(diagnostics).toEqual([])
})
