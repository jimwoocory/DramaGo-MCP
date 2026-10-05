import { DomainError } from "@xiaoshuren/contracts";
import type { JobStore } from "@xiaoshuren/media-core";
import type { ApplicationIdempotency, MediaApplicationStore, MediaApplicationTransaction, MediaQuote } from "./ports.js";

/** Local fact-test/reference store, NOT a durable production repository.
 * All access to the wrapped core store must go through this unit of work.
 */
export class InMemoryMediaApplicationStore implements MediaApplicationStore {
  private quotes = new Map<string, MediaQuote>();
  private records = new Map<string, ApplicationIdempotency>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly jobs: JobStore) {}

  transaction<T>(fn: (tx: MediaApplicationTransaction) => Promise<T>): Promise<T> {
    const run = this.tail.then(() => this.jobs.transaction(async jobs => {
      const quotes = structuredClone(this.quotes);
      const records = structuredClone(this.records);
      const recordKey = (scope: string, key: string) => JSON.stringify([scope, key]);
      const tx: MediaApplicationTransaction = {
        jobs,
        async authorize(auth, action, resource) {
          if (!auth.scopes.includes(action)) throw new DomainError("FORBIDDEN", "Required scope is missing");
          return jobs.authorize(auth, resource.workspaceId);
        },
        async findIdempotency(scope, key) { return structuredClone(records.get(recordKey(scope, key))); },
        async putIdempotency(record) {
          const key = recordKey(record.scope, record.key);
          if (records.has(key)) throw new DomainError("IDEMPOTENCY_CONFLICT", "Idempotency record already exists");
          records.set(key, structuredClone(record));
        },
        async getQuote(id) { return structuredClone(quotes.get(id)); },
        async putQuote(quote) { quotes.set(quote.id, structuredClone(quote)); },
      };
      const result = structuredClone(await fn(tx));
      // Publish only after the wrapped core transaction has committed.
      return { result, quotes, records };
    })).then(({ result, quotes, records }) => {
      this.quotes = quotes;
      this.records = records;
      return result;
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}
