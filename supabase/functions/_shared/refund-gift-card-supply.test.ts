import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runRefundGiftCardSupply } from "./refund-gift-card-supply.ts";
import { SupplyError, type SupplyClaim } from "./refund-gift-card-providers.ts";
const claim = (id: string, reconcile = false) => ({ claimed: true, attemptId: id, claimToken: "token", reconcile, pool: { id }, requestedCount: 1 }) as unknown as SupplyClaim;
Deno.test("one pool's unknown outcome preserves its attempt and other pools refill/resume", async () => {
  const claims = [claim("lost"), claim("healthy"), { claimed: false }];
  const outcomes: Record<string, unknown>[] = [];
  const result = await runRefundGiftCardSupply({ rpc: async (name, args = {}) => {
    if (name === "service_claim_refund_gift_card_refill") return { data: claims.shift(), error: null };
    if (name === "service_finish_refund_gift_card_refill") { outcomes.push(args); return { data: { settled: true }, error: null }; }
    if (name === "service_resume_refund_gift_card_cases") return { data: { issued: 2 }, error: null };
    return { data: true, error: null };
  } }, { adapter: async (c) => ({ prepare: async () => [], reconcile: async () => null, create: async () => { if (c.attemptId === "lost") throw new SupplyError("provider_transport_failure", true); return []; } }) });
  assertEquals(outcomes.map((v) => v.p_outcome), ["unknown", "complete"]);
  assertEquals(result, { unknown: 1, completed: 1, failed: 0, resumed: 2 });
});
Deno.test("recovery reads unknown attempt without another provider creation", async () => {
  const claims = [claim("recover", true), { claimed: false }]; let creates = 0;
  await runRefundGiftCardSupply({ rpc: async (name) => ({ data: name === "service_claim_refund_gift_card_refill" ? claims.shift() : name === "service_resume_refund_gift_card_cases" ? { issued: 0 } : { settled: true }, error: null }) }, { adapter: async () => ({ prepare: async () => [], create: async () => { creates++; return []; }, reconcile: async () => [] }) });
  assertEquals(creates, 0);
});
Deno.test("failed preparation has no provider dispatch and records retryable failure", async () => {
  const claims = [claim("prepare"), { claimed: false }]; let outcome;
  await runRefundGiftCardSupply({ rpc: async (name, args = {}) => {
    if (name === "service_claim_refund_gift_card_refill") return { data: claims.shift(), error: null };
    if (name === "service_finish_refund_gift_card_refill") outcome = args.p_outcome;
    return { data: { settled: true }, error: null };
  } }, { adapter: async () => { throw new SupplyError("provider_credentials_missing"); } });
  assertEquals(outcome, "failed");
});
Deno.test("a failed inventory commit after creation is held unknown without provider retry", async () => {
  const claims = [claim("commit"), { claimed: false }]; const outcomes: unknown[] = []; let writes = 0;
  await runRefundGiftCardSupply({ rpc: async (name, args = {}) => {
    if (name === "service_claim_refund_gift_card_refill") return { data: claims.shift(), error: null };
    if (name === "service_finish_refund_gift_card_refill") { outcomes.push(args.p_outcome); if (args.p_outcome === "complete") return { data: null, error: "synthetic failed transaction" }; }
    return { data: name === "service_begin_refund_gift_card_refill" ? true : { settled: true }, error: null };
  } }, { adapter: async () => ({ prepare: async () => [], reconcile: async () => null, create: async () => { writes++; return []; } }) });
  assertEquals(outcomes, ["complete", "unknown"]); assertEquals(writes, 1);
});
