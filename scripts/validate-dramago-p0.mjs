import path from 'node:path';
import { validateExamples } from './dramago-schema-instances.mjs';
import { validateToolPolicy } from './dramago-tool-policy.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// P0 inventory + frozen catalog policy + current-schema instance validation.
// Not full Draft 2020-12 or cross-record semantic verification (Python fixtures).
// No server, provider, authorization enforcement, or business runtime.
// Frozen from meeting-consensus.md section 7, not inferred from the catalog under test.
export const REQUIRED_TOOL_NAMES = Object.freeze([
  'quote_create', 'generate_image', 'generate_video', 'job_get', 'asset_get',
  'models_list', 'models_get', 'asset_create_upload', 'asset_confirm', 'job_cancel',
  'dramago_project_create', 'dramago_project_get', 'dramago_artifact_get',
  'dramago_artifact_revision_create', 'dramago_baseline_get', 'dramago_approval_get',
  'dramago_approval_revoke', 'dramago_run_get', 'dramago_workbench_get',
  'dramago_story_step_run', 'dramago_planning_review', 'dramago_planning_baseline_approve',
  'dramago_script_draft', 'dramago_script_review', 'dramago_script_baseline_approve',
  'dramago_production_step_run', 'dramago_production_package_approve',
  'dramago_production_generation_prepare', 'dramago_production_generate',
  'dramago_production_execution_get', 'dramago_production_result_review', 'dramago_stage09_review',
]);
const forbiddenNames = new Set(['stage_run', 'approval_decide', 'dramago_stage_run', 'dramago_approval_decide']);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' ? value.trim().length > 0
  : Array.isArray(value) ? value.length > 0 && value.every(nonempty)
    : isObject(value) && Object.keys(value).length > 0 && Object.values(value).every(nonempty);

export function validateToolCatalog(catalog, label = 'tool-catalog.v1.json') {
  const errors = [];
  if (!catalog || !Array.isArray(catalog.tools)) {
    return [`${label}: expected an object with a tools array`];
  }
  const names = new Set();
  for (const [index, tool] of catalog.tools.entries()) {
    if (!tool || typeof tool.name !== 'string' || !tool.name.trim()) {
      errors.push(`${label}: tools[${index}] must have a nonempty name`);
      continue;
    }
    if (!/^[a-z][a-z0-9_]*$/.test(tool.name)) errors.push(`${label}: invalid tool name ${JSON.stringify(tool.name)}`);
    if (names.has(tool.name)) errors.push(`${label}: duplicate tool name ${tool.name}`);
    names.add(tool.name);
    if (forbiddenNames.has(tool.name)) errors.push(`${label}: forbidden generic tool ${tool.name}`);
    for (const field of ['domain', 'maturity', 'mutability', 'invariant']) {
      if (!nonempty(tool[field])) errors.push(`${label}: ${tool.name}: missing or empty ${field}`);
    }
  }
  for (const name of REQUIRED_TOOL_NAMES) {
    if (!names.has(name)) errors.push(`${label}: missing required tool ${name}`);
  }
  errors.push(...validateToolPolicy(catalog, label));
  return errors;
}

// Resolve only in-memory contract documents. A URI is an identifier, never a network request.
function resolveRef(ref, file, schemas) {
  if (typeof ref !== 'string') return null;
  const [resource, fragment = ''] = ref.split('#');
  let targetFile = file;
  if (resource) {
    targetFile = [...schemas].find(([, value]) => value?.$id === resource)?.[0]
      ?? path.posix.normalize(path.posix.join(path.posix.dirname(file), resource));
  }
  let node = schemas.get(targetFile);
  if (fragment) {
    if (!fragment.startsWith('/')) return null;
    try {
      for (const token of decodeURIComponent(fragment).slice(1).split('/')) {
        const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
        if ((!isObject(node) && !Array.isArray(node)) || !Object.hasOwn(node, key)) return null;
        node = node[key];
      }
    } catch { return null; }
  }
  return isObject(node) ? { node, file: targetFile } : null;
}

