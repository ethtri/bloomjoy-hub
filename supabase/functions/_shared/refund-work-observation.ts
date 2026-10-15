type ObservationResult = { data: unknown; error: unknown };
type ObservationRequest = PromiseLike<ObservationResult> & { abortSignal?: (signal: AbortSignal) => PromiseLike<ObservationResult> };
type Client = { rpc: (name: string, args: Record<string, unknown>) => ObservationRequest };
export type RefundWorkRuntime = {
  automation: boolean;
  contact: boolean | null;
  manualOutbox: boolean;
  paymentExecutor: boolean;
  policyWindow: boolean;
};

export function refundHealthNotificationStatus(health: {
  status?: string; workflowStatus?: string; schedulerStatus?: string; deliveryStatus?: string;
  consecutiveFailures?: number; blockedReasons?: unknown[]; dueWork?: unknown;
}): string {
  const status = health.status === 'failing' && health.workflowStatus !== 'degraded' &&
    (health.consecutiveFailures ?? 0) < 2 ? 'waiting' : health.status ?? 'waiting';
  if (status === 'failing' && health.schedulerStatus === 'healthy' && health.workflowStatus === 'degraded') return 'workflow_degraded';
  // Absence alone identifies an old contract. Present-but-failed, malformed or
  // unavailable evidence must never resolve an existing technical incident.
  if (!Object.prototype.hasOwnProperty.call(health, 'dueWork') && health.schedulerStatus === 'healthy' &&
    health.workflowStatus === 'instrumentation_unavailable' && health.deliveryStatus === 'healthy' &&
    (health.blockedReasons?.length ?? 0) === 0) return 'healthy';
  return status;
}

// Health instrumentation must not prevent independent refund work. Only the
// absent additive RPC is a rolling-deploy compatibility skip; other errors
// remain explicit unavailable evidence, never a successful zero observation.
export async function recordRefundWorkObservation(
  client: Client, runId: string, phase: "before" | "after", runtime: RefundWorkRuntime,
  timeoutMs = 5_000,
): Promise<"recorded" | "legacy" | "unavailable"> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = client.rpc("service_record_refund_work_observation", {
      p_run_id: runId, p_phase: phase, p_runtime: runtime,
    });
    // Bound this background request using the existing five-second observation
    // pattern. Abort is not proof of server cancellation; do not retry a phase.
    const bounded = request.abortSignal ? request.abortSignal(controller.signal) : request;
    const { data, error } = await Promise.race([bounded, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Observation deadline")); }, timeoutMs);
    })]);
    if (error && typeof error === "object" && "code" in error && error.code === "PGRST202") return "legacy";
    if (error || !data || typeof data !== "object" || !("recorded" in data) ||
      data.recorded !== true || !("status" in data) || data.status !== "available") return "unavailable";
    return "recorded";
  } catch { return "unavailable"; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
