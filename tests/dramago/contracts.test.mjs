import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as validation from '../../scripts/validate-dramago-p0.mjs';
import { createInstanceValidator } from '../../scripts/dramago-schema-instances.mjs';
const { validateToolCatalog } = validation;

const baseline = (kind) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `urn:dramago:${kind}-baseline:v1`, title: `${kind} Baseline`, type: 'object',
  readOnly: true,
  required: ['baseline_id', 'schema_version', 'manifest_digest', 'episodes'],
  properties: {
    baseline_id: { type: 'string' }, schema_version: { const: `fixture.${kind}/v1` },
    manifest_digest: { type: 'string' },
    episodes: {
      type: 'array', minItems: 1,
      items: { type: 'object', required: ['episode_id', 'artifact_version_id', 'content_hash'], properties: {
        episode_id: { type: 'string' }, artifact_version_id: { type: 'string' }, content_hash: { type: 'string' },
      } },
    },
  },
});

for (const kind of ['planning', 'script']) {
  test(`${kind} baseline includes immutable episode/version/digest concepts`, () => {
    assert.deepEqual(validation.validateBaselineSchema(baseline(kind), `${kind}-baseline.schema.json`), []);
  });
  for (const [field, concept] of [['episode_id', 'episode'], ['artifact_version_id', 'version'], ['content_hash', 'digest']]) {
    test(`${kind} baseline rejects a missing episode/version digest concept: ${field}`, () => {
      const schema = baseline(kind);
      const item = schema.properties.episodes.items;
      // Leave the property, descriptions, and manifest digest: they cannot replace required per-version evidence.
      item.required = item.required.filter((name) => name !== field);
      schema.description = 'Immutable episode version digest record';
      const errors = validation.validateBaselineSchema(schema, `${kind}-baseline.schema.json`);
      assert.ok(errors.some((error) => error.includes(`required ${concept}`)), errors.join('\n'));
    });
  }
  test(`${kind} baseline rejects optional containers and unused definitions`, () => {
    const schema = baseline(kind);
    schema.required = schema.required.filter((name) => name !== 'episodes');
    schema.$defs = { unused: schema.properties.episodes.items };
    assert.ok(validation.validateBaselineSchema(schema, kind).some((error) => error.includes('required episode')));
  });
  test(`${kind} baseline must declare immutability`, () => {
    const schema = baseline(kind);
    delete schema.readOnly;
    assert.ok(validation.validateBaselineSchema(schema, kind).some((error) => error.includes('immutable')));
  });
}

test('baseline local references and allOf retain required concepts', () => {
  const schema = baseline('planning');
  schema.$defs = { episode: schema.properties.episodes.items };
  schema.properties.episodes.items = { $ref: '#/$defs/episode' };
  schema.allOf = [{ required: schema.required }];
  delete schema.required;
  assert.deepEqual(validation.validateBaselineSchema(schema, 'planning-baseline.schema.json'), []);
});

test('baseline JSON Pointer references traverse array entries', () => {
  const schema = baseline('planning');
  schema.$defs = { holder: { allOf: [schema.properties.episodes.items] } };
  schema.properties.episodes.items = { $ref: '#/$defs/holder/allOf/0' };
  assert.deepEqual(validation.validateBaselineSchema(schema, 'planning'), []);
  for (const index of ['1', '01', '-']) {
    schema.properties.episodes.items.$ref = `#/$defs/holder/allOf/${index}`;
    assert.ok(validation.validateBaselineSchema(schema, 'planning').some((error) => error.includes('unresolved $ref')));
  }
});

for (const container of ['array items', 'nested object']) {
  test(`baseline combines same-property allOf constraints through ${container}`, () => {
    const schema = baseline('planning');
    const { required, properties } = schema.properties.episodes.items;
    const wrap = (item) => container === 'array items'
      ? { type: 'array', items: item }
      : { type: 'object', required: ['record'], properties: { record: item } };
    delete schema.properties.episodes;
    schema.allOf = [
      { properties: { episodes: wrap({ required }) } },
      { properties: { episodes: wrap({ properties }) } },
    ];
    assert.deepEqual(validation.validateBaselineSchema(schema, 'planning'), []);
    schema.allOf.reverse();
    assert.deepEqual(validation.validateBaselineSchema(schema, 'planning'), []);
    // Definitions on an unrelated path or in an alternative are not conjunctive evidence.
    schema.allOf[0].properties.other = schema.allOf[0].properties.episodes;
    delete schema.allOf[0].properties.episodes;
    assert.ok(validation.validateBaselineSchema(schema, 'planning').some((error) => error.includes('required version')));
    schema.allOf[0].properties.episodes = schema.allOf[0].properties.other;
    schema.anyOf = schema.allOf;
    delete schema.allOf;
    assert.ok(validation.validateBaselineSchema(schema, 'planning').some((error) => error.includes('required version')));
  });
}

