type Client = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
export type RefundWorkRuntime = {
  automation: boolean;
  contact: boolean | null;
  manualOutbox: boolean;
  paymentExecutor: boolean;
  policyWindow: boolean;
};

// Health instrumentation must not prevent independent refund work. Only the
// absent additive RPC is a rolling-deploy compatibility skip; other errors
// remain explicit unavailable evidence, never a successful zero observation.
export async function recordRefundWorkObservation(
  client: Client, runId: string, phase: "before" | "after", runtime: RefundWorkRuntime,
): Promise<"recorded" | "legacy" | "unavailable"> {
  try {
    const { data, error } = await client.rpc("service_record_refund_work_observation", {
      p_run_id: runId, p_phase: phase, p_runtime: runtime,
    });
    if (error && typeof error === "object" && "code" in error && error.code === "PGRST202") return "legacy";
    if (error || !data || typeof data !== "object" || !("recorded" in data) ||
      data.recorded !== true || !("status" in data) || data.status !== "available") return "unavailable";
    return "recorded";
  } catch { return "unavailable"; }
}
