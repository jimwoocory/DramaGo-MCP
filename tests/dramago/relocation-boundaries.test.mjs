import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const packages = fileURLToPath(new URL('../../packages/', import.meta.url))
const factNames = ['dramago-application', 'dramago-persistence']
const forbiddenHost = /(?:^|[/@\\])(?:usvds(?:[-/]|$)|usvd-v9(?:[/\\]|$)|dsh-plugin(?:[/\\]|$))/i
const drama = /(?:^|[/@\\])dramago-[^/\\]+/i
const codeFile = /\.(?:[cm]?[jt]sx?)$/

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'dist'].includes(entry.name)) return []
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}

function dependencies(directory) {
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    .flatMap(field => Object.entries(pkg[field] ?? {}).flat())
}

// Covers static imports/re-exports, bare imports, import(), require(), and
// URL-based module references. These packages do not use computed module names.
function moduleReferences(source) {
  const pattern = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*|\bnew\s+URL\s*\(\s*)['"`]([^'"`]+)['"`]/g
  return [...source.matchAll(pattern)].map(match => match[1])
}

test('generic Media packages do not depend on Drama or USVDS/plugin runtime', () => {
  const generic = readdirSync(packages, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('dramago-') && entry.name !== 'story-development')
  assert.ok(generic.length > 0)
  for (const entry of generic) {
    const directory = join(packages, entry.name)
    const references = [...dependencies(directory)]
    for (const path of files(directory).filter(path => codeFile.test(path))) {
      references.push(...moduleReferences(readFileSync(path, 'utf8')))
    }
    for (const specifier of references) {
      assert.equal(drama.test(specifier) || forbiddenHost.test(specifier), false, `${entry.name}: ${specifier}`)
    }
  }
})

test('fact packages have only Node and package-local runtime imports', () => {
  for (const name of factNames) {
    const directory = join(packages, name)
    assert.deepEqual(dependencies(directory), [], `${name} uses injected repository/authorization/pool ports`)
    for (const path of files(directory).filter(path => codeFile.test(path))) {
      assert.equal(path.endsWith('.js'), true, `retain ESM JavaScript: ${path}`)
      for (const specifier of moduleReferences(readFileSync(path, 'utf8'))) {
        assert.equal(forbiddenHost.test(specifier), false, `${path}: ${specifier}`)
        if (specifier.startsWith('node:')) continue
        assert.ok(specifier.startsWith('./') || specifier.startsWith('../'), `${path}: ${specifier}`)
        const target = resolve(path, '..', specifier)
        const location = relative(directory, target)
        assert.ok(!location.startsWith('..') && !location.includes(':'), `${path}: import escapes package`)
      }
    }
  }
})

for (const name of factNames) test(`${name} exposes a usable ESM workspace entry`, () => {
  const directory = join(packages, name)
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  assert.equal(pkg.name, `@xiaoshuren/${name}`)
  assert.equal(pkg.private, true)
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.exports['.'], './index.js')
  const exported = name === 'dramago-application' ? 'createDramaApplication' : 'PostgresDramaRepository'
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import assert from 'node:assert/strict'; import * as api from ${JSON.stringify(pkg.name)}; assert.equal(typeof api[${JSON.stringify(exported)}], 'function');`],
  { cwd: directory, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})
