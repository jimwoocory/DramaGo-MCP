import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))
const story = 'packages/story-development'
const app = 'apps/dramago-mcp'
const json = value => JSON.stringify(value, null, 2)

// Run the real guard in disposable repositories, never mutate the working tree.
// Keeping fixtures beneath the root makes the pinned TypeScript installation
// available to the copied guard without installation or symlinks on Windows.
function checkMutation(mutation = {}, inspect = () => {}) {
  const cache = path.join(root, 'node_modules/.cache')
  mkdirSync(cache, { recursive: true })
  const fixture = mkdtempSync(path.join(cache, 'story-boundary-'))
  const write = (name, content) => {
    const target = path.join(fixture, name)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  try {
    const files = {
      'package.json': json({ private: true, type: 'module' }),
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n  - apps/*\n',
      [`${story}/package.json`]: json({ name: '@xiaoshuren/story-development', type: 'module' }),
      [`${story}/tsconfig.json`]: json({ extends: '../../tsconfig.base.json', include: ['src'] }),
      [`${story}/src/index.ts`]: 'export const story = true\n',
      'tsconfig.base.json': json({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' } }),
      [`${app}/package.json`]: json({ name: '@xiaoshuren/dramago-mcp', type: 'module' }),
      [`${app}/index.ts`]: 'export const composition = true\n',
    }
    for (const name of ['media-core', 'media-application']) {
      files[`packages/${name}/package.json`] = json({ name: `@xiaoshuren/${name}`, exports: './src/index.ts' })
      files[`packages/${name}/src/index.ts`] = 'export const media = true\n'
    }
    for (const [name, content] of Object.entries({ ...files, ...mutation })) write(name, content)
    inspect(fixture)
    const guard = 'tests/dramago/boundaries.node.mjs'
    write(guard, '')
    copyFileSync(path.join(root, guard), path.join(fixture, guard))
    const scanner = 'scripts/story-dependency-boundaries.mjs'
    if (existsSync(path.join(root, scanner))) {
      write(scanner, '')
      copyFileSync(path.join(root, scanner), path.join(fixture, scanner))
    }
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT // The child must run its own test harness.
    return spawnSync(process.execPath, ['--test', '--test-name-pattern=Story runtime', guard], {
      cwd: fixture, encoding: 'utf8', timeout: 30_000, env,
    })
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
}

function rejects(mutation, inspect) {
  const result = checkMutation(mutation, inspect)
  assert.ifError(result.error)
  assert.notEqual(result.status, 0, `guard accepted forbidden Story -> Media dependency\n${result.stdout}${result.stderr}`)
  assert.match(result.stdout + result.stderr, /Story runtime cannot depend on Media:/, 'failure must identify the Story/Media boundary')
}

test('Story boundary accepts isolated runtime and permits Media/Story composition', () => {
  const result = checkMutation({
    [`${app}/index.ts`]: "import '@xiaoshuren/story-development'; import '@xiaoshuren/media-core'; import '@xiaoshuren/media-application';\n",
    [`${app}/package.json`]: json({ dependencies: {
      '@xiaoshuren/story-development': 'workspace:*', '@xiaoshuren/media-core': 'workspace:*', '@xiaoshuren/media-application': 'workspace:*',
    } }),
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test('Story boundary rejects a Media Core package import', () => {
  rejects({ [`${story}/src/index.ts`]: "import { media } from '@xiaoshuren/media-core'\n" })
})

for (const [name, source] of Object.entries({
  'relative import': "import { media } from '../../media-core/src/index.js'",
  'relative re-export': "export * from '../../media-application/src/index.js'",
  'dynamic import': "const media = import('@xiaoshuren/media-application')",
  'require': "const media = require('@xiaoshuren/media-core')",
  'import type expression': "type Media = import('@xiaoshuren/media-application').Media",
  'import equals': "import media = require('@xiaoshuren/media-core')",
  'URL module': "const media = new URL('../../media-core/src/index.js', import.meta.url)",
  'computed import': "const name = '@xiaoshuren/' + 'media-core'; import(name)",
})) test(`Story boundary rejects ${name}`, () => {
  rejects({ [`${story}/src/index.ts`]: source })
})

for (const [name, directive, ref] of [
  ['path', 'path', '../../media-core/src/execute.ts'],
  ['types path', 'types', '../../media-application/src/execute.d.ts'],
  ['types package', 'types', '@xiaoshuren/media-core'],
  ['renamed types package', 'types', '@local/execution'],
]) test(`Story boundary rejects triple-slash ${name} references`, () => {
  const source = `/// <reference ${directive}="${ref}" />\nexport {}\n`
  const parsed = ts.createSourceFile('index.d.ts', source, ts.ScriptTarget.Latest, true)
  const references = directive === 'path' ? parsed.referencedFiles : parsed.typeReferenceDirectives
  assert.equal(references[0]?.fileName, ref, 'probe must be a TypeScript-recognized reference')
  rejects({
    [`${story}/src/${directive === 'path' ? 'index.ts' : 'index.d.ts'}`]: source,
    'packages/media-core/src/execute.ts': 'export const execute = true\n',
    'packages/media-application/src/execute.d.ts': 'export declare const execute: true\n',
    ...(name === 'renamed types package' ? {
      'packages/media-core/package.json': json({ name: '@local/execution', types: './src/execute.ts' }),
    } : {}),
  })
})

test('Story boundary allows safe references and ignores reference-shaped prose', () => {
  const result = checkMutation({
    [`${story}/src/index.ts`]: [
      '/// <reference path="./planning.d.ts" />',
      '/// <reference types="node" />',
      '/// <reference lib="es2022" />',
      'export const example = `/// <reference path="../../media-core/src/execute.ts" />`',
      '// Documentation: /// <reference types="@xiaoshuren/media-application" />',
      '/* /// <reference path="../../media-core/src/execute.ts" /> */',
      '/// <reference path="../../media-core/src/execute.ts" />',
    ].join('\n'),
    [`${story}/src/planning.d.ts`]: 'declare interface Plan { title: string }\n',
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

for (const [name, config] of Object.entries({
  'tsconfig path alias': { compilerOptions: { paths: { '@execution/*': ['../media-core/src/*'] } } },
  'tsconfig reference': { references: [{ path: '../media-application' }] },
  'tsconfig baseUrl': { compilerOptions: { baseUrl: '../media-core/src' } },
  'tsconfig extends': { extends: '../media-application/tsconfig.json' },
})) test(`Story boundary rejects ${name}`, () => {
  rejects({
    [`${story}/tsconfig.json`]: json(config),
    'packages/media-application/tsconfig.json': json({ compilerOptions: {} }),
  })
})

for (const inherited of [false, true]) test(`Story boundary rejects ${inherited ? 'inherited JSONC' : 'direct'} rootDirs resolution into Media`, () => {
  rejects({
    ...(inherited ? {
      'tsconfig.base.json': '{ // inherited virtual source roots\n "compilerOptions": { "moduleResolution": "NodeNext", "rootDirs": ["packages/story-development/src", "packages/media-core/src",], }, }',
    } : {
      [`${story}/tsconfig.json`]: json({ compilerOptions: { moduleResolution: 'NodeNext', rootDirs: ['src', '../media-core/src'] }, include: ['src'] }),
    }),
    [`${story}/src/index.ts`]: "import { execute } from './execute.js'\n",
    'packages/media-core/src/execute.ts': 'export const execute = true\n',
  }, fixture => {
    const configFile = path.join(fixture, story, 'tsconfig.json')
    const { config } = ts.readConfigFile(configFile, ts.sys.readFile)
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(configFile), undefined, configFile)
    const resolved = ts.resolveModuleName('./execute.js', path.join(fixture, story, 'src/index.ts'), parsed.options, ts.sys)
    assert.equal(path.normalize(resolved.resolvedModule.resolvedFileName), path.join(fixture, 'packages/media-core/src/execute.ts'), 'probe must resolve to Media through TypeScript itself')
  })
})

test('Story boundary allows inherited JSONC rootDirs confined to Story', () => {
  const result = checkMutation({
    'tsconfig.base.json': '{ // safe generated source overlay\n "compilerOptions": { "rootDirs": ["packages/story-development/src", "packages/story-development/generated",], }, }',
    [`${story}/src/index.ts`]: "import { plan } from './plan.js'\n",
    [`${story}/generated/plan.ts`]: 'export const plan = true\n',
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test('Story boundary rejects inherited JSONC tsconfig mappings', () => {
  rejects({
    'tsconfig.base.json': '{ // shared config\n "compilerOptions": { "baseUrl": ".", "paths": { "@execution/*": ["packages/media-application/src/*"], }, }, }',
    [`${story}/src/index.ts`]: "import '@execution/index.js'",
  })
})

for (const inherited of [false, true]) test(`Story boundary rejects ${inherited ? 'inherited JSONC' : 'direct'} typeRoots resolution into Media`, () => {
  rejects({
    ...(inherited ? {
      'tsconfig.base.json': '{ // inherited ambient type roots\n "compilerOptions": { "typeRoots": ["packages/media-application/types",], }, }',
    } : {
      [`${story}/tsconfig.json`]: json({ compilerOptions: { typeRoots: ['../media-application/types'] }, include: ['src'] }),
    }),
    [`${story}/src/index.ts`]: '/// <reference types="execution" />\nexport {}\n',
    'packages/media-application/types/execution/index.d.ts': 'export declare const execute: true\n',
  }, fixture => {
    const configFile = path.join(fixture, story, 'tsconfig.json')
    const { config } = ts.readConfigFile(configFile, ts.sys.readFile)
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(configFile), undefined, configFile)
    const resolved = ts.resolveTypeReferenceDirective('execution', path.join(fixture, story, 'src/index.ts'), parsed.options, ts.sys)
    assert.equal(path.normalize(resolved.resolvedTypeReferenceDirective.resolvedFileName), path.join(fixture, 'packages/media-application/types/execution/index.d.ts'), 'innocent reference must resolve into Media through TypeScript itself')
  })
})

for (const inherited of [false, true]) test(`Story boundary rejects ${inherited ? 'inherited JSONC' : 'direct'} compiler types dependencies`, () => {
  rejects(inherited ? {
    'tsconfig.base.json': '{ // implicit type dependencies\n "compilerOptions": { "types": ["@xiaoshuren/media-core",], }, }',
  } : {
    [`${story}/tsconfig.json`]: json({ compilerOptions: { types: ['@xiaoshuren/media-application'] } }),
  })
})

test('Story boundary allows inherited local typeRoots and compiler types', () => {
  const result = checkMutation({
    'tsconfig.base.json': '{ // safe local types\n "compilerOptions": { "types": ["planning",], "typeRoots": ["packages/story-development/types",], }, }',
    [`${story}/types/planning/index.d.ts`]: 'declare interface Plan { title: string }\n',
    [`${story}/src/index.ts`]: '/// <reference types="planning" />\nexport {}\n',
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  test(`Story boundary rejects Media workspace ${field}`, () => {
    rejects({ [`${story}/package.json`]: json({ [field]: { '@xiaoshuren/media-application': 'workspace:*' } }) })
  })
}
for (const specifier of ['workspace:../media-core', 'workspace:@xiaoshuren/media-core@*', 'npm:@xiaoshuren/media-application@1.0.0', 'file:../media-core', 'link:../media-application']) {
  test(`Story boundary rejects workspace/dependency alias ${specifier}`, () => {
    rejects({ [`${story}/package.json`]: json({ dependencies: { '@local/execution': specifier } }) })
  })
}
test('Story boundary rejects conditional package imports mapping', () => {
  rejects({ [`${story}/package.json`]: json({ imports: { '#execution': { import: '@xiaoshuren/media-core', default: '@xiaoshuren/media-application' } } }) })
})
test('Story boundary rejects a root workspace override applied to its dependency', () => {
  rejects({
    [`${story}/package.json`]: json({ dependencies: { '@local/execution': 'workspace:*' } }),
    'package.json': json({ type: 'module', pnpm: { overrides: { '@local/execution': 'link:packages/media-core' } } }),
  })
})

for (const channel of ['import', 'workspace dependency']) test(`Story boundary rejects a renamed Media package via ${channel}`, () => {
  rejects({
    'packages/media-core/package.json': json({ name: '@local/execution', exports: './src/index.ts' }),
    ...(channel === 'import'
      ? { [`${story}/src/index.ts`]: "import '@local/execution'" }
      : { [`${story}/package.json`]: json({ dependencies: { '@local/execution': 'workspace:*' } }) }),
  })
})

test('Story boundary allows composition-only paths, references, rootDirs, types and scoped overrides', () => {
  const result = checkMutation({
    [`${story}/package.json`]: json({ name: '@xiaoshuren/story-development', dependencies: { '@local/port': '1.0.0' } }),
    [`${app}/tsconfig.json`]: json({ references: [{ path: '../../packages/media-core' }, { path: '../../packages/story-development' }], compilerOptions: {
      paths: { '@execution': ['../../packages/media-application/src/index.ts'] },
      rootDirs: ['src', '../../packages/media-core/src'],
      typeRoots: ['../../packages/media-application/types'],
      types: ['@xiaoshuren/media-core'],
    } }),
    [`${app}/index.ts`]: '/// <reference path="../../packages/media-core/src/index.ts" />\n/// <reference types="@xiaoshuren/media-application" />\nexport {}\n',
    'package.json': json({ pnpm: { overrides: { '@xiaoshuren/dramago-mcp>@local/port': 'link:packages/media-core' } } }),
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
