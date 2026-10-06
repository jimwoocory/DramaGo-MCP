# P1 persistence invariants

Relocated from persistence-review `e3bcbf0ac4778285f7d65fc532d3caa3a0d9c1b9`,
with only `getBaselineByVersion(versionId, projectId)` added to memory and
PostgreSQL from domain/security `975464ff5840ec9781430e7c47cc422b9a258fee`.
Journal inherits the memory read port. ESM entry: `@xiaoshuren/dramago-persistence`.
The host injects its PostgreSQL pool and tenant-bound authorization policy;
workspace ID fields alone do not authorize access.

The adapters persist Drama facts. Approval policy, actor authorization, review
outcomes and target existence checks belong to the application; this package
validates repository ownership, exact-reference shapes, immutable relationships,
and JSON-safe values. It does not implement P2 execution.

## PostgreSQL transaction and idempotency contract

Use the repository passed to `transaction(async tx => ...)` for every read and
write in that unit of work. Await all operations. Start a transaction at the
application boundary; do not wrap an application command in another transaction.

For an idempotent command, the order is:

1. Call `tx.findIdempotency(scope, key)` before creating or changing any facts.
2. If a record exists, verify its payload hash and return its original result;
   a changed payload must fail with `IDEMPOTENCY_CONFLICT`.
3. Otherwise write the facts and `tx.putIdempotency(record)` in this same
   transaction, including any audit/outbox records.

A transactional replay lookup takes a PostgreSQL transaction advisory lock on
`hashtextextended(canonical(["dramago.idempotency", tenantId, scopeKey, key]), 0)`.
`scopeKey` is the existing canonical scope/key encoding, so object property order
does not change the lock identity. The lock is held until COMMIT or ROLLBACK and
coordinates different connections and service processes, not just one JS object.
Hash collisions can only serialize unrelated commands; the replay table still
uses the full tenant/scope/key primary key.

Transactions explicitly use READ COMMITTED. Lock acquisition and replay SELECT
are separate statements: after waiting for another transaction, the SELECT must
use a fresh snapshot containing its committed replay. Do not combine these
statements or change this protocol to REPEATABLE READ with a pre-lock snapshot.
A rolled-back writer leaves no facts or replay and releases the lock, allowing
the next caller to proceed. `putIdempotency` also participates in this lock
protocol, including standalone calls. A lookup outside a transaction remains an
observational read, not a reservation. A late `putIdempotency` alone cannot make
previous unrelated writes idempotent; all writers must follow the ordering above.

No service, table, constraint or index is added for this fix. The existing additive
migration and idempotency primary key remain unchanged. Direct SQL writers or
older adapter versions bypassing this protocol must not run concurrently with
these command writers during rollout.

PostgreSQL rejects nested `tx.transaction(...)` and recursive root
`repo.transaction(...)` calls with `INVALID_STATE_TRANSITION` before invoking
the inner callback. A caught rejection leaves the outer transaction usable; an
uncaught rejection rolls it back. Memory/Journal continue to provide nested
rollback semantics. Portable callers must not rely on nested transaction support.

## Approval and project-head parity

Both adapters validate each approval target's artifact ID, version ID and digest.
A revocation must resolve its exact predecessor inside the repository tenant.
That predecessor must be approved, belong to the same project/workspace and have
the same exact targets (order-independent, with no added or removed entries).
Revocations append a new immutable decision; they never modify the predecessor.
Application approval policy is not reimplemented here.

Project CAS validates the complete next value before persistence. Undefined
values, nonfinite numbers, sparse arrays and other non-JSON values fail with
`VALIDATION_ERROR` without updating the row or revision.

## Offline verification

```
node --test tests/dramago/p1-persistence*.test.mjs
pnpm test:dramago
git diff --check
```

`p1-persistence-parity.test.mjs` exercises the real adapters and ProjectService.
Its deterministic PostgreSQL harness has separate client write sets, READ
COMMITTED visibility, unique-key waits and transaction-scoped lock waits/releases.
Tests cover identical/changed concurrent retries, rollback of project/replay/
audit/outbox records, tenant/scope/key isolation, exact revocation relationships,
CAS races and JSON rejection, and both nested-transaction behaviors. The harness
models only the SQL behavior used by these cases: it does not enforce the entire
migration (including approval version uniqueness and timestamp constraints) or
simulate approval ordering. It is not a PostgreSQL server and does not substitute
for deployment integration validation against a real PostgreSQL instance.

## Journal scope

`JournalDramaRepository` is development/reference-only on one local host. It
uses a serialized stale-lock recovery guard and rechecks the observed writer
before removing a stale lock. An unreadable lock or a leftover recovery guard
fails closed and requires operator inspection; do not remove locks while a
writer is active. It is not production durable Media storage or a PostgreSQL
replacement.

## Connection-bound migration boundary

The SQL is exported at
`@xiaoshuren/dramago-persistence/migrations/001_p1_fact_layer.sql` and remains
unchanged under the `dramago` schema. It contains its own `BEGIN`/`COMMIT`.
Do not add it to the generic Media `pool.query` migration scanner, and do not
wrap it inside `repository.transaction()` or a second transaction.

A host migration runner must acquire one dedicated `pool.connect()` client,
read this exported SQL asset, and execute the entire SQL with that client's
`query(sql)`. On failure it must issue `ROLLBACK` on that same client before
releasing it; always release the client in `finally`. The deployment's migration
ledger/coordination owns exactly-once application. This relocation exposes the
asset but deliberately does not wire or execute a production migration.
Real PostgreSQL migration and locking verification remain a deployment gate.