test('combined allOf paths retain document-relative refs and cycle protection', () => {
  const schema = baseline('planning');
  const { required, properties } = schema.properties.episodes.items;
  delete schema.properties.episodes;
  schema.allOf = [{ $ref: 'requirements/schema.json' }, { $ref: 'definitions/schema.json' }];
  const schemas = new Map([
    ['requirements/schema.json', {
      allOf: [{ $ref: '#' }],
      properties: { episodes: { type: 'array', items: { $ref: '#/$defs/item' } } },
      $defs: { item: { required } },
    }],
    ['definitions/schema.json', {
      // Array type is supplied by the other conjunct, not repeated here.
      properties: { episodes: { items: { $ref: 'details.json#/$defs/item' } } },
    }],
    ['definitions/details.json', { $defs: { item: { properties } } }],
  ]);
  assert.deepEqual(validation.validateBaselineSchema(schema, 'planning.schema.json', schemas), []);
  schemas.get('requirements/schema.json').$defs.item.required = ['next'];
  schemas.get('definitions/details.json').$defs.item.properties = { next: { $ref: '#/$defs/item' } };
  assert.ok(validation.validateBaselineSchema(schema, 'planning.schema.json', schemas)
    .some((error) => error.includes('required version')));
});

test('unresolved and cyclic baseline references fail without crashing', () => {
  const schema = baseline('planning');
  schema.properties.episodes.items = { $ref: '#/$defs/missing' };
  assert.ok(validation.validateBaselineSchema(schema, 'planning').some((error) => error.includes('unresolved $ref')));
  schema.$defs = { missing: { $ref: '#/$defs/missing' } };
  assert.ok(validation.validateBaselineSchema(schema, 'planning').some((error) => error.includes('required version')));
});

// Independent expected names: do not derive the fixture from validator constants.
const mediaNames = ['quote_create', 'generate_image', 'generate_video', 'job_get', 'asset_get',
  'models_list', 'models_get', 'asset_create_upload', 'asset_confirm', 'job_cancel'];
const dramaNames = [
  'dramago_project_create', 'dramago_project_get', 'dramago_artifact_get',
  'dramago_artifact_revision_create', 'dramago_baseline_get', 'dramago_approval_get',
  'dramago_approval_revoke', 'dramago_run_get', 'dramago_workbench_get',
  'dramago_story_step_run', 'dramago_planning_review', 'dramago_planning_baseline_approve',
  'dramago_script_draft', 'dramago_script_review', 'dramago_script_baseline_approve',
  'dramago_production_step_run', 'dramago_production_package_approve',
  'dramago_production_generation_prepare', 'dramago_production_generate',
  'dramago_production_execution_get', 'dramago_production_result_review', 'dramago_stage09_review',
];
const catalog = () => readContract('tool-catalog.v1.json');

const tool = (name) => ({
  name, domain: 'story', maturity: 'contract_only', mutability: 'write',
  invariant: 'Review evidence is not approval.',
});

test('complete consensus catalog passes', () => {
  assert.deepEqual(validateToolCatalog(catalog()), []);
});

const readContract = (name) => JSON.parse(readFileSync(
  new URL(`../../packages/dramago-contracts/contracts/${name}`, import.meta.url), 'utf8'));

test('tool documentation retains every catalog policy row exactly once', () => {
  const doc = readFileSync(new URL('../../docs/dramago-mcp-v1/P0-TOOL-CATALOG.md', import.meta.url), 'utf8');
  const tick = (value) => '`' + value + '`';
  for (const tool of catalog().tools) {
    const cells = [tick(tool.name), tool.domain, tick(tool.maturity), tool.mutability,
      tool.idempotency_required ? 'yes' : 'no', tool.expected_revision_required ? 'yes' : 'no',
      tick(tool.authorization_class), tick(tool.async_result_kind), tool.invariant];
    const row = '| ' + cells.join(' | ') + ' |';
    assert.equal(doc.split(row).length - 1, 1, tool.name);
  }
});

test('checked-in P0 bundle passes integrated static validation', () => {
  assert.deepEqual(validation.validateRepository().errors, []);
});

test('checked-in catalog freezes only consensus names and read/write mutability', () => {
  const value = readContract('tool-catalog.v1.json');
  assert.deepEqual(value.tools.map(({ name }) => name).sort(), [...mediaNames, ...dramaNames].sort());
  assert.deepEqual(value.registered_aliases, []);
  assert.equal(value.runtime_registration, false);
  assert.equal(typeof value.field_semantics.mutability, 'string');
  assert.equal(Object.hasOwn(value.field_semantics, 'access'), false);
  for (const entry of value.tools) {
    assert.ok(['read', 'write'].includes(entry.mutability), entry.name);
    assert.equal(Object.hasOwn(entry, 'access'), false, entry.name);
  }
});

