import { describe, expect, it } from "vitest";
import { DomainError, transitionJob } from "../packages/media-core/src/index.js";

describe("job state machine", () => {
  it("rejects an illegal terminal transition", () => {
    try { transitionJob("succeeded", "running"); } catch (error) { expect(error).toBeInstanceOf(DomainError); expect((error as DomainError).code).toBe("INVALID_JOB_TRANSITION"); }
  });

  it("moves an unknown submission into reconciliation but never back to submitting", () => {
    expect(transitionJob("unknown", "reconciling")).toBe("reconciling");
    try { transitionJob("unknown", "submitting"); } catch (error) { expect((error as DomainError).code).toBe("INVALID_JOB_TRANSITION"); }
  });
});
