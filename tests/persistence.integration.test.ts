import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { JobService } from "../packages/media-core/src/index.js";
import { PostgresJobRepository, migrate } from "../packages/persistence/src/index.js";

const auth = { tenantId: "tenant-a", subjectId: "subject-a", clientId: "test", scopes: [] };
const request = { prompt: "a red kite", outputCount: 1 };

const createDatabase = async () => {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  await pool.query("INSERT INTO workspaces(id, tenant_id, name, status) VALUES ('ws-a','tenant-a','A','active')");
  await pool.query("INSERT INTO workspace_members(workspace_id, subject_id) VALUES ('ws-a','subject-a')");
  return pool;
};

describe("PostgreSQL JobService integration", () => {
  it("persists Job, ProviderExecution, Outbox, Audit, and IdempotencyRecord and replays the original semantic result", async () => {
    const pool = await createDatabase();
    const service = new JobService(new PostgresJobRepository(pool));
    const input = { workspaceId: "ws-a", idempotencyKey: "a".repeat(16), request, modelId: "image-v1" };

    const first = await service.create(auth, input);
    await expect(service.create(auth, input)).resolves.toEqual(first);

    expect((await pool.query("SELECT * FROM jobs")).rowCount).toBe(1);
    expect((await pool.query("SELECT * FROM provider_executions")).rowCount).toBe(1);
    expect((await pool.query("SELECT * FROM outbox_events")).rowCount).toBe(1);
    expect((await pool.query("SELECT * FROM audit_logs")).rowCount).toBe(1);
    expect((await pool.query("SELECT * FROM idempotency_records")).rowCount).toBe(1);
  });

  it("raises IDEMPOTENCY_CONFLICT for the same key with a different semantic request", async () => {
    const pool = await createDatabase();
    const service = new JobService(new PostgresJobRepository(pool));
    const input = { workspaceId: "ws-a", idempotencyKey: "b".repeat(16), request, modelId: "image-v1" };
    await service.create(auth, input);

    await expect(service.create(auth, { ...input, request: { prompt: "different" } })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("does not disclose an unauthorized workspace", async () => {
    const pool = await createDatabase();
    const service = new JobService(new PostgresJobRepository(pool));

    await expect(service.create(auth, { workspaceId: "ws-a", idempotencyKey: "c".repeat(16), request, modelId: "image-v1" })).resolves.toMatchObject({ status: "queued" });
    await expect(service.create({ ...auth, subjectId: "subject-b" }, { workspaceId: "ws-a", idempotencyKey: "d".repeat(16), request, modelId: "image-v1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

});
