import { fixture } from './helpers/fixtures.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, appendFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { JournalDramaRepository } from '../../packages/dramago-persistence/index.js';


test('journal reopens committed transactions; snapshots are disposable read models', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dramago-journal-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const options = { tenantId: 'tenant_test', directory };
  let repo = new JournalDramaRepository(options);
  t.after(async () => { await repo.close(); });
  assert.throws(() => new JournalDramaRepository(options), { code: 'INVALID_STATE_TRANSITION' });
  const project = fixture('project');
  const idem = { scope: 'create', key: 'key', payloadHash: 'digest', result: project };
  await repo.transaction(async (tx) => {
    await tx.createProject(project);
    await tx.putArtifactVersion(fixture('artifact'));
    await tx.putIdempotency(idem);
    await tx.appendAudit({ event_id: 'audit1', project_id: project.project_id });
    await tx.appendOutbox({ event_id: 'outbox1', project_id: project.project_id });
  });
  await assert.rejects(repo.transaction(async (tx) => {
    await tx.compareAndSetProject(project.project_id, 0, { name: 'not committed' });
    throw new Error('abort');
  }), /abort/);
  await repo.checkpoint();
  const snapshot = JSON.parse(readFileSync(join(directory, 'snapshot.json'), 'utf8'));
  assert.equal(snapshot.sequence, 1);
  assert.equal(snapshot.tables.audit.length, 1);
  assert.equal(snapshot.tables.outbox.length, 1);
  await repo.close();
  await assert.rejects(repo.createProject(project), { code: 'INVALID_STATE_TRANSITION' });
  writeFileSync(join(directory, 'snapshot.json'), 'corrupt disposable cache');
  appendFileSync(join(directory, 'journal.jsonl'), '{"sequence":2,"ops":[');
  repo = new JournalDramaRepository(options);
  assert.deepEqual(await repo.getProject(project.project_id), project);
  assert.deepEqual(await repo.findIdempotency('create', 'key'), idem);
  assert.deepEqual(await repo.getArtifactVersion(fixture('artifact').version_id), fixture('artifact'));
  await repo.compareAndSetProject(project.project_id, 0, { name: 'after restart' });
  await repo.close();
  repo = new JournalDramaRepository(options);
  assert.equal((await repo.getProject(project.project_id)).revision, 1);
  await assert.rejects(repo.compareAndSetProject(project.project_id, 0, {}), { code: 'REVISION_CONFLICT' });
  await repo.close();
  assert.throws(() => new JournalDramaRepository({ ...options, tenantId: 'another_tenant' }), { code: 'FORBIDDEN' });
  appendFileSync(join(directory, 'journal.jsonl'), '{"invalid":"committed line"}\n');
  assert.throws(() => new JournalDramaRepository(options), { code: 'VALIDATION_ERROR' });
});


test('stale journal recovery is serialized and never removes a replacement writer lock', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dramago-stale-recovery-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const entry = new URL('../../packages/dramago-persistence/index.js', import.meta.url).href;
  const lock = join(directory, 'writer.lock');
  // A definitely dead pid on the test host; the recovery path will re-check it.
  writeFileSync(lock, JSON.stringify({ pid: 2147483647, token: 'dead-owner' }));

  const script = `import { JournalDramaRepository } from ${JSON.stringify(entry)};
    try {
      const repo = new JournalDramaRepository(${JSON.stringify({ directory, tenantId: 'tenant_test' })});
      await new Promise(resolve => setTimeout(resolve, 80));
      await repo.close();
      console.log('acquired');
    } catch (error) {
      console.log('rejected:' + error.code);
    }`;
  const children = await Promise.all([0, 1].map(() => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  })));
  assert.equal(children.every(item => item.status === 0), true, JSON.stringify(children));
  assert.equal(children.filter(item => item.stdout.includes('acquired')).length, 1, JSON.stringify(children));
  assert.equal(children.filter(item => item.stdout.includes('rejected:INVALID_STATE_TRANSITION')).length, 1, JSON.stringify(children));
});

test('journal survives process exit without close and ignores an uncommitted transaction', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dramago-crash-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const entry = new URL('../../packages/dramago-persistence/index.js', import.meta.url).href;
  const project = fixture('project');
  const script = `import { JournalDramaRepository } from ${JSON.stringify(entry)};
    const repo = new JournalDramaRepository(${JSON.stringify({ directory, tenantId: 'tenant_test' })});
    await repo.createProject(${JSON.stringify(project)});
    await repo.transaction(async tx => {
      await tx.compareAndSetProject('project_example', 0, {name:'never committed'});
      process.exit(0);
    });`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const repo = new JournalDramaRepository({ directory, tenantId: 'tenant_test' });
  try { assert.deepEqual(await repo.getProject(project.project_id), project); }
  finally { await repo.close(); }
});
