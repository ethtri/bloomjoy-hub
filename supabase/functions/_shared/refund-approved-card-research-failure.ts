// The failure writer is also the authoritative read-back after a lost commit
// response. Only its exact completed-generation evidence can settle success.
export const reconcileApprovedCardResearchFailure = async (
  recordFailure: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<"completed" | "failed" | "unresolved"> => {
  try {
    const { data, error } = await recordFailure();
    if (error || !data || typeof data !== "object") return "unresolved";
    const result = data as Record<string, unknown>;
    if (result.applied === false && result.stale === true &&
      result.alreadyCompleted === true && result.payloadRedacted === true) {
      return "completed";
    }
    if (result.applied === true && result.payloadRedacted === true) return "failed";
    return "unresolved";
  } catch {
    return "unresolved";
  }
};
