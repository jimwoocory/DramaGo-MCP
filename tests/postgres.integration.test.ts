import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobService } from "../packages/media-core/src/index.js";
import { PostgresJobRepository, migrate } from "../packages/persistence/src/index.js";

const connectionString = process.env.POSTGRES_URL;
const describePostgres = connectionString ? describe : describe.skip;
const auth = { tenantId: "tenant-a", subjectId: "subject-a", clientId: "test", scopes: [] };
const request = { prompt: "a red kite", outputCount: 1 };
const pool = connectionString ? new Pool({ connectionString }) : undefined;

const setupWorkspace = async () => {
  const workspaceId = `ws-${randomUUID()}`;
  await pool!.query("INSERT INTO workspaces(id, tenant_id, name, status) VALUES ($1, $2, $3, 'active')", [workspaceId, auth.tenantId, "P0-01 test"]);
  await pool!.query("INSERT INTO workspace_members(workspace_id, subject_id) VALUES ($1, $2)", [workspaceId, auth.subjectId]);
  return workspaceId;
};

describePostgres("real PostgreSQL JobService integration", () => {
  beforeAll(async () => { await migrate(pool!); });
  afterAll(async () => { await pool!.end(); });

  it("replays, conflicts, and authorizes through JobService", async () => {
    const workspaceId = await setupWorkspace();
    const service = new JobService(new PostgresJobRepository(pool!));
    const input = { workspaceId, idempotencyKey: randomUUID(), request, modelId: "image-v1" };
    const first = await service.create(auth, input);
    await expect(service.create(auth, input)).resolves.toEqual(first);
    await expect(service.create(auth, { ...input, request: { prompt: "different" } })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(service.create({ ...auth, subjectId: "subject-b" }, { ...input, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns the original semantic result for overlapping equivalent creates", async () => {
    const workspaceId = await setupWorkspace();
    const service = new JobService(new PostgresJobRepository(pool!));
    const input = { workspaceId, idempotencyKey: randomUUID(), request, modelId: "image-v1" };
    const [first, second] = await Promise.all([service.create(auth, input), service.create(auth, input)]);
    expect(second).toEqual(first);
    await expect(pool!.query("SELECT * FROM jobs WHERE workspace_id=$1", [workspaceId])).resolves.toMatchObject({ rowCount: 1 });
  });

  it("rolls back Job, ProviderExecution, Outbox, and IdempotencyRecord when the audit write fails", async () => {
    const workspaceId = await setupWorkspace();
    const constraint = `reject_job_audit_${randomUUID().replaceAll("-", "")}`;
    await pool!.query(`ALTER TABLE audit_logs ADD CONSTRAINT ${constraint} CHECK (action <> 'job.created')`);
    const service = new JobService(new PostgresJobRepository(pool!));
    const key = randomUUID();
    const outboxBefore = await pool!.query("SELECT count(*)::int AS count FROM outbox_events");
    try {
      await expect(service.create(auth, { workspaceId, idempotencyKey: key, request, modelId: "image-v1" })).rejects.toThrow();
      await expect(pool!.query("SELECT * FROM jobs WHERE workspace_id=$1", [workspaceId])).resolves.toMatchObject({ rowCount: 0 });
      await expect(pool!.query("SELECT * FROM provider_executions pe JOIN jobs j ON j.id=pe.job_id WHERE j.workspace_id=$1", [workspaceId])).resolves.toMatchObject({ rowCount: 0 });
      await expect(pool!.query("SELECT count(*)::int AS count FROM outbox_events")).resolves.toMatchObject({ rows: [{ count: outboxBefore.rows[0].count }] });
      await expect(pool!.query("SELECT * FROM audit_logs WHERE workspace_id=$1", [workspaceId])).resolves.toMatchObject({ rowCount: 0 });
      await expect(pool!.query("SELECT * FROM idempotency_records WHERE idempotency_key=$1", [key])).resolves.toMatchObject({ rowCount: 0 });
    } finally {
      await pool!.query(`ALTER TABLE audit_logs DROP CONSTRAINT ${constraint}`);
    }
  });
});
