export class DramaRepositoryError extends Error {
  constructor(code, message = code) { super(message); this.name = 'DramaRepositoryError'; this.code = code; }
}
export function fail(code, message) { throw new DramaRepositoryError(code, message); }
export const copy = (value) => structuredClone(value);
// Sorted object keys; arrays retain their meaningful order. Reject lossy JSON.
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + Array.from(value, canonical).join(',') + ']';
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  fail('VALIDATION_ERROR', 'only JSON values are accepted');
}
export function idempotencyKey(scope, key) {
  if (scope === undefined || scope === null || scope === '') fail('VALIDATION_ERROR', 'scope is required');
  return canonical([scope, requiredString(key, 'key')]);
}
export function validateIdempotency(record) {
  idempotencyKey(record.scope, record.key);
  requiredString(record.payloadHash, 'payloadHash');
  if (!Object.hasOwn(record, 'result')) fail('VALIDATION_ERROR', 'result is required');
  canonical(record);
}

export async function authorizeWith(repository, auth, action, resource) {
  if (!auth || auth.tenantId !== repository.tenantId || !auth.subjectId || !auth.clientId
      || !Array.isArray(auth.scopes) || !auth.scopes.includes(action)
      || typeof repository._authorize !== 'function'
      || await repository._authorize(copy(auth), action, copy(resource)) !== true) fail('FORBIDDEN');
  return true;
}
export function owner(record) { return record.manifest ?? record; }
export function baselineId(record) {
  const planning = record.schema_version === 'dramago.planning-baseline/v1';
  if (!planning && record.schema_version !== 'dramago.script-baseline/v1') fail('VALIDATION_ERROR', 'unknown baseline kind');
  return requiredString(planning ? record.planning_baseline_id : record.script_baseline_id, 'baseline id');
}
export function baselineItems(record) {
  return record.schema_version === 'dramago.planning-baseline/v1'
    ? (record.manifest.ordered_episodes ?? []).map((e, position) => ({ episode_id: e.episode_id, position, role: 'outline', ref: e.outline_ref }))
    : [{ episode_id: record.manifest.episode_id, position: 0, role: 'screenplay', ref: record.manifest.screenplay }];
}
export function validateRef(ref) {
  requiredString(ref?.artifact_id, 'artifact_id');
  requiredString(ref?.version_id, 'version_id');
  if (typeof ref?.content_digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(ref.content_digest)) fail('VALIDATION_ERROR', 'invalid content_digest');
}
export const sameRef = (a, b) => a?.artifact_id === b?.artifact_id && a?.version_id === b?.version_id && a?.content_digest === b?.content_digest;
// Repository invariants only: policy/evidence/actor authorization stays in the application.
export function validateApproval(decision) {
  validateRef(decision);
  canonical(decision);
  requiredString(decision.approval_id, 'approval_id');
  requiredString(decision.project_id, 'project_id');
  requiredString(decision.workspace_id, 'workspace_id');
  if (!['approved', 'rejected', 'revoked'].includes(decision.decision)
      || !Array.isArray(decision.target_refs) || !decision.target_refs.length) fail('APPROVAL_INVALID');
  for (const ref of decision.target_refs) validateRef(ref);
  if (decision.decision === 'revoked') {
    if (!decision.revoked_decision_ref) fail('APPROVAL_INVALID');
    validateRef(decision.revoked_decision_ref);
  } else if (decision.revoked_decision_ref) fail('APPROVAL_INVALID');
}
export function validateRevocation(decision, previous) {
  if (decision.decision !== 'revoked') return;
  // The adapter must resolve previous within its tenant. Target order is not
  // significant, but no targets may be added, removed, or substituted.
  const targets = refs => canonical(refs.map(ref => canonical([
    ref.artifact_id, ref.version_id, ref.content_digest,
  ])).sort());
  if (!previous || !sameRef(previous, decision.revoked_decision_ref)
      || previous.decision !== 'approved' || previous.project_id !== decision.project_id
      || previous.workspace_id !== decision.workspace_id
      || targets(previous.target_refs) !== targets(decision.target_refs)) fail('APPROVAL_INVALID');
}
const stages = {
  story: ['story.direction', 'story.adaptation', 'story.bible', 'story.master_outline', 'story.season_architecture', 'story.episode_outlines', 'story.planning_review'],
  script: ['usvds.03', 'usvds.04'],
  production: ['usvds.05', 'usvds.06', 'usvds.07', 'usvds.08', 'usvds.09'],
};
const statuses = ['queued', 'running', 'waiting_approval', 'succeeded', 'failed', 'cancelled'];
export function validateRun(run) {
  requiredString(run.run_id, 'run_id');
  revision(run.revision);
  if (!stages[run.domain] || !statuses.includes(run.status) || !Array.isArray(run.steps) || !run.steps.length
      || run.steps.some((step) => !stages[run.domain].includes(step.stage))) fail('VALIDATION_ERROR', 'invalid CreativeRun domain/stage/status');
  canonical(run);
}
export function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail('VALIDATION_ERROR', `${label} is required`);
  return value;
}
export function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('VALIDATION_ERROR', 'revision must be a nonnegative safe integer');
  return value;
}
export function patchHead(current, expected, patch, identity) {
  revision(expected);
  if (!current) fail('NOT_FOUND');
  if (current.revision !== expected) fail('REVISION_CONFLICT');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail('VALIDATION_ERROR', 'patch must be an object');
  for (const key of ['revision', 'schema_version', 'workspace_id', 'project_id', 'created_at', ...identity]) {
    if (Object.hasOwn(patch, key)) fail('VALIDATION_ERROR', `cannot patch ${key}`);
  }
  return { ...copy(current), ...copy(patch), revision: revision(expected + 1) };
}
