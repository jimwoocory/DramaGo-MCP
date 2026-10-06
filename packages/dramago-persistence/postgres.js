import { AsyncLocalStorage } from 'node:async_hooks'
import {
  copy, fail, requiredString, revision, patchHead, canonical, idempotencyKey,
  validateIdempotency, authorizeWith, owner, baselineId, baselineItems,
  validateRef, sameRef, validateRun, validateApproval, validateRevocation,
} from './shared.js'

const body = row => {
  const value = row?.body
  if (value == null) return null
  return typeof value === 'string' ? JSON.parse(value) : copy(value)
}
const rows = result => result?.rows ?? []
const one = result => rows(result)[0] ?? null
const json = value => JSON.stringify(value)

export class PostgresDramaRepository {
  constructor({ tenantId, pool, authorize, client = null } = {}) {
    this.tenantId = requiredString(tenantId, 'tenantId')
    if (!pool || typeof pool.query !== 'function') fail('VALIDATION_ERROR', 'pool.query is required')
    this.pool = pool
    this.client = client
    this._authorize = authorize
    this._context = new AsyncLocalStorage()
  }
  _db() { return this.client ?? this.pool }
  async _query(text, params = []) { return this._db().query(text, params) }
  async transaction(fn) {
    if (this.client || this._context.getStore()) fail('INVALID_STATE_TRANSITION', 'nested Postgres transactions are not supported')
    if (typeof this.pool.connect !== 'function') fail('INVALID_STATE_TRANSITION', 'pool.connect is required for transactions')
    const client = await this.pool.connect()
    const tx = new PostgresDramaRepository({ tenantId: this.tenantId, pool: this.pool, authorize: this._authorize, client })
    try {
      // A waiter must see the winner's commit in the SELECT after its lock.
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      const result = await this._context.run(true, () => fn(tx))
      await client.query('COMMIT')
      return result
    } catch (error) {
      try { await client.query('ROLLBACK') } catch {}
      throw error
    } finally {
      client.release?.()
    }
  }
  async _write(fn) { return this.client ? fn(this) : this.transaction(fn) }
  async authorize(auth, action, resource) { return authorizeWith(this, auth, action, resource) }

  async _project(projectId) {
    const result = await this._query(
      'SELECT body FROM dramago.projects WHERE tenant_id=$1 AND project_id=$2',
      [this.tenantId, projectId],
    )
    return body(one(result))
  }
  async _checkOwner(record) {
    const scope = owner(record)
    const project = await this._project(requiredString(scope.project_id, 'project_id'))
    if (!project) fail('NOT_FOUND', 'project not found')
    if (scope.workspace_id !== undefined && project.workspace_id !== scope.workspace_id) fail('VALIDATION_ERROR', 'workspace mismatch')
    return project
  }

  async createProject(project) {
    const value = copy(project)
    requiredString(value.project_id, 'project_id'); requiredString(value.workspace_id, 'workspace_id'); revision(value.revision); canonical(value)
    const result = await this._query(
      `INSERT INTO dramago.projects(tenant_id,workspace_id,project_id,revision,body,created_at)
       VALUES($1,$2,$3,$4,$5::jsonb,COALESCE($6::timestamptz,now()))
       ON CONFLICT(project_id) DO NOTHING RETURNING body`,
      [this.tenantId, value.workspace_id, value.project_id, value.revision, json(value), value.created_at ?? null],
    )
    if (!one(result)) fail('REVISION_CONFLICT', 'project already exists')
    return value
  }
  async getProject(id) { return this._project(requiredString(id, 'project_id')) }
  async compareAndSetProject(id, expected, patch) {
    return this._write(async tx => {
      const current = await tx._project(id)
      const next = patchHead(current, expected, patch, [])
      canonical(next)
      const result = await tx._query(
        `UPDATE dramago.projects SET revision=$1, body=$2::jsonb
         WHERE tenant_id=$3 AND project_id=$4 AND revision=$5 RETURNING body`,
        [next.revision, json(next), this.tenantId, id, expected],
      )
      if (!one(result)) fail('REVISION_CONFLICT')
      return next
    })
  }

