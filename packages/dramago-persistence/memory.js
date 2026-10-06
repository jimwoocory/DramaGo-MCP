import { AsyncLocalStorage } from 'node:async_hooks';
import { copy, fail, requiredString, revision, patchHead, canonical, idempotencyKey, validateIdempotency, authorizeWith, owner, baselineId, baselineItems, validateRef, sameRef, validateRun, validateApproval, validateRevocation } from './shared.js';

export class InMemoryDramaRepository {
  constructor({ tenantId, authorize } = {}) {
    this._authorize = authorize;
    this.tenantId = requiredString(tenantId, 'tenantId');
    this._state = Object.fromEntries(['projects', 'idempotency', 'versions', 'baselines', 'approvals', 'runs', 'audit', 'outbox'].map((key) => [key, new Map()]));
    this._context = new AsyncLocalStorage();
    this._tail = Promise.resolve();
  }
  _exclusive(fn) {
    const next = this._tail.then(fn);
    this._tail = next.catch(() => {});
    return next;
  }
  _active() {
    const context = this._context.getStore();
    if (context && !context.active) fail('INVALID_STATE_TRANSITION', 'transaction has finished');
    return context;
  }
  async _commit(_context) {}
  async transaction(fn) {
    const parent = this._active();
    const execute = async () => {
      const context = { state: copy(parent?.state ?? this._state), ops: [], active: true };
      try {
        const result = await this._context.run(context, () => fn(this));
        if (parent) { parent.state = context.state; parent.ops.push(...context.ops); }
        else { await this._commit(context); this._state = context.state; }
        return result;
      } finally { context.active = false; }
    };
    return parent ? execute() : this._exclusive(execute);
  }
  async _read(fn) {
    const context = this._active();
    return copy(context ? fn(context.state) : await this._exclusive(() => fn(this._state)));
  }
  async _write(fn) {
    if (!this._active()) return this.transaction(() => this._write(fn));
    return copy(fn(this._active().state));
  }
  _set(table, key, value) {
    canonical(value);
    const context = this._active();
    context.state[table].set(key, copy(value));
    context.ops.push({ table, key, value: copy(value) });
    return value;
  }
  async authorize(auth, action, resource) { return authorizeWith(this, auth, action, resource); }
  _checkOwner(state, record) {
    const scope = owner(record);
    const project = state.projects.get(scope.project_id);
    if (!project) fail('NOT_FOUND', 'project not found');
    if (scope.workspace_id !== undefined && project.workspace_id !== scope.workspace_id) fail('VALIDATION_ERROR', 'workspace mismatch');
  }
  _insert(state, table, key, record, code = 'VALIDATION_ERROR') {
    requiredString(key, 'record id');
    const previous = state[table].get(key);
    if (previous) {
      if (canonical(previous) !== canonical(record)) fail(code, 'immutable record already exists');
      return previous;
    }
    this._checkOwner(state, record);
    return this._set(table, key, record);
  }
  async putArtifactVersion(version) {
    validateRef(version);
    return this._write((s) => this._insert(s, 'versions', version.version_id, version));
  }
  async getArtifactVersion(id) { return this._read((s) => s.versions.get(id) ?? null); }
  async listArtifactVersions(id) { return this._read((s) => [...s.versions.values()].filter((v) => v.artifact_id === id)); }
  async putBaseline(baseline) {
    const id = baselineId(baseline);
    validateRef(baseline);
    return this._write((s) => {
      if (s.baselines.has(id)) return this._insert(s, 'baselines', id, baseline, 'BASELINE_IMMUTABLE');
      if ([...s.baselines.values()].some((b) => b.version_id === baseline.version_id)) fail('BASELINE_IMMUTABLE');
      const items = baselineItems(baseline);
      if (!items.length || new Set(items.map((i) => i.episode_id)).size !== items.length) fail('BASELINE_INCOMPLETE');
      for (const item of items) {
        requiredString(item.episode_id, 'episode_id');
        validateRef(item.ref);
        const version = s.versions.get(item.ref.version_id);
        if (!sameRef(version, item.ref) || version.project_id !== baseline.manifest.project_id) fail('VALIDATION_ERROR', 'invalid baseline item reference');
      }
      if (baseline.script_baseline_id) {
        const planning = s.baselines.get(baseline.manifest.planning_baseline_id);
        if (!sameRef(planning, baseline.manifest.planning_baseline_ref) || planning.manifest.project_id !== baseline.manifest.project_id) fail('VALIDATION_ERROR', 'invalid planning baseline reference');
      }
      return this._insert(s, 'baselines', id, baseline, 'BASELINE_IMMUTABLE');
    });
  }
  async getBaseline(id) { return this._read((s) => s.baselines.get(id) ?? null); }
  async getBaselineByVersion(versionId, projectId) {
    return this._read((s) => [...s.baselines.values()].find((b) => b.version_id === versionId && b.manifest.project_id === projectId) ?? null);
  }
  async appendApproval(decision) {
    validateApproval(decision);
    return this._write((s) => {
      if (s.approvals.has(decision.approval_id)) return this._insert(s, 'approvals', decision.approval_id, decision, 'APPROVAL_INVALID');
      if ([...s.approvals.values()].some((a) => a.version_id === decision.version_id)) fail('APPROVAL_INVALID');
      if (decision.decision === 'revoked') {
        const previous = [...s.approvals.values()].find((a) => sameRef(a, decision.revoked_decision_ref));
        validateRevocation(decision, previous);
      }
      return this._insert(s, 'approvals', decision.approval_id, decision, 'APPROVAL_INVALID');
    });
  }
  async listApprovals(ref) {
    validateRef(ref);
    return this._read((s) => [...s.approvals.values()].filter((a) => a.target_refs.some((target) => sameRef(target, ref))));
  }
  async putRun(run) {
    const value = { ...copy(run), revision: run.revision ?? 0 };
    validateRun(value);
    return this._write((s) => this._insert(s, 'runs', value.run_id, value, 'REVISION_CONFLICT'));
  }
  async getRun(id) { return this._read((s) => s.runs.get(id) ?? null); }
  async compareAndSetRun(id, expected, patch) {
    return this._write((s) => {
      const value = patchHead(s.runs.get(id), expected, patch, ['run_id', 'domain', 'input_manifest', 'input_manifest_digest']);
      validateRun(value);
      return this._set('runs', id, value);
    });
  }
  async appendAudit(event) { return this._write((s) => this._insert(s, 'audit', event.event_id, event)); }
  async appendOutbox(event) { return this._write((s) => this._insert(s, 'outbox', event.event_id, event)); }
  async createProject(project) {
    const value = copy(project);
    requiredString(value.project_id, 'project_id');
    requiredString(value.workspace_id, 'workspace_id');
    revision(value.revision);
    return this._write((state) => {
      if (state.projects.has(value.project_id)) fail('REVISION_CONFLICT');
      return this._set('projects', value.project_id, value);
    });
  }
  async getProject(id) { return this._read((s) => s.projects.get(id) ?? null); }
  async compareAndSetProject(id, expected, patch) {
    return this._write((s) => this._set('projects', id, patchHead(s.projects.get(id), expected, patch, [])));
  }
  async findIdempotency(scope, key) {
    const id = idempotencyKey(scope, key);
    return this._read((s) => s.idempotency.get(id) ?? null);
  }
  async putIdempotency(record) {
    validateIdempotency(record);
    const id = idempotencyKey(record.scope, record.key);
    return this._write((s) => {
      const existing = s.idempotency.get(id);
      if (existing) {
        if (existing.payloadHash !== record.payloadHash) fail('IDEMPOTENCY_CONFLICT');
        return existing;
      }
      return this._set('idempotency', id, record);
    });
  }
}