// Collect only required property paths. Description text, unused $defs and
// optional branches cannot stand in for a pinned version or episode identity.
function requiredPaths(schema, label, schemas, errors) {
  const paths = [];
  function expand(node, file, seen) {
    if (!isObject(node) || seen.has(node)) return [];
    const next = new Set(seen).add(node);
    const parts = [{ node, file }];
    if (Object.hasOwn(node, '$ref')) {
      const target = resolveRef(node.$ref, file, schemas);
      if (!target) errors.push(`${label}: unresolved $ref ${JSON.stringify(node.$ref)} in ${file}`);
      else parts.push(...expand(target.node, target.file, next));
    }
    if (Array.isArray(node.allOf)) {
      for (const child of node.allOf) parts.push(...expand(child, file, next));
    }
    return parts;
  }
  function visit(entries, prefix, ancestors) {
    const active = entries.filter(({ node }) => isObject(node) && !ancestors.has(node));
    if (!active.length) return;
    const next = new Set([...ancestors, ...active.map(({ node }) => node)]);
    // Keep conjuncts together at each instance path, with their own ref context.
    const parts = active.flatMap(({ node, file }) => expand(node, file, new Set()));
    const required = new Set();
    for (const { node: part } of parts) {
      if (part.required === undefined) continue;
      if (!Array.isArray(part.required) || part.required.some((name) => typeof name !== 'string')) {
        errors.push(`${label}: required must be an array of strings at ${prefix.join('.') || '<root>'}`);
        continue;
      }
      for (const name of part.required) required.add(name);
    }
    for (const name of required) {
      const properties = parts
        .filter(({ node }) => isObject(node.properties) && Object.hasOwn(node.properties, name))
        .map(({ node, file }) => ({ node: node.properties[name], file }));
      if (!properties.length) continue;
      const propertyPath = [...prefix, name];
      paths.push(propertyPath);
      visit(properties, propertyPath, next);
    }
    if (parts.some(({ node }) => node.type === 'array')) {
      const items = parts.filter(({ node }) => isObject(node.items))
        .map(({ node, file }) => ({ node: node.items, file }));
      visit(items, prefix, next);
    }
  }
  visit([{ node: schema, file: label }], [], new Set());
  return paths;
}

const normalizeConcept = (name) => name.replace(/[^a-z0-9]/gi, '').toLowerCase();
export function validateBaselineSchema(schema, label = 'baseline.schema.json', otherSchemas = new Map()) {
  if (!isObject(schema)) return [`${label}: baseline schema must be an object`];
  const schemas = new Map(otherSchemas).set(label, schema);
  const errors = [];
  const paths = requiredPaths(schema, label, schemas, errors);
  const names = paths.map((parts) => normalizeConcept(parts.at(-1)));
  if (!names.some((name) => /^(ordered)?episodeids?$/.test(name))) {
    errors.push(`${label}: missing required episode identity (episode_id or episode_ids)`);
  }
  if (!names.some((name) => /version(ids?)?$/.test(name) && !/^(schema|policy|rule)/.test(name))) {
    errors.push(`${label}: missing required version reference (not merely schema/policy version)`);
  }
  if (!names.some((name) => /(digest|hash)$/.test(name) && !/^(manifest|baseline)/.test(name))) {
    errors.push(`${label}: missing required digest/hash for frozen content/version (manifest digest alone is insufficient)`);
  }
  // Annotation evidence only; JSON Schema cannot enforce storage immutability.
  const immutable = schema.readOnly === true || schema['x-immutable'] === true
    || (/^\s*(immutable\b|不可变)/i.test(schema.description ?? ''))
    || (Array.isArray(schema.required) && schema.required.includes('immutable') && schema.properties?.immutable?.const === true);
  if (!immutable) errors.push(`${label}: missing immutable declaration (readOnly, x-immutable, immutable const, or Immutable description)`);
  return [...new Set(errors)];
}