  async putArtifactVersion(version) {
    validateRef(version); canonical(version)
    return this._write(async tx => {
      await tx._checkOwner(version)
      const result = await tx._query(
        `INSERT INTO dramago.artifact_versions
          (tenant_id,workspace_id,project_id,artifact_id,version_id,content_digest,body,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,COALESCE($8::timestamptz,now()))
         ON CONFLICT(version_id) DO NOTHING RETURNING body`,
        [this.tenantId, version.workspace_id, version.project_id, version.artifact_id, version.version_id,
          version.content_digest, json(version), version.created_at ?? null],
      )
      if (one(result)) return copy(version)
      const existing = await tx.getArtifactVersion(version.version_id)
      if (!existing || canonical(existing) !== canonical(version)) fail('VALIDATION_ERROR', 'immutable artifact version already exists')
      return existing
    })
  }
  async getArtifactVersion(id) {
    const result = await this._query(
      'SELECT body FROM dramago.artifact_versions WHERE tenant_id=$1 AND version_id=$2',
      [this.tenantId, id],
    )
    return body(one(result))
  }
  async listArtifactVersions(artifactId) {
    const result = await this._query(
      `SELECT body FROM dramago.artifact_versions
       WHERE tenant_id=$1 AND artifact_id=$2 ORDER BY created_at, version_id`,
      [this.tenantId, artifactId],
    )
    return rows(result).map(body)
  }

