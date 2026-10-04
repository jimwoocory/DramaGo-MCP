import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool, PoolClient } from "pg";
import { Audit, AuthContext, DomainError, IdempotencyRecord, Job, Outbox, ProviderExecution, Workspace } from "@xiaoshuren/contracts";
import { JobStore } from "@xiaoshuren/media-core";

export const migrate = async (pool: Pick<Pool, "query">): Promise<void> => {
  const sql = await readFile(join(import.meta.dirname, "migrations", "001_p0_01.sql"), "utf8");
  for (const statement of sql.split(";\n").map(s => s.trim()).filter(Boolean)) await pool.query(statement);
};

export class PostgresJobRepository implements JobStore {
  constructor(private readonly pool: Pool, private readonly client?: PoolClient) {}

  private q(sql: string, values: unknown[] = []) { return (this.client ?? this.pool).query(sql, values); }

  async transaction<T>(fn: (store: JobStore) => T | Promise<T>): Promise<T> {
    if (this.client) return fn(this);
    const client = await this.pool.connect();
    const transactionalStore = new PostgresJobRepository(this.pool, client);
    try {
      await client.query("BEGIN");
      const value = await fn(transactionalStore);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async authorize(auth: AuthContext, workspaceId?: string): Promise<Workspace> {
    const result = await this.q(
      "SELECT w.id, w.tenant_id, w.name, w.status FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE w.id=$1 AND w.tenant_id=$2 AND m.subject_id=$3 AND w.status='active'",
      [workspaceId ?? auth.defaultWorkspaceId, auth.tenantId, auth.subjectId],
    );
    if (!result.rowCount) throw new DomainError("NOT_FOUND", "Resource not found");
    const row = result.rows[0];
    return { id: row.id, tenantId: row.tenant_id, name: row.name, status: row.status };
  }

  async findIdempotency(auth: AuthContext, tool: string, key: string): Promise<IdempotencyRecord | undefined> {
    const result = await this.q(
      "SELECT id, tenant_id, subject_id, tool_name, idempotency_key, request_hash, response_snapshot_json, resource_type, resource_id, created_at FROM idempotency_records WHERE tenant_id=$1 AND subject_id=$2 AND tool_name=$3 AND idempotency_key=$4",
      [auth.tenantId, auth.subjectId, tool, key],
    );
    if (!result.rowCount) return undefined;
    const row = result.rows[0];
    return { id: row.id, tenantId: row.tenant_id, subjectId: row.subject_id, toolName: row.tool_name, idempotencyKey: row.idempotency_key, requestHash: row.request_hash, responseSnapshot: row.response_snapshot_json, resourceType: row.resource_type, resourceId: row.resource_id, createdAt: row.created_at };
  }

  async persistCreatedJob(job: Job, execution: ProviderExecution, outbox: Outbox, audit: Audit, record: IdempotencyRecord): Promise<IdempotencyRecord | undefined> {
    const idempotencyInsert = await this.q("INSERT INTO idempotency_records(id,tenant_id,subject_id,tool_name,idempotency_key,request_hash,response_snapshot_json,resource_type,resource_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (tenant_id,subject_id,tool_name,idempotency_key) DO NOTHING RETURNING id", [record.id, record.tenantId, record.subjectId, record.toolName, record.idempotencyKey, record.requestHash, record.responseSnapshot, record.resourceType, record.resourceId, record.createdAt]);
    if (!idempotencyInsert.rowCount) return this.findIdempotency({ tenantId: record.tenantId, subjectId: record.subjectId, clientId: "internal", scopes: [] }, record.toolName, record.idempotencyKey);
    await this.q("INSERT INTO jobs(id,tenant_id,subject_id,workspace_id,quote_id,kind,public_model_id,request_hash,frozen_request_json,status,version,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [job.id, job.tenantId, job.subjectId, job.workspaceId, job.quoteId ?? null, job.kind, job.publicModelId, job.requestHash, job.frozenRequest, job.status, job.version, job.createdAt, job.updatedAt]);
    await this.q("INSERT INTO provider_executions(id,job_id,provider_id,provider_model_id,provider_request_key,provider_job_id,status,submission_attempts,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [execution.id, execution.jobId, execution.providerId, execution.providerModelId, execution.providerRequestKey, execution.providerJobId ?? null, execution.status, execution.submissionAttempts, execution.createdAt, execution.updatedAt]);
    await this.q("INSERT INTO outbox_events(id,aggregate_type,aggregate_id,event_type,payload_json,available_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [outbox.id, outbox.aggregateType, outbox.aggregateId, outbox.eventType, outbox.payload, outbox.availableAt, outbox.createdAt]);
    await this.q("INSERT INTO audit_logs(id,tenant_id,subject_id,workspace_id,action,target_type,target_id,request_id,metadata_redacted_json,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [audit.id, audit.tenantId, audit.subjectId, audit.workspaceId, audit.action, audit.targetType, audit.targetId, audit.requestId, audit.metadataRedacted, audit.createdAt]);
    return undefined;
  }

  async findJob(id: string): Promise<Job | undefined> {
    const result = await this.q("SELECT id, tenant_id, subject_id, workspace_id, quote_id, kind, public_model_id, request_hash, frozen_request_json, status, version, created_at, updated_at FROM jobs WHERE id=$1", [id]);
    if (!result.rowCount) return undefined;
    const row = result.rows[0];
    return { id: row.id, tenantId: row.tenant_id, subjectId: row.subject_id, workspaceId: row.workspace_id, quoteId: row.quote_id ?? undefined, kind: row.kind, publicModelId: row.public_model_id, requestHash: row.request_hash, frozenRequest: row.frozen_request_json, status: row.status, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  async updateJob(job: Job): Promise<void> {
    const result = await this.q("UPDATE jobs SET status=$1, version=$2, updated_at=$3 WHERE id=$4", [job.status, job.version, job.updatedAt, job.id]);
    if (!result.rowCount) throw new DomainError("NOT_FOUND", "Resource not found");
  }
}
