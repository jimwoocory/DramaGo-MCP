import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'
import ts from 'typescript'
import { validateStoryMediaBoundary } from '../../scripts/story-dependency-boundaries.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('Story runtime cannot depend on Media Core or Media Application', () => {
  assert.deepEqual(validateStoryMediaBoundary(root), [])
})
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', '.git', 'dist', '.pnpm-store', '.corepack'].includes(entry.name)) return []
    const target = path.join(dir, entry.name)
    return entry.isDirectory() ? files(target) : entry.isFile() ? [target] : []
  })
}
const relative = file => path.relative(root, file).replaceAll('\\', '/')
const dramaDependency = value => /(?:dramago|story-development|usvds|usvd-v9)/i.test(value)
const absoluteOrWorktree = value => /^(?:[a-z]:[\\/]|[/\\]|file:|~[/\\])/i.test(value) || /(?:^|[/\\])(?:worktrees|users|home)[/\\]/i.test(value)
function moduleReferences(source) {
  const found = []
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) found.push(node.moduleSpecifier.text)
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) found.push(node.argument.literal.text)
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) found.push(node.moduleReference.expression?.text)
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require')) {
      const argument = node.arguments[0]
      assert.ok(argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)), 'computed module dependency must be explicitly reviewed')
      found.push(argument.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}
const parse = (name, content) => ts.createSourceFile(name, content, ts.ScriptTarget.Latest, true)

test('boundary detectors cover imports, re-exports, dynamic imports, require and type imports', () => {
  const refs = moduleReferences(parse('sample.ts', `import type { X } from '@dramago/contracts';
    export * from '../dramago-application/index.js';
    const a = import('../dramago-usvds-adapter/src/ports.js');
    const b = require('C:/Users/dev/worktrees/external/index.js');
    type T = import('@dramago/adapter').X;`))
  assert.equal(refs.length, 5)
  assert.ok(refs.slice(0, 3).every(dramaDependency))
  for (const value of ['C:/dev/x', 'C:\\dev\\x', '/home/dev/x', '\\\\server\\share', 'file:///tmp/x', '../../worktrees/external']) assert.ok(absoluteOrWorktree(value), value)
  assert.equal(absoluteOrWorktree('../contracts/src/index.js'), false)
})

test('dependency detector rejects Story package, relative imports and workspace mappings', () => {
  const refs = moduleReferences(parse('media.ts', `import { StoryDevelopmentService } from '@xiaoshuren/story-development';
    export * from '../story-development/src/index.js';
    const runtime = import('../../story-development/src/index.js');
    const legacy = require('@xiaoshuren/story-development');
    type Service = import('@xiaoshuren/story-development').StoryDevelopmentService;`))
  assert.equal(refs.length, 5)
  for (const ref of [...refs, 'workspace:../story-development', '../story-development']) assert.ok(dramaDependency(ref), ref)
  assert.equal(dramaDependency('@xiaoshuren/media-application'), false)
})

test('generic Media, contracts, persistence, providers and workers cannot depend on Drama, Story or USVDS', () => {
  const generic = files(path.join(root, 'packages')).filter(file => !/^packages\/(?:dramago-|story-development\/)/.test(relative(file)))
  assert.ok(generic.some(file => relative(file).startsWith('packages/media-application/')))
  for (const file of generic) {
    if (/\.(?:[cm]?[jt]sx?)$/.test(file)) {
      for (const ref of moduleReferences(parse(file, readFileSync(file, 'utf8')))) assert.ok(!dramaDependency(ref), `${relative(file)} imports ${ref}`)
    }
    if (path.basename(file) === 'package.json' || path.basename(file).startsWith('tsconfig')) {
      const value = JSON.parse(readFileSync(file, 'utf8'))
      const dependencies = { ...value.dependencies, ...value.devDependencies, ...value.peerDependencies, ...value.optionalDependencies }
      for (const [name, specifier] of Object.entries(dependencies)) assert.ok(!dramaDependency(`${name} ${specifier}`), `${relative(file)} depends on ${name}`)
      for (const mapping of Object.values(value.compilerOptions?.paths ?? {})) assert.ok(!dramaDependency(JSON.stringify(mapping)), relative(file))
      for (const ref of value.references ?? []) assert.ok(!dramaDependency(ref.path), relative(file))
    }
  }
})

test('Story runtime and local MCP adapter cannot import USVDS runtime', () => {
  const targets = [...files(path.join(root, 'packages/story-development')), ...files(path.join(root, 'apps/dramago-mcp'))]
  for (const file of targets) {
    if (/\.(?:[cm]?[jt]sx?)$/.test(file)) {
      for (const ref of moduleReferences(parse(file, readFileSync(file, 'utf8')))) assert.doesNotMatch(ref, /(?:usvds|usvd-v9|dsh-plugin)/i, `${relative(file)} imports ${ref}`)
    }
    if (path.basename(file) === 'package.json' || path.basename(file).startsWith('tsconfig')) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /(?:usvds|usvd-v9|dsh-plugin)/i, relative(file))
    }
  }
})

test('new repository excludes legacy controller, plugin, Cordis patch and distributions', () => {
  for (const file of files(root)) {
    const name = relative(file)
    assert.doesNotMatch(name, /(?:^|\/)(?:core\/usvd-v9|dsh-plugin|distributions?|marketplace|direct-upload|tabbit|mediago)(?:\/|$)/i)
    assert.doesNotMatch(name, /cordis[^/]*\.(?:patch|diff)$/i)
    if (path.basename(file) === 'package.json') {
      const content = readFileSync(file, 'utf8')
      assert.doesNotMatch(content, /(?:dsh-plugin|core[\\/]usvd-v9|cordis.*patch|distributions?[\\/])/i)
    }
  }
})

test('USVDS boundary is type-only, source-pinned, portable and has no runtime or stage implementation', () => {
  const adapter = path.join(root, 'packages/dramago-usvds-adapter')
  assert.ok(existsSync(adapter), 'external USVDS contract package must exist')
  const port = path.join(adapter, 'src/ports.ts')
  assert.ok(existsSync(port), 'USVDS ports must exist')
  for (const file of files(adapter).filter(file => /\.(?:[cm]?[jt]s|json)$/.test(file))) {
    const content = readFileSync(file, 'utf8')
    if (file.endsWith('.json')) {
      const visit = value => {
        if (typeof value === 'string') assert.ok(!absoluteOrWorktree(value), `${relative(file)}: ${value}`)
        else if (value && typeof value === 'object') Object.values(value).forEach(visit)
      }
      visit(JSON.parse(content))
    } else {
      const source = parse(file, content)
      for (const statement of source.statements) assert.ok(ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) ||
        (ts.isExportDeclaration(statement) && statement.isTypeOnly), `${relative(file)} must contain types only`)
      function visit(node) {
        if (ts.isStringLiteral(node)) assert.ok(!absoluteOrWorktree(node.text), `${relative(file)}: ${node.text}`)
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
})

test('workspace explicitly includes apps without removing packages', () => {
  const workspace = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8')
  assert.match(workspace, /-\s+packages\/\*/)
  assert.match(workspace, /-\s+apps\/\*/)
})