for (const kind of ['planning', 'script']) {
  test(`checked-in ${kind} baseline explicitly declares root immutability`, () => {
    assert.equal(readContract(`${kind}-baseline.schema.json`)['x-immutable'], true);
  });
}

for (const name of [...mediaNames, ...dramaNames]) {
  test(`required catalog tool cannot disappear: ${name}`, () => {
    const value = catalog();
    value.tools = value.tools.filter((entry) => entry.name !== name);
    assert.ok(validateToolCatalog(value).some((error) => error.includes(`missing required tool ${name}`)));
  });
}

for (const name of ['stage_run', 'approval_decide', 'dramago_stage_run', 'dramago_approval_decide']) {
  test(`forbidden generic tool is rejected: ${name}`, () => {
    const value = catalog();
    value.tools.push(tool(name));
    assert.ok(validateToolCatalog(value).some((error) => error.includes(`forbidden generic tool ${name}`)));
  });
}

for (const field of ['domain', 'maturity', 'mutability', 'invariant']) {
  test(`tool metadata must include nonempty ${field}`, () => {
    for (const empty of [undefined, null, '', '  ', [], {}]) {
      const value = catalog();
      value.tools.find((entry) => entry.name === 'quote_create')[field] = empty;
      assert.ok(validateToolCatalog(value).some((error) => error.includes(`quote_create: missing or empty ${field}`)));
    }
  });
}

test('malformed catalog and malformed tool record report errors', () => {
  for (const value of [null, [], {}, { tools: {} }]) assert.ok(validateToolCatalog(value).length);
  const value = catalog();
  value.tools.push(null, { name: ' quote_create ' });
  assert.ok(validateToolCatalog(value).some((error) => error.includes('tools[32]')));
  assert.ok(validateToolCatalog(value).some((error) => error.includes('invalid tool name')));
});

test('duplicate tool name is rejected with the offending name', () => {
  const errors = validateToolCatalog({ tools: [tool('dramago_project_get'), tool('dramago_project_get')] });
  assert.ok(errors.some((error) => /duplicate tool name.*dramago_project_get/.test(error)));
});

const contractDir = 'packages/dramago-contracts/contracts';
const docDir = 'docs/dramago-mcp-v1';
const docNames = ['P0-SOURCE-BASELINE.md', 'P0-ARCHITECTURE-DECISIONS.md', 'P0-TOOL-CATALOG.md',
  'P0-COMPATIBILITY-MATRIX.md', 'P0-MIGRATION-ROLLBACK.md', 'P0-USVDS-STAGE-MAPPING.md', 'P0-ACCEPTANCE-GATES.md'];
const planningPath = `${contractDir}/planning-baseline.schema.json`;
const scriptPath = `${contractDir}/script-baseline.schema.json`;
function fixtureFiles() {
  const files = new Map(docNames.map((name) => [`${docDir}/${name}`, `Fixture ${name}`]));
  files.set(`${docDir}/P0-SOURCE-BASELINE.md`, 'target main=8f33226\ncontracts source=8ef5218\napplication source=975464f\npersistence source=e3bcbf0\nMedia hardened source=8f33226');
  files.set(`${contractDir}/tool-catalog.v1.json`, JSON.stringify(catalog()));
  files.set(planningPath, JSON.stringify(baseline('planning')));
  files.set(scriptPath, JSON.stringify(baseline('script')));
  files.set(`${contractDir}/examples/planning.json`, JSON.stringify({ schema_version: 'fixture.planning/v1', baseline_id: 'pb', manifest_digest: 'digest',
    episodes: [{ episode_id: 'ep', artifact_version_id: 'av', content_hash: 'hash' }] }));
  return files;
}

test('complete in-memory P0 bundle passes static validation, not runtime acceptance', () => {
  const result = validation.validateP0Files(fixtureFiles());
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.counts, { json: 4, schemas: 2, examples: 1, instances: 1, tools: 32 });
});

for (const file of [...docNames.map((name) => `${docDir}/${name}`), `${contractDir}/tool-catalog.v1.json`]) {
  test(`missing required P0 file fails closed: ${file}`, () => {
    const files = fixtureFiles();
    files.delete(file);
    assert.ok(validation.validateP0Files(files).errors.some((error) => error.includes(`missing required file ${file}`)));
  });
}

