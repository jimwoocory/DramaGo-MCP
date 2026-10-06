// Development/reference persistence ONLY. Not a PostgreSQL replacement.
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, writeSync, fsyncSync, ftruncateSync, renameSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { InMemoryDramaRepository } from './memory.js';
import { canonical, fail, requiredString } from './shared.js';

const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');

export class JournalDramaRepository extends InMemoryDramaRepository {
  constructor(options = {}) {
    super(options);
    this.directory = resolve(requiredString(options.directory, 'directory'));
    mkdirSync(this.directory, { recursive: true });
    this._lockPath = join(this.directory, 'writer.lock');
    this._token = randomUUID();
    this._closed = false;
    this._poisoned = false;
    this._sequence = 0;
    this._digest = null;
    this._acquireLock();
    try {
      this._fd = openSync(join(this.directory, 'journal.jsonl'), 'a+');
      this._recover();
    } catch (error) {
      if (this._fd !== undefined) closeSync(this._fd);
      this._releaseLock();
      throw error;
    }
  }
  _acquireLock() {
    for (let attempt = 0; attempt < 2; attempt++) {
      let fd;
      try {
        fd = openSync(this._lockPath, 'wx');
        writeFileSync(fd, JSON.stringify({ pid: process.pid, token: this._token }));
        fsyncSync(fd);
        return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let owner;
        try { owner = JSON.parse(readFileSync(this._lockPath, 'utf8')); }
        catch { fail('INVALID_STATE_TRANSITION', 'unreadable writer lock; operator inspection required'); }
        if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) fail('INVALID_STATE_TRANSITION', 'invalid writer lock');
        let alive = true;
        try { process.kill(owner.pid, 0); }
        catch (probe) { if (probe.code === 'ESRCH') alive = false; }
        if (alive) fail('INVALID_STATE_TRANSITION', 'journal already has a live writer');
        // Local single-host development only. Stale recovery is serialized by a
        // second O_EXCL lock, then the observed writer lock is re-read before
        // removal. This prevents two recovery processes from unlinking each
        // other's replacement writer lock.
        const recoveryPath = this._lockPath + '.recovery';
        let recoveryFd;
        try {
          recoveryFd = openSync(recoveryPath, 'wx');
          writeFileSync(recoveryFd, JSON.stringify({ pid: process.pid, token: this._token, observed: owner.token }));
          fsyncSync(recoveryFd);
        } catch (recoveryError) {
          if (recoveryError.code === 'EEXIST') fail('INVALID_STATE_TRANSITION', 'stale journal lock recovery already in progress');
          throw recoveryError;
        }
        try {
          let current;
          try { current = JSON.parse(readFileSync(this._lockPath, 'utf8')); }
          catch { fail('INVALID_STATE_TRANSITION', 'writer lock changed during stale recovery'); }
          if (current.pid !== owner.pid || current.token !== owner.token) {
            fail('INVALID_STATE_TRANSITION', 'writer lock changed during stale recovery');
          }
          let stillAlive = true;
          try { process.kill(current.pid, 0); }
          catch (probe) { if (probe.code === 'ESRCH') stillAlive = false; }
          if (stillAlive) fail('INVALID_STATE_TRANSITION', 'journal writer became live during stale recovery');
          unlinkSync(this._lockPath);
        } finally {
          if (recoveryFd !== undefined) closeSync(recoveryFd);
          try { unlinkSync(recoveryPath); } catch {}
        }
      } finally { if (fd !== undefined) closeSync(fd); }
    }
    fail('INVALID_STATE_TRANSITION', 'could not acquire journal lock');
  }
  _releaseLock() {
    const owner = JSON.parse(readFileSync(this._lockPath, 'utf8'));
    if (owner.token === this._token) unlinkSync(this._lockPath);
  }
  _recover() {
    const bytes = readFileSync(this._fd);
    const end = bytes.lastIndexOf(10) + 1;
    const lines = bytes.subarray(0, end).toString('utf8').split('\n').slice(0, -1);
    for (const line of lines) {
      let envelope;
      try { envelope = JSON.parse(line); }
      catch { fail('VALIDATION_ERROR', 'corrupt committed journal line'); }
      const { checksum, ...entry } = envelope;
      if (entry.tenantId !== this.tenantId && entry.tenantId !== undefined) fail('FORBIDDEN', 'journal tenant mismatch');
      if (entry.format !== 1 || entry.sequence !== this._sequence + 1 || entry.previous !== this._digest
          || entry.tenantId !== this.tenantId || !Array.isArray(entry.ops) || checksum !== digest(entry)) {
        fail('VALIDATION_ERROR', 'journal sequence/checksum mismatch');
      }
      for (const op of entry.ops) {
        if (!Object.hasOwn(this._state, op.table) || typeof op.key !== 'string' || !op.value) fail('VALIDATION_ERROR', 'invalid journal operation');
        this._state[op.table].set(op.key, op.value);
      }
      this._sequence = entry.sequence;
      this._digest = checksum;
    }
    // Only the unterminated tail is uncommitted. Never skip corrupt complete lines.
    if (end !== bytes.length) {
      // Windows append handles lack truncate rights; use a separate recovery handle.
      const repair = openSync(join(this.directory, 'journal.jsonl'), 'r+');
      try { ftruncateSync(repair, end); fsyncSync(repair); } finally { closeSync(repair); }
    }
    // snapshot.json is a disposable projection. Always rebuild from the authoritative log.
  }
  _assertOpen() {
    if (this._closed || this._poisoned) fail('INVALID_STATE_TRANSITION', 'journal closed or write outcome uncertain; reopen before retry');
  }
  _exclusive(fn) { return super._exclusive(() => { this._assertOpen(); return fn(); }); }
  async _commit(context) {
    this._assertOpen();
    if (!context.ops.length) return;
    const entry = { format: 1, tenantId: this.tenantId, sequence: this._sequence + 1, previous: this._digest, ops: context.ops };
    const checksum = digest(entry);
    const buffer = Buffer.from(JSON.stringify({ ...entry, checksum }) + '\n');
    try {
      let offset = 0;
      while (offset < buffer.length) {
        const written = writeSync(this._fd, buffer, offset, buffer.length - offset);
        if (!written) throw new Error('journal made no write progress');
        offset += written;
      }
      fsyncSync(this._fd);
    } catch (error) { this._poisoned = true; throw error; }
    this._sequence = entry.sequence;
    this._digest = checksum;
  }
  async checkpoint() {
    if (this._active()) fail('INVALID_STATE_TRANSITION', 'checkpoint cannot run inside transaction');
    return this._exclusive(() => {
      const snapshot = { format: 1, tenantId: this.tenantId, sequence: this._sequence, checksum: this._digest,
        tables: Object.fromEntries(Object.entries(this._state).map(([key, values]) => [key, [...values.entries()]])) };
      const temporary = join(this.directory, `snapshot.${this._token}.tmp`);
      const fd = openSync(temporary, 'w');
      try { writeFileSync(fd, JSON.stringify(snapshot)); fsyncSync(fd); }
      finally { closeSync(fd); }
      renameSync(temporary, join(this.directory, 'snapshot.json'));
      return snapshot;
    });
  }
  async close() {
    if (this._active()) fail('INVALID_STATE_TRANSITION', 'close cannot run inside transaction');
    return super._exclusive(() => {
      if (this._closed) return;
      this._closed = true;
      try { closeSync(this._fd); } finally { this._releaseLock(); }
    });
  }
}