  async putBaseline(baseline) {
    const id = baselineId(baseline); validateRef(baseline); canonical(baseline)
    return this._write(async tx => {
      await tx._checkOwner(baseline)
      const items = baselineItems(baseline)
      if (!items.length || new Set(items.map(i => i.episode_id)).size !== items.length) fail('BASELINE_INCOMPLETE')
      for (const item of items) {
        requiredString(item.episode_id, 'episode_id'); validateRef(item.ref)
        const version = await tx.getArtifactVersion(item.ref.version_id)
        if (!sameRef(version, item.ref) || version.project_id !== baseline.manifest.project_id) fail('VALIDATION_ERROR', 'invalid baseline item reference')
      }
      if (baseline.script_baseline_id) {
        const planning = await tx.getBaseline(baseline.manifest.planning_baseline_id)
        if (!sameRef(planning, baseline.manifest.planning_baseline_ref) || planning?.manifest?.project_id !== baseline.manifest.project_id) {
          fail('VALIDATION_ERROR', 'invalid planning baseline reference')
        }
      }
      const kind = baseline.planning_baseline_id ? 'planning' : 'script'
      const inserted = await tx._query(
        `INSERT INTO dramago.baselines
          (tenant_id,workspace_id,project_id,baseline_id,baseline_kind,artifact_id,version_id,content_digest,body,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,COALESCE($10::timestamptz,now()))
         ON CONFLICT(baseline_id) DO NOTHING RETURNING body`,
        [this.tenantId, baseline.manifest.workspace_id, baseline.manifest.project_id, id, kind,
          baseline.artifact_id, baseline.version_id, baseline.content_digest, json(baseline), baseline.created_at ?? null],
      )
      if (!one(inserted)) {
        const existing = await tx.getBaseline(id)
        if (!existing || canonical(existing) !== canonical(baseline)) fail('BASELINE_IMMUTABLE')
        return existing
      }
      for (const item of items) {
        await tx._query(
          `INSERT INTO dramago.baseline_items
            (baseline_id,position,episode_id,role,artifact_id,version_id,content_digest)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [id, item.position, item.episode_id, item.role, item.ref.artifact_id, item.ref.version_id, item.ref.content_digest],
        )
      }
      return copy(baseline)
    })
  }
  async getBaseline(id) {
    const result = await this._query('SELECT body FROM dramago.baselines WHERE tenant_id=$1 AND baseline_id=$2', [this.tenantId, id])
    return body(one(result))
  }

  async getBaselineByVersion(versionId, projectId) {
    const result = await this._query('SELECT body FROM dramago.baselines WHERE tenant_id=$1 AND version_id=$2 AND project_id=$3', [this.tenantId, versionId, projectId])
    return body(one(result))
  }
  async appendApproval(decision) {
    validateApproval(decision)
    return this._write(async tx => {
      await tx._checkOwner(decision)
      if (decision.decision === 'revoked') {
        const previous = body(one(await tx._query(
          'SELECT body FROM dramago.approval_decisions WHERE tenant_id=$1 AND version_id=$2',
          [this.tenantId, decision.revoked_decision_ref.version_id],
        )))
        validateRevocation(decision, previous)
      }
      const result = await tx._query(
        `INSERT INTO dramago.approval_decisions
          (tenant_id,workspace_id,project_id,approval_id,version_id,decision,target_refs,body,decided_at)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::timestamptz)
         ON CONFLICT(approval_id) DO NOTHING RETURNING body`,
        [this.tenantId, decision.workspace_id, decision.project_id, decision.approval_id, decision.version_id,
          decision.decision, json(decision.target_refs), json(decision), decision.decided_at],
      )
      if (one(result)) return copy(decision)
      const existing = one(await tx._query(
        'SELECT body FROM dramago.approval_decisions WHERE tenant_id=$1 AND approval_id=$2',
        [this.tenantId, decision.approval_id],
      ))
      const value = body(existing)
      if (!value || canonical(value) !== canonical(decision)) fail('APPROVAL_INVALID')
      return value
    })
  }
  async listApprovals(ref) {
    validateRef(ref)
    const result = await this._query(
      `SELECT body FROM dramago.approval_decisions
       WHERE tenant_id=$1 AND target_refs @> $2::jsonb ORDER BY decided_at, approval_id`,
      [this.tenantId, json([ref])],
    )
    return rows(result).map(body)
  }

  async putRun(run) {
    const value = { ...copy(run), revision: run.revision ?? 0 }; validateRun(value)
    return this._write(async tx => {
      await tx._checkOwner(value)
      const result = await tx._query(
        `INSERT INTO dramago.creative_runs
          (tenant_id,workspace_id,project_id,run_id,domain,revision,status,body,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,COALESCE($9::timestamptz,now()))
         ON CONFLICT(run_id) DO NOTHING RETURNING body`,
        [this.tenantId, value.workspace_id, value.project_id, value.run_id, value.domain, value.revision,
          value.status, json(value), value.created_at ?? null],
      )
      if (!one(result)) fail('REVISION_CONFLICT')
      return value
    })
  }
  async getRun(id) {
    const result = await this._query('SELECT body FROM dramago.creative_runs WHERE tenant_id=$1 AND run_id=$2', [this.tenantId, id])
    return body(one(result))
  }
  async compareAndSetRun(id, expected, patch) {
    return this._write(async tx => {
      const current = await tx.getRun(id)
      const next = patchHead(current, expected, patch, ['run_id','domain','input_manifest','input_manifest_digest'])
      validateRun(next)
      const result = await tx._query(
        `UPDATE dramago.creative_runs SET revision=$1,status=$2,body=$3::jsonb
         WHERE tenant_id=$4 AND run_id=$5 AND revision=$6 RETURNING body`,
        [next.revision, next.status, json(next), this.tenantId, id, expected],
      )
      if (!one(result)) fail('REVISION_CONFLICT')
      return next
    })
  }

  async _lockIdempotency(scopeKey, key) {
    // Transaction-scoped and shared across processes; collisions only serialize
    // unrelated keys. Never combine this lock and the replay read in one SELECT:
    // READ COMMITTED needs a fresh statement snapshot after the wait completes.
    await this._query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      [canonical(['dramago.idempotency', this.tenantId, scopeKey, key])])
  }
  async findIdempotency(scope, key) {
    const scopeKey = idempotencyKey(scope, key)
    if (this.client) await this._lockIdempotency(scopeKey, key)
    const result = await this._query(
      `SELECT payload_hash,result FROM dramago.idempotency_records
       WHERE tenant_id=$1 AND scope_key=$2 AND idempotency_key=$3`,
      [this.tenantId, scopeKey, key],
    )
    const row = one(result)
    return row ? { scope: copy(scope), key, payloadHash: row.payload_hash, result: typeof row.result === 'string' ? JSON.parse(row.result) : copy(row.result) } : null
  }
  async putIdempotency(record) {
    validateIdempotency(record)
    const scopeKey = idempotencyKey(record.scope, record.key)
    return this._write(async tx => {
      await tx._lockIdempotency(scopeKey, record.key)
      const result = await tx._query(
        `INSERT INTO dramago.idempotency_records(tenant_id,scope_key,idempotency_key,payload_hash,result)
         VALUES($1,$2,$3,$4,$5::jsonb)
         ON CONFLICT(tenant_id,scope_key,idempotency_key) DO NOTHING RETURNING payload_hash,result`,
        [this.tenantId, scopeKey, record.key, record.payloadHash, json(record.result)],
      )
      if (one(result)) return copy(record)
      const existing = await tx.findIdempotency(record.scope, record.key)
      if (!existing || existing.payloadHash !== record.payloadHash) fail('IDEMPOTENCY_CONFLICT')
      return existing
    })
  }

  async appendAudit(event) {
    canonical(event)
    const result = await this._query(
      `INSERT INTO dramago.audit_log(event_id,tenant_id,project_id,body)
       VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,
      [requiredString(event.event_id,'event_id'), this.tenantId, event.project_id ?? null, json(event)],
    )
    if (!one(result)) fail('VALIDATION_ERROR','audit event already exists')
    return copy(event)
  }
  async appendOutbox(event) {
    canonical(event)
    const result = await this._query(
      `INSERT INTO dramago.outbox(event_id,tenant_id,project_id,event_type,body)
       VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,
      [requiredString(event.event_id,'event_id'), this.tenantId, event.project_id ?? null,
        requiredString(event.type ?? event.event_type,'event_type'), json(event)],
    )
    if (!one(result)) fail('VALIDATION_ERROR','outbox event already exists')
    return copy(event)
  }
}