export const CONTRACT_DIR = 'packages/dramago-contracts/contracts';
const DOC_DIR = 'docs/dramago-mcp-v1';
export const REQUIRED_P0_FILES = Object.freeze([
  ...['P0-SOURCE-BASELINE.md', 'P0-ARCHITECTURE-DECISIONS.md', 'P0-TOOL-CATALOG.md',
    'P0-COMPATIBILITY-MATRIX.md', 'P0-MIGRATION-ROLLBACK.md', 'P0-USVDS-STAGE-MAPPING.md',
    'P0-ACCEPTANCE-GATES.md'].map((name) => `${DOC_DIR}/${name}`),
  `${CONTRACT_DIR}/tool-catalog.v1.json`,
]);
const schemaTypes = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const absoluteUri = (value) => typeof value === 'string' && /^[a-z][a-z0-9+.-]*:\S+$/i.test(value);

function validateSchemaMetadata(schema, file) {
  if (!isObject(schema)) return [`${file}: schema must be an object with $schema/$id/title/type metadata`];
  const errors = [];
  if (!absoluteUri(schema.$schema)) errors.push(`${file}: missing or invalid $schema URI`);
  if (!absoluteUri(schema.$id)) errors.push(`${file}: missing or invalid $id URI`);
  if (typeof schema.title !== 'string' || !schema.title.trim()) errors.push(`${file}: missing or empty title`);
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const composed = typeof schema.$ref === 'string'
    || ['allOf', 'anyOf', 'oneOf'].some((key) => Array.isArray(schema[key]) && schema[key].length);
  const library = !schema.properties && !schema.items && !schema.required
    && [schema.$defs, schema.definitions].some((value) => isObject(value) && Object.keys(value).length);
  if (schema.type !== undefined || (!composed && !library)) {
    if (!types.length || types.some((type) => !schemaTypes.has(type))) errors.push(`${file}: missing or invalid type`);
  }
  return errors;
}