test('absent schemas and examples fail closed', () => {
  const files = fixtureFiles();
  files.delete(planningPath);
  files.delete(scriptPath);
  files.delete(`${contractDir}/examples/planning.json`);
  const errors = validation.validateP0Files(files).errors;
  for (const expected of ['no contract schemas', 'no contract examples', 'missing planning baseline schema', 'missing script baseline schema']) {
    assert.ok(errors.some((error) => error.includes(expected)), errors.join('\n'));
  }
});

test('every JSON is parsed, including nested examples and non-schema contracts', () => {
  const files = fixtureFiles();
  files.set(`${contractDir}/examples/nested/broken.json`, '{');
  files.set(`${contractDir}/extra.json`, 'not JSON');
  files.set(scriptPath, '{');
  const errors = validation.validateP0Files(files).errors;
  for (const file of ['examples/nested/broken.json', 'extra.json', 'script-baseline.schema.json']) {
    assert.ok(errors.some((error) => error.includes(`${file}: invalid JSON`)));
  }
});

for (const field of ['$schema', '$id', 'title', 'type']) {
  test(`schema metadata requires ${field}`, () => {
    const files = fixtureFiles();
    const schema = baseline('script');
    delete schema[field];
    files.set(scriptPath, JSON.stringify(schema));
    assert.ok(validation.validateP0Files(files).errors.some((error) => error.includes(field)));
  });
}

test('invalid metadata values and duplicate schema IDs are rejected', () => {
  const files = fixtureFiles();
  const schema = baseline('script');
  Object.assign(schema, { $schema: 'not-a-uri', $id: 'relative-id', title: '', type: 'bogus' });
  files.set(scriptPath, JSON.stringify(schema));
  for (const field of ['$schema', '$id', 'title', 'type']) {
    assert.ok(validation.validateP0Files(files).errors.some((error) => error.includes(field)));
  }
  schema.$id = baseline('planning').$id;
  files.set(scriptPath, JSON.stringify(schema));
  assert.ok(validation.validateP0Files(files).errors.some((error) => error.includes('duplicate schema $id')));
});

test('reusable definition library need not invent a root instance type', () => {
  const files = fixtureFiles();
  files.set(`${contractDir}/common.schema.json`, JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:dramago:common', title: 'Common',
    $defs: { identifier: { type: 'string' } },
  }));
  assert.deepEqual(validation.validateP0Files(files).errors, []);
});

test('baseline required concepts can use another local schema by relative path or $id', () => {
  for (const ref of ['common.schema.json#/$defs/episode', 'urn:dramago:common#/$defs/episode']) {
    const files = fixtureFiles();
    const schema = baseline('planning');
    files.set(`${contractDir}/common.schema.json`, JSON.stringify({
      $schema: schema.$schema, $id: 'urn:dramago:common', title: 'Common',
      $defs: { episode: schema.properties.episodes.items },
    }));
    schema.properties.episodes.items = { $ref: ref };
    files.set(planningPath, JSON.stringify(schema));
    assert.deepEqual(validation.validateP0Files(files).errors, []);
  }
});

for (const commit of ['8f33226', '8ef5218']) {
  test(`fixed commit must occur in source-baseline doc, not merely another doc: ${commit}`, () => {
    const files = fixtureFiles();
    const file = `${docDir}/P0-SOURCE-BASELINE.md`;
    files.set(file, files.get(file).replaceAll(commit, 'unknown'));
    files.set(`${docDir}/P0-ACCEPTANCE-GATES.md`, `Unrelated mention of ${commit}`);
    assert.ok(validation.validateP0Files(files).errors.some((error) => error.includes(`missing fixed baseline commit ${commit}`)));
  });
}


for (const role of ['target main', 'contracts source', 'application source', 'persistence source', 'Media hardened source']) {
  test(`relocation provenance requires exact role and pin: ${role}`, () => {
    const files = fixtureFiles();
    const file = `${docDir}/P0-SOURCE-BASELINE.md`;
    const original = files.get(file);
    const line = original.split('\n').find((value) => value.startsWith(`${role}=`));
    for (const replacement of [line.replace(role, 'historical'), `${line}0`, `${line}suffix`, `${role}=unknown`]) {
      files.set(file, original.replace(line, replacement));
      assert.ok(validation.validateP0Files(files).errors.some((error) => error.includes(role)), replacement);
    }
  });
}

test('malformed required declarations report readable failures rather than throw', () => {
  for (const required of [42, {}, 'episode_id', ['episode_id', 42]]) {
    const files = fixtureFiles();
    const schema = baseline('planning');
    delete schema.readOnly;
    schema.required = required;
    schema.properties['42'] = { type: 'string' };
    files.set(planningPath, JSON.stringify(schema));
    const errors = validation.validateP0Files(files).errors;
    assert.ok(errors.some((error) => error.includes('required must be an array of strings')), errors.join('\n'));
  }
});

