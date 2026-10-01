import { createSupplyAdapter, SupplyError, type SupplyAdapter, type SupplyClaim } from "./refund-gift-card-providers.ts";

type Client = { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
type Result = { completed: number; failed: number; unknown: number; resumed: number };
type Dependencies = {
  adapter?: (claim: SupplyClaim) => Promise<SupplyAdapter>;
  notify?: (incidentId: string, poolId: string, reason: string) => Promise<void>;
  now?: () => Date;
};
export async function runRefundGiftCardSupply(client: Client, dependencies: Dependencies = {}): Promise<Result> {
  const result = { completed: 0, failed: 0, unknown: 0, resumed: 0 };
  const excluded: string[] = [];
  const rpc = async (name: string, args?: Record<string, unknown>) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new SupplyError("supply_database_failure");
    return data;
  };
  // Edge deployment can precede the additive schema migration. Only absence
  // of the first RPC is a compatibility skip, before any provider work. Once
  // that seam exists, real database errors must remain visible.
  const rollover = await client.rpc("service_rollover_refund_gift_card_supply");
  if (rollover.error && typeof rollover.error === "object" &&
    "code" in rollover.error && rollover.error.code === "PGRST202") return result;
  if (rollover.error) throw new SupplyError("supply_database_failure");
  for (let index = 0; index < 10; index++) {
    const claim = await rpc("service_claim_refund_gift_card_refill", { p_excluded_attempt_ids: excluded }) as SupplyClaim & { claimed: boolean };
    if (claim?.claimed !== true) break;
    excluded.push(claim.attemptId);
    let providerAttempted = claim.reconcile;
    let outcome = "unknown";
    let reason = "provider_outcome_unknown";
    let codes: unknown[] = [];
    try {
      if (!claim.reconcile) claim.attemptedAt = new Date(Math.floor((dependencies.now?.() ?? new Date()).getTime() / 1000) * 1000).toISOString();
      const adapter = await (dependencies.adapter ?? createSupplyAdapter)(claim);
      if (claim.reconcile) {
        const recovered = await adapter.reconcile();
        if (recovered) { codes = recovered; outcome = "complete"; reason = "provider_reconciled"; }
      } else {
        const baseline = await adapter.prepare();
        const began = await rpc("service_begin_refund_gift_card_refill", { p_attempt_id: claim.attemptId, p_claim_token: claim.claimToken, p_baseline: baseline, p_attempted_at: claim.attemptedAt });
        if (began !== true) throw new SupplyError("refill_claim_changed");
        providerAttempted = true;
        codes = await adapter.create();
        outcome = "complete"; reason = "provider_batch_verified";
      }
    } catch (error) {
      const known = error instanceof SupplyError;
      reason = known ? error.reason : "provider_unexpected_failure";
      outcome = claim.reconcile || (known ? error.unknown : providerAttempted) ? "unknown" : "failed";
    }
    let settled: Record<string, unknown>;
    try {
      settled = await rpc("service_finish_refund_gift_card_refill", { p_attempt_id: claim.attemptId, p_claim_token: claim.claimToken, p_outcome: outcome, p_reason: reason, p_codes: codes }) as Record<string, unknown>;
    } catch {
      // A database import failure after provider creation must retain uncertainty.
      settled = await rpc("service_finish_refund_gift_card_refill", { p_attempt_id: claim.attemptId, p_claim_token: claim.claimToken, p_outcome: "unknown", p_reason: "inventory_commit_unknown", p_codes: [] }) as Record<string, unknown>;
      outcome = "unknown"; reason = "inventory_commit_unknown";
    }
    if (settled?.settled !== true) continue;
    if (outcome === "complete") result.completed++;
    else if (outcome === "unknown") result.unknown++;
    else result.failed++;
    if (typeof settled.incidentId === "string") await dependencies.notify?.(settled.incidentId, claim.pool.id, reason);
  }
  // Also resumes setup/recovery imports and previously stocked cases when there
  // was no refill. The core RPC rechecks the rolling email allowance atomically.
  const resumed = await rpc("service_resume_refund_gift_card_cases") as Record<string, unknown>;
  result.resumed = Number(resumed?.issued) || 0;
  return result;
}