// Map of repository-relative POSIX paths to UTF-8 text. Fixtures exercise this
// exact validator without writing fake contracts into the checkout.
export function validateP0Files(files) {
  const errors = [];
  for (const file of REQUIRED_P0_FILES) {
    if (!files.has(file)) errors.push(`missing required file ${file}`);
    else if (!files.get(file).trim()) errors.push(`empty required file ${file}`);
  }
  const jsonFiles = [...files.keys()].filter((file) => file.startsWith(`${CONTRACT_DIR}/`) && file.endsWith('.json')).sort();
  const schemaFiles = jsonFiles.filter((file) => file.endsWith('.schema.json') && !file.startsWith(`${CONTRACT_DIR}/examples/`));
  const exampleFiles = jsonFiles.filter((file) => file.startsWith(`${CONTRACT_DIR}/examples/`));
  if (!schemaFiles.length) errors.push(`${CONTRACT_DIR}: no contract schemas (*.schema.json)`);
  if (!exampleFiles.length) errors.push(`${CONTRACT_DIR}/examples: no contract examples (*.json)`);
  const parsed = new Map();
  for (const file of jsonFiles) {
    try { parsed.set(file, JSON.parse(files.get(file))); }
    catch (error) { errors.push(`${file}: invalid JSON: ${error.message}`); }
  }
  const schemas = new Map(schemaFiles.filter((file) => parsed.has(file)).map((file) => [file, parsed.get(file)]));
  const ids = new Map();
  for (const [file, schema] of schemas) {
    errors.push(...validateSchemaMetadata(schema, file));
    if (typeof schema?.$id === 'string') {
      if (ids.has(schema.$id)) errors.push(`${file}: duplicate schema $id ${schema.$id} (also ${ids.get(schema.$id)})`);
      ids.set(schema.$id, file);
    }
  }
  for (const kind of ['planning', 'script']) {
    const candidates = schemaFiles.filter((file) => normalizeConcept(path.posix.basename(file)).includes(`${kind}baseline`));
    if (!candidates.length) errors.push(`${CONTRACT_DIR}: missing ${kind} baseline schema`);
    for (const file of candidates) {
      if (schemas.has(file)) errors.push(...validateBaselineSchema(schemas.get(file), file, schemas));
    }
  }
  const instances = validateExamples(schemas, new Map(exampleFiles.filter((file) => parsed.has(file)).map((file) => [file, parsed.get(file)])));
  errors.push(...instances.errors);
  const catalogFile = `${CONTRACT_DIR}/tool-catalog.v1.json`;
  const catalog = parsed.get(catalogFile);
  if (parsed.has(catalogFile)) errors.push(...validateToolCatalog(catalog, catalogFile));
  const baselineDoc = `${DOC_DIR}/P0-SOURCE-BASELINE.md`;
  // Role-bound relocation pins: incidental historical mentions are not provenance.
  const sourcePins = {
    'target main': '8f33226ae06875a1f79abebe3ce02ece0058c0d5',
    'contracts source': '8ef521800c6fbca01dc03d6bbd404029d92614ea',
    'application source': '975464ff5840ec9781430e7c47cc422b9a258fee',
    'persistence source': 'e3bcbf0ac4778285f7d65fc532d3caa3a0d9c1b9',
    'Media hardened source': '8f33226ae06875a1f79abebe3ce02ece0058c0d5',
  };
  const lines = (files.get(baselineDoc) ?? '').split(/\r?\n/).map((line) => line.trim());
  for (const [role, full] of Object.entries(sourcePins)) {
    const commit = full.slice(0, 7);
    const declarations = lines.filter((line) => line.startsWith(`${role}=`));
    if (declarations.length !== 1 || ![`${role}=${commit}`, `${role}=${full}`].includes(declarations[0])) {
      errors.push(`${baselineDoc}: missing fixed baseline commit ${commit} for ${role} (one exact role=pin line required)`);
    }
  }
  return {
    errors: [...new Set(errors)],
    counts: { json: jsonFiles.length, schemas: schemaFiles.length, examples: exampleFiles.length, instances: instances.instances,
      tools: Array.isArray(catalog?.tools) ? catalog.tools.length : 0 },
  };
}

export function validateRepository(root = fileURLToPath(new URL('../', import.meta.url))) {
  const files = new Map();
  const errors = [];
  function read(file) {
    try { files.set(file, readFileSync(path.join(root, file), 'utf8')); }
    catch (error) { errors.push(`${file}: cannot read (${error.code ?? error.message})`); }
  }
  for (const file of REQUIRED_P0_FILES) read(file);
  function collect(directory) {
    let entries;
    try { entries = readdirSync(path.join(root, directory), { withFileTypes: true }); }
    catch (error) { errors.push(`${directory}: cannot list (${error.code ?? error.message})`); return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = `${directory}/${entry.name}`;
      // No traversal into symlinked directories or files outside the owned checkout.
      if (entry.isSymbolicLink()) errors.push(`${file}: symbolic links are not supported in contracts`);
      else if (entry.isDirectory()) collect(file);
      else if (entry.isFile() && file.endsWith('.json') && !files.has(file)) read(file);
    }
  }
  collect(CONTRACT_DIR);
  const result = validateP0Files(files);
  return { ...result, errors: [...new Set([...errors, ...result.errors])] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateRepository();
  if (result.errors.length) {
    console.error(`DramaGo P0 contract validation FAILED (${result.errors.length} errors):`);
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`DramaGo P0 contract validation PASSED: ${result.counts.json} JSON files, ${result.counts.schemas} schemas, ${result.counts.examples} example files / ${result.counts.instances} instances, ${result.counts.tools} tools.`);
    console.log('Static inventory, catalog policy and current-schema instance evidence only; not full Draft 2020-12, runtime approval, or Remote MCP E2E.');
  }
}
