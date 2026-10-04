import { ProviderAdapter, ProviderExecutionContext, ProviderStatusResult, ProviderSubmitResult } from "@xiaoshuren/contracts";
type Scenario = "success" | "failure" | "unknown";
export class FakeProvider implements ProviderAdapter { submitCalls = 0; private jobs = new Map<string, Scenario>(); private events = new Set<string>();
  async submit(ctx: ProviderExecutionContext, request: Record<string, unknown>): Promise<ProviderSubmitResult> { this.submitCalls++; const id = `fake-${ctx.providerRequestKey}`; const scenario = (request.scenario as Scenario | undefined) ?? "success"; this.jobs.set(id, scenario); return { providerJobId: id, status: scenario === "unknown" ? "unknown" : "submitted" }; }
  async getStatus(_ctx: ProviderExecutionContext, providerJobId: string): Promise<ProviderStatusResult> { const scenario = this.jobs.get(providerJobId); if (!scenario) return { status: "unknown" }; if (scenario === "failure") return { status: "failed", error: { providerCode: "FAKE_DETERMINISTIC_FAILURE", message: "Deterministic fake failure", retryable: false } }; return scenario === "unknown" ? { status: "running" } : { status: "succeeded", outputs: [{ url: "https://fake.invalid/output.png", mimeType: "image/png" }] }; }
  reconcile(providerJobId: string) { const scenario = this.jobs.get(providerJobId); return { status: scenario === "unknown" ? "running" : scenario === "failure" ? "failed" : "succeeded" }; }
  acceptWebhook(eventId: string) { if (this.events.has(eventId)) return false; this.events.add(eventId); return true; }
  normalizeError(error: unknown) { return { code: "FAKE_PROVIDER_ERROR", message: error instanceof Error ? error.message : "Fake provider error", retryable: false }; }
}