test('empty required documents are not accepted', () => {
  const files = fixtureFiles();
  files.set(`${docDir}/P0-MIGRATION-ROLLBACK.md`, ' \n ');
  assert.ok(validation.validateP0Files(files).errors.some((error) => error.includes('empty required file')));
});

function checkedInFiles() {
  const root = new URL('../../', import.meta.url);
  const files = new Map(validation.REQUIRED_P0_FILES.map((file) => [file, readFileSync(new URL(file, root), 'utf8')]));
  function collect(dir) {
    for (const entry of readdirSync(new URL(`${dir}/`, root), { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) collect(file);
      else if (file.endsWith('.json')) files.set(file, readFileSync(new URL(file, root), 'utf8'));
    }
  }
  collect(contractDir);
  return files;
}

function mutateJson(files, file, mutate) {
  const value = JSON.parse(files.get(file));
  mutate(value);
  files.set(file, JSON.stringify(value));
}

test('instance gate rejects duplicate media assets (uniqueItems)', () => {
  const files = checkedInFiles();
  const file = `${contractDir}/examples/media-execution-link.json`;
  mutateJson(files, file, (value) => value.media_asset_ids.push(value.media_asset_ids[0]));
  assert.ok(validation.validateP0Files(files).errors.some((error) => error.includes(file) && error.includes('uniqueItems')));
});

for (const [name, keyword, mutate] of [
  ['media-execution-link', 'dependentRequired', (v) => { delete v.quote_id; }],
  ['media-execution-link', 'dependentRequired', (v) => { delete v.budget_authorization_ref; }],
  ['media-execution-link', 'required media_job_id', (v) => { delete v.media_job_id; }],
  ['approval', 'required revoked_decision_ref', (v) => { v.decision = 'revoked'; }],
  ['approval', 'not', (v) => { v.revoked_decision_ref = v.target_refs[0]; }],
  ['script-approval', 'not', (v) => { v.decision = 'rejected'; v.revoked_decision_ref = v.target_refs[0]; }],
  ['project', 'minimum', (v) => { v.revision = -1; }],
  ['run', 'minimum', (v) => { v.steps[0].attempts[0].attempt = 0; }],
  ['media-execution-link', 'minimum', (v) => { v.execution_intent.generation_attempt = 0; }],
  ['project', 'minItems', (v) => { v.planning_range.ordered_episode_ids = []; }],
  ['planning-baseline', 'minItems', (v) => { v.manifest.review_evidence = []; }],
  ['project', 'format(date-time)', (v) => { v.created_at = '2025-02-29T10:00:00Z'; }],
  ['project', 'additionalProperties', (v) => { v.approved = true; }],
  ['project', 'minLength', (v) => { v.name = ''; }],
  ['media-execution-link', 'maxLength', (v) => { v.quote_id = 'q'.repeat(257); }],
  ['artifact', 'type', (v) => { v.content = 42; }],
  ['artifact', 'pattern', (v) => { v.version_id = 'job.version'; }],
  ['artifact', 'not', (v) => { v.version_id = 'av_latest'; }],
  ['script-baseline', 'const', (v) => { v.manifest.doctor_evidence.outcome = 'FAIL'; }],
  ['run', 'enum', (v) => { v.domain = 'media'; }],
]) {
  test(`current-schema instance rejects ${name}: ${keyword} ${mutate}`, () => {
    const files = checkedInFiles();
    const file = `${contractDir}/examples/${name}.json`;
    mutateJson(files, file, mutate);
    const errors = validation.validateP0Files(files).errors;
    assert.ok(errors.some((e) => e.includes(file) && e.includes(keyword)), errors.join('\n'));
  });
}

test('creative run rejects stages outside its declared domain', () => {
  for (const [domain, stage] of [['story', 'usvds.03'], ['script', 'story.direction'], ['production', 'usvds.04']]) {
    const files = checkedInFiles();
    const file = `${contractDir}/examples/run.json`;
    mutateJson(files, file, (value) => { value.domain = domain; value.steps[0].stage = stage; });
    const errors = validation.validateP0Files(files).errors;
    assert.ok(errors.some((e) => e.includes(file) && e.includes('enum')), `${domain} accepted ${stage}: ${errors.join('\n')}`);
  }
});

test('every checked-in record, including each supporting artifact, uses schema_version', () => {
  const original = checkedInFiles();
  let count = 0;
  for (const [file, text] of original) {
    if (!file.startsWith(`${contractDir}/examples/`)) continue;
    const data = JSON.parse(text);
    const records = Array.isArray(data) ? data : [data];
    for (let index = 0; index < records.length; index++) {
      count++;
      for (const badVersion of [undefined, 'unknown/v999', 'dramago.creative-run/v1']) {
        const files = new Map(original);
        const broken = structuredClone(data);
        (Array.isArray(broken) ? broken[index] : broken).schema_version = badVersion;
        // A Run already has this version: use another valid schema to prove selection.
        if (records[index].schema_version === badVersion) {
          (Array.isArray(broken) ? broken[index] : broken).schema_version = 'dramago.drama-project/v1';
        }
        files.set(file, JSON.stringify(broken));
        const label = Array.isArray(data) ? `${file}[${index}]` : file;
        assert.ok(validation.validateP0Files(files).errors.some((e) => e.includes(label)), label);
      }
    }
  }
  assert.equal(count, 24);
  assert.equal(validation.validateP0Files(original).counts.instances, count);
});

test('valid revocation and prepared intent pass instance validation, not semantic authorization', () => {
  const files = checkedInFiles();
  mutateJson(files, `${contractDir}/examples/approval.json`, (v) => {
    v.decision = 'revoked'; v.revoked_decision_ref = v.target_refs[0];
  });
  mutateJson(files, `${contractDir}/examples/media-execution-link.json`, (v) => {
    v.media_asset_ids = [];
    for (const key of ['media_job_id', 'quote_id', 'budget_authorization_ref']) delete v[key];
  });
  assert.deepEqual(validation.validateP0Files(files).errors, []);
});

for (const place of ['root', 'unused definition', 'optional property', 'unselected conditional', 'not']) {
  test(`unsupported future keywords fail closed in ${place}`, () => {
    for (const keyword of ['maxItems', 'unevaluatedProperties', 'futureValidationRule', 'x-new-assertion']) {
      const files = checkedInFiles();
      mutateJson(files, `${contractDir}/artifact-version.schema.json`, (s) => {
        const future = { [keyword]: 0 };
        if (place === 'root') Object.assign(s, future);
        else if (place === 'unused definition') s.$defs = { unused: future };
        else if (place === 'optional property') s.properties.unused = future;
        else if (place === 'not') s.not = future;
        else Object.assign(s, { if: false, then: future });
      });
      assert.ok(validation.validateP0Files(files).errors.some((e) => e.includes(`unsupported validation keyword ${keyword}`)));
    }
  });
}

function instanceErrors(schema, value) {
  const validator = createInstanceValidator(new Map([['test.schema.json', schema]]));
  return validator.validate(value, 'test.schema.json');
}

test('date-time validates calendar, timezone and leap-second syntax', () => {
  const schema = { format: 'date-time' };
  for (const value of ['2024-02-29T12:30:59.123456Z', '2024-02-29t12:30:59z',
    '2000-02-29T00:00:00-00:00', '2026-01-01T12:00:00+23:59',
    '2016-12-31T23:59:60Z', '2017-01-01T00:59:60+01:00', '2016-12-31T15:59:60-08:00']) {
    assert.deepEqual(instanceErrors(schema, value), [], value);
  }
  for (const value of ['2023-02-29T00:00:00Z', '1900-02-29T00:00:00Z', '2026-04-31T00:00:00Z',
    '2026-00-01T00:00:00Z', '2026-01-00T00:00:00Z', '2026-01-01', '2026-01-01T00:00:00',
    '2026-01-01 00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:60:00Z',
    '2026-01-01T00:00:61Z', '2026-01-01T00:00:00+24:00', '2026-01-01T00:00:00+00:60',
    '2016-12-31T22:59:60Z', '2026-01-31T23:59:60Z', '2026-01-01T00:00:00Z\n']) {
    assert.ok(instanceErrors(schema, value).length, value);
  }
});

test('JSON equality ignores object order but preserves types and array order', () => {
  assert.ok(instanceErrors({ uniqueItems: true }, [{ a: 1, b: [2] }, { b: [2], a: 1 }]).length);
  assert.ok(instanceErrors({ uniqueItems: true }, [0, -0]).length);
  assert.deepEqual(instanceErrors({ uniqueItems: true }, [true, 1, [1, 2], [2, 1]]), []);
  assert.deepEqual(instanceErrors({ const: { a: 1, b: 2 } }, { b: 2, a: 1 }), []);
  assert.ok(instanceErrors({ enum: [true] }, 1).length);
});

test('keyword applicability, Unicode length, ref siblings and booleans', () => {
  assert.deepEqual(instanceErrors({ minLength: 1, maxLength: 1 }, '😀'), []);
  assert.ok(instanceErrors({ maxLength: 1 }, '😀😀').length);
  assert.deepEqual(instanceErrors({ minItems: 1, minimum: 1, pattern: 'no' }, null), []);
  assert.deepEqual(instanceErrors({ type: ['string', 'object'] }, {}), []);
  assert.ok(instanceErrors({ type: 'integer' }, true).length);
  assert.ok(instanceErrors({ type: 'integer' }, 1.5).length);
  assert.deepEqual(instanceErrors({ type: 'integer' }, 1.0), []);
  assert.deepEqual(instanceErrors({ additionalProperties: { type: 'string' } }, { extra: 'yes' }), []);
  assert.ok(instanceErrors({ additionalProperties: { type: 'string' } }, { extra: 42 }).length);
  assert.ok(instanceErrors({ $defs: { value: { type: 'string' } }, $ref: '#/$defs/value', minLength: 2 }, 'a').length);
  assert.ok(instanceErrors({ items: false }, [1]).length);
  assert.deepEqual(instanceErrors({ items: false }, []), []);
  assert.deepEqual(instanceErrors({ then: false, else: false }, 1), []);
  assert.ok(instanceErrors({ if: true, then: false }, 1).length);
  assert.ok(instanceErrors({ if: false, else: false }, 1).length);
  assert.deepEqual(instanceErrors({ not: false }, 1), []);
  assert.ok(instanceErrors({ not: true }, 1).length);
});

for (const keyword of ['readOnly', 'x-immutable', 'const']) {
  for (const value of [true, false]) {
    test(`schema-location refs reject boolean ${keyword} data: ${value}`, () => {
      const schema = { [keyword]: value, $ref: `#/${keyword}`, $defs: { legitimate: value } };
      const validator = createInstanceValidator(new Map([['test.schema.json', schema]]));
      assert.ok(validator.errors.some((e) => e.includes('$ref target is not a schema location')));
      assert.deepEqual(validator.validate(value, 'test.schema.json'), validator.errors);
    });
  }
}

test('schema-location refs reject const data even when its object is also a schema', () => {
  const shared = { type: 'string' };
  for (const ref of ['#/const', 'library.schema.json#/const']) {
    const validator = createInstanceValidator(new Map([
      ['test.schema.json', { $ref: ref, const: shared, $defs: { legitimate: shared } }],
      ['library.schema.json', { const: shared }],
    ]));
    assert.ok(validator.errors.some((e) => e.includes('$ref target is not a schema location')), ref);
  }
});

test('schema-location refs reject project created_at pointing to baseline annotation', () => {
  const files = checkedInFiles();
  const schemaFile = `${contractDir}/drama-project.schema.json`;
  mutateJson(files, schemaFile, (schema) => {
    schema.properties.created_at = { $ref: 'planning-baseline.schema.json#/x-immutable' };
  });
  mutateJson(files, `${contractDir}/examples/project.json`, (value) => { value.created_at = 'not-a-date'; });
  assert.ok(validation.validateP0Files(files).errors.some((e) => e.includes(`${schemaFile}#/properties/created_at`)
    && e.includes('$ref target is not a schema location')));
});

test('schema-location refs allow boolean definitions with normalized escaped pointers', () => {
  for (const value of [true, false]) {
    for (const [name, pointer] of [['plain', 'plain'], ['a/b~c', 'a~1b~0c'],
      ['a/b~c', '%61%7E1b%7E0c'], ['~1', '~01'], ['', '']]) {
      for (const resource of ['', 'library.schema.json', 'urn:library']) {
        const definitions = { [name]: value };
        const validator = createInstanceValidator(new Map([
          ['test.schema.json', { $defs: definitions, $ref: `${resource}#/$defs/${pointer}` }],
          ['library.schema.json', { $id: 'urn:library', $defs: definitions }],
        ]));
        assert.deepEqual(validator.errors, []);
        const errors = validator.validate('anything', 'test.schema.json');
        if (value) assert.deepEqual(errors, []);
        else assert.ok(errors.some((e) => e.includes('false schema')));
      }
    }
  }
});

test('schema preflight rejects malformed and unsupported forms even without instances', () => {
  for (const schema of [{ format: 'email' }, { type: 'bogus' }, { type: [] }, { pattern: '[' },
    { minItems: -1 }, { minimum: '0' }, { uniqueItems: 1 }, { required: 'x' }, { allOf: [] },
    { dependentRequired: { x: 'y' } }, { enum: [] }, { items: [] }, { properties: [] },
    { $defs: { nested: { $id: 'urn:nested' } } }, { $schema: 'http://json-schema.org/draft-07/schema#' },
    { $ref: 'https://unloaded.invalid/schema' }, { $ref: '#/const', const: { type: 'string' } }]) {
    assert.ok(createInstanceValidator(new Map([['test.schema.json', schema]])).errors.length, JSON.stringify(schema));
  }
  for (const schema of [{ $ref: '#' }, { not: { $ref: '#' } }, { if: { $ref: '#' }, else: true }]) {
    assert.ok(instanceErrors(schema, 1).some((e) => e.includes('cyclic')), JSON.stringify(schema));
  }
  assert.deepEqual(instanceErrors({ title: 'a', description: 'b', $comment: 'c', 'x-immutable': true,
    const: { futureKeyword: true }, properties: { futureKeyword: { type: 'boolean' } } }, { futureKeyword: true }), []);
});

for (const [field, value] of [['mutability', 'read'], ['idempotency_required', false],
  ['expected_revision_required', false], ['authorization_class', 'project.read']]) {
  test(`unified catalog gate rejects production_generate policy regression: ${field}`, () => {
    const files = checkedInFiles();
    mutateJson(files, `${contractDir}/tool-catalog.v1.json`, (c) => {
      c.tools.find((t) => t.name === 'dramago_production_generate')[field] = value;
    });
    assert.ok(validation.validateP0Files(files).errors.some((e) => e.includes('dramago_production_generate') && e.includes(field)));
  });
}

test('malformed schema roots fail with diagnostics rather than crashing', () => {
  for (const root of [null, [], 1, 'schema']) {
    const files = checkedInFiles();
    files.set(`${contractDir}/artifact-version.schema.json`, JSON.stringify(root));
    assert.ok(validation.validateP0Files(files).errors.length);
  }
});

for (const name of [...mediaNames, ...dramaNames]) {
  test(`catalog policy floor for every tool: ${name}`, () => {
    for (const key of ['group', 'domain', 'maturity', 'implementation_status', 'mutability',
      'idempotency_required', 'expected_revision_required', 'authorization_class', 'async_result_kind']) {
      const value = catalog();
      const entry = value.tools.find((t) => t.name === name);
      entry[key] = typeof entry[key] === 'boolean' ? !entry[key] : 'weakened';
      assert.ok(validateToolCatalog(value).some((e) => e.includes(name) && e.includes(key)), `${name}: ${key}`);
      delete entry[key];
      assert.ok(validateToolCatalog(value).some((e) => e.includes(name) && e.includes(key)), `missing ${name}: ${key}`);
    }
  });
}

for (const name of ['quote_create', 'generate_image', 'generate_video', 'job_get', 'asset_get']) {
  test(`preserved Media semantics cannot change: ${name}`, () => {
    const value = catalog();
    const entry = value.tools.find((t) => t.name === name);
    entry.invariant = 'Require project_id; successful Media automatically approves Drama.';
    assert.ok(validateToolCatalog(value).some((e) => e.includes(name) && e.includes('invariant')));
    const fields = catalog();
    fields.tools.find((t) => t.name === name).required_drama_fields = ['project_id'];
    assert.ok(validateToolCatalog(fields).some((e) => e.includes(name) && e.includes('fields')));
  });
}

test('catalog membership, aliases, runtime claims and Media boundary cannot drift', () => {
  for (const field of ['preserved_media_names', 'planned_media_names', 'registered_aliases', 'runtime_registration']) {
    const value = catalog();
    value[field] = field === 'runtime_registration' ? true : ['media_alias'];
    assert.ok(validateToolCatalog(value).some((e) => e.includes(field)));
  }
  for (const field of ['story_step_allowlist', 'production_step_allowlist', 'production_plan_types', 'media_boundary', 'compatibility']) {
    const value = catalog();
    value.policies[field] = 'unrestricted';
    assert.ok(validateToolCatalog(value).some((e) => e.includes(field)));
  }
});

test('instance refs resolve locally by file or ID with JSON Pointer escaping', () => {
  for (const ref of ['library.schema.json#/$defs/a~1b~0c', 'urn:library#/$defs/a~1b~0c']) {
    const schemas = new Map([
      ['test.schema.json', { $ref: ref }],
      ['library.schema.json', { $id: 'urn:library', $defs: { 'a/b~c': { type: 'integer', minimum: 1 } } }],
    ]);
    const validator = createInstanceValidator(schemas);
    assert.deepEqual(validator.errors, []);
    assert.deepEqual(validator.validate(1, 'test.schema.json'), []);
    assert.ok(validator.validate(0, 'test.schema.json').some((e) => e.includes('minimum')));
  }
});

test('CLI checks its own repository independent of cwd and mirrors helper exit status', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const result = validation.validateRepository(root);
  const child = spawnSync(process.execPath, [path.join(root, 'scripts/validate-dramago-p0.mjs')], {
    cwd: path.join(root, 'tests/dramago'), encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(child.error);
  assert.equal(child.status, result.errors.length ? 1 : 0, child.stderr);
  const output = child.stdout + child.stderr;
  assert.match(output, /DramaGo P0 contract validation (PASSED|FAILED)/);
  for (const error of result.errors) assert.ok(output.includes(error), `CLI omitted ${error}`);
});
