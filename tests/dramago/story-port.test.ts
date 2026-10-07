import { fileURLToPath } from 'node:url'
import path from 'node:path'
import ts from 'typescript'
import { expect, test } from 'vitest'

test('internal Story port separates writer/reviewer capabilities and excludes approval', () => {
  const filename = fileURLToPath(new URL('./story-port.fixture.ts', import.meta.url))
  const source = `
    import type { StoryService, StoryWriterPort, StoryReviewerPort, StoryCommand } from '../../apps/dramago-mcp/story-ports.js';
    import { createDramaGoMcp } from '../../apps/dramago-mcp/index.js';
    const writer: StoryWriterPort = { async runStoryStep(auth, input) { return { creative_run_id: 'writer-run' }; } };
    const reviewer: StoryReviewerPort = { async reviewPlanning(auth, input) { return { creative_run_id: 'review-run' }; } };
    const storyService: StoryService = { writer, reviewer };
    createDramaGoMcp({ storyService });
    const writerOnly: StoryService = { writer };
    const reviewerOnly: StoryService = { reviewer };
    // @ts-expect-error a writer cannot implicitly serve as a reviewer
    const wrongRole: StoryService = { reviewer: writer };
    // @ts-expect-error approval is not a Story capability
    const approval: StoryService = { approvePlanningBaseline() {} };
    // @ts-expect-error composition must retain the explicit Story interface
    createDramaGoMcp({ storyService: { reviewer: writer } });
    // @ts-expect-error write commands require both preconditions
    const incomplete: StoryCommand = { idempotency_key: 'key' };
    // @ts-expect-error runtime run_id is not the public result field
    const legacyResult: import('../../apps/dramago-mcp/story-ports.js').StoryRunResult = { run_id: 'legacy' };
    // @ts-expect-error context_ref is mandatory, runtime refs cannot replace it
    const runtimePayload: StoryCommand = { project_id: 'p', expected_revision: 0, idempotency_key: 'k', input_refs: [] };
  `
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: true, types: ['node'], allowJs: true, checkJs: false,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  }
  const host = ts.createCompilerHost(options)
  const original = host.getSourceFile.bind(host)
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    path.resolve(name) === filename ? ts.createSourceFile(name, source, languageVersion, true)
      : original(name, languageVersion, onError, shouldCreateNewSourceFile)
  const program = ts.createProgram([filename], options, host)
  expect(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
})
