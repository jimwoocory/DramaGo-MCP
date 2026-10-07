import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) return []
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? files(target) : entry.isFile() ? [target] : []
  })
}

// Story owns planning and consumes injected fact ports, not Media execution.
// The apps/dramago-mcp composition root is deliberately outside this check.
export function validateStoryMediaBoundary(root) {
  const errors = []
  const report = (file, ref) => errors.push(`Story runtime cannot depend on Media: ${path.relative(root, file)} -> ${ref}`)
  const mediaNames = ['media-core', 'media-application'].map(name =>
    JSON.parse(readFileSync(path.join(root, 'packages', name, 'package.json'), 'utf8')).name)
  const media = value => {
    const specifier = value.replace(/^(?:workspace|npm|file|link):/, '')
    return /(?:^|[/@\\])media-(?:core|application)(?:[/@\\]|$)/i.test(value) ||
      mediaNames.some(name => typeof name === 'string' && (specifier === name || specifier.startsWith(`${name}/`) || specifier.startsWith(`${name}@`)))
  }
  const checkRef = (file, ref, base = path.dirname(file)) => {
    if (typeof ref === 'string' && (media(ref) || media(path.resolve(base, ref)))) report(file, ref)
  }
  const rootManifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const checkMappings = (file, value) => {
    if (typeof value === 'string') checkRef(file, value)
    else if (value && typeof value === 'object') {
      for (const [key, target] of Object.entries(value)) {
        checkRef(file, key)
        checkMappings(file, target)
      }
    }
  }
  for (const file of files(path.join(root, 'packages/story-development'))) {
    if (path.basename(file) === 'package.json') {
      const manifest = JSON.parse(readFileSync(file, 'utf8'))
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
          checkRef(file, name)
          checkRef(file, specifier)
          for (const [selector, target] of Object.entries(rootManifest.pnpm?.overrides ?? {})) {
            const parts = selector.split('>')
            const dependency = parts.at(-1)
            const owner = manifest.name ?? '@xiaoshuren/story-development'
            const applies = parts.length === 1 || parts[0] === owner || parts[0].startsWith(`${owner}@`)
            if (applies && (dependency === name || dependency.startsWith(`${name}@`))) checkMappings(path.join(root, 'package.json'), target)
          }
        }
      }
      for (const field of ['imports', 'exports']) checkMappings(file, manifest[field])
    }
    if (/^tsconfig.*\.json$/.test(path.basename(file))) {
      const { config, error } = ts.readConfigFile(file, ts.sys.readFile)
      if (error) { report(file, ts.flattenDiagnosticMessageText(error.messageText, '\n')); continue }
      for (const ref of [config.extends].flat()) checkRef(file, ref)
      const parsed = ts.parseJsonConfigFileContent(config, {
        ...ts.sys,
        readFile: target => {
          checkRef(file, target)
          return ts.sys.readFile(target)
        },
      }, path.dirname(file), undefined, file)
      for (const error of parsed.errors.filter(error => ![18002, 18003].includes(error.code))) {
        report(file, ts.flattenDiagnosticMessageText(error.messageText, '\n'))
      }
      checkRef(file, parsed.options.baseUrl)
      // Virtual source and type roots can redirect innocuous dependencies into Media.
      // Use parsed options so inherited JSONC paths retain their declaring base.
      for (const directory of [...(parsed.options.rootDirs ?? []), ...(parsed.options.typeRoots ?? [])]) checkRef(file, directory)
      for (const type of parsed.options.types ?? []) checkRef(file, type)
      for (const targets of Object.values(parsed.options.paths ?? {})) {
        for (const target of targets) checkRef(file, target, parsed.options.baseUrl ?? parsed.options.pathsBasePath ?? path.dirname(file))
      }
      for (const ref of parsed.projectReferences ?? []) checkRef(file, ref.path)
    }
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    // These directives are compiler dependencies, not AST import declarations.
    // Compiler metadata excludes lookalikes in strings and ordinary comments.
    for (const ref of [...source.referencedFiles, ...source.typeReferenceDirectives]) checkRef(file, ref.fileName)
    const check = node => {
      if (!node || !(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
        report(file, 'computed module dependency requires explicit review')
      } else if (media(node.text) || (node.text.startsWith('.') && media(path.resolve(path.dirname(file), node.text)))) {
        report(file, node.text)
      }
    }
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) check(node.moduleSpecifier)
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) check(node.argument.literal)
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) check(node.moduleReference.expression)
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require')) check(node.arguments[0])
      if (ts.isNewExpression(node) && node.expression.getText(source) === 'URL') check(node.arguments?.[0])
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return errors
}
