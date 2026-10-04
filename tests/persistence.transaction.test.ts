import { describe, expect, it } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";
import { PostgresJobRepository } from "../packages/persistence/src/index.js";

type QueryCall = { sql: string; values?: unknown[] };

class RecordingClient {
  calls: QueryCall[] = [];
  released = false;

  async query(sql: string, values?: unknown[]): Promise<QueryResult<any>> {
    this.calls.push({ sql, values });
    return { command: "", rowCount: 0, oid: 0, fields: [], rows: [] };
  }

  release(): void {
    this.released = true;
  }
}

class RecordingPool {
  connectCalls = 0;
  poolQueryCalls = 0;
  readonly client = new RecordingClient();

  async connect(): Promise<PoolClient> {
    this.connectCalls += 1;
    return this.client as unknown as PoolClient;
  }

  async query(): Promise<QueryResult<any>> {
    this.poolQueryCalls += 1;
    throw new Error("pool.query must not be used by a transaction-bound repository");
  }
}

describe("PostgresJobRepository transaction boundary", () => {
  it("uses one acquired client and commits a successful transaction", async () => {
    const pool = new RecordingPool();
    const repo = new PostgresJobRepository(pool as unknown as Pool);

    const result = await repo.transaction(async store => {
      await store.findIdempotency(
        { tenantId: "tenant-a", subjectId: "subject-a", clientId: "test", scopes: [] },
        "generate",
        "a".repeat(16),
      );
      return "ok";
    });

    expect(result).toBe("ok");
    expect(pool.connectCalls).toBe(1);
    expect(pool.poolQueryCalls).toBe(0);
    expect(pool.client.calls.map(call => call.sql)).toEqual([
      "BEGIN",
      expect.stringContaining("SELECT id, tenant_id"),
      "COMMIT",
    ]);
    expect(pool.client.released).toBe(true);
  });

  it("rolls back on failure and never commits", async () => {
    const pool = new RecordingPool();
    const repo = new PostgresJobRepository(pool as unknown as Pool);

    await expect(repo.transaction(async store => {
      await store.findIdempotency(
        { tenantId: "tenant-a", subjectId: "subject-a", clientId: "test", scopes: [] },
        "generate",
        "b".repeat(16),
      );
      throw new Error("boom");
    })).rejects.toThrow("boom");

    expect(pool.connectCalls).toBe(1);
    expect(pool.poolQueryCalls).toBe(0);
    expect(pool.client.calls.map(call => call.sql)).toEqual([
      "BEGIN",
      expect.stringContaining("SELECT id, tenant_id"),
      "ROLLBACK",
    ]);
    expect(pool.client.calls.some(call => call.sql === "COMMIT")).toBe(false);
    expect(pool.client.released).toBe(true);
  });
});
