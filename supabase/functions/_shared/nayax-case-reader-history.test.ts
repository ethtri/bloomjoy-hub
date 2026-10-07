import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveRefundCaseReader, resolveRefundExecutionReader, loadRefundCaseReaderClock } from "./nayax-lookup.ts";
import { parseNayaxRefundExecutionContext } from "./nayax-refund-context.ts";

const client = (response: unknown, calls: unknown[]) => ({
  rpc(name: string, args: unknown) {
    calls.push({ name, args });
    return Promise.resolve(response);
  },
}) as unknown as Pick<SupabaseClient, "rpc">;

Deno.test("matched old reader is used without substituting current configuration", async () => {
  const calls: unknown[] = [];
  const identity = await resolveRefundCaseReader(client({ data: { readerId: "18030001", accountKey: "TGPACI_USA_DB" }, error: null }, calls), "case-original", "stable-machine");
  assertEquals(identity, { readerId: "18030001", accountKey: "TGPACI_USA_DB" });
  assertEquals(calls, [{ name: "service_refund_case_reader_identity", args: { p_case_id: "case-original", p_machine_id: "stable-machine" } }]);
});

Deno.test("ambiguous purchase has no reader or account fallback", async () => {
  assertEquals(await resolveRefundCaseReader(client({ data: { readerId: null, accountKey: null }, error: null }, []), "ambiguous", "stable-machine"), { readerId: null, accountKey: null });
});

Deno.test("group members retain exact separate case-machine scopes", async () => {
  const calls: unknown[] = [];
  const scoped = client({ data: { readerId: "18030001", accountKey: "TGPACI_USA_DB" }, error: null }, calls);
  await Promise.all([resolveRefundCaseReader(scoped, "group-case", "machine-a"), resolveRefundCaseReader(scoped, "group-case", "machine-b")]);
  assertEquals(calls, [
    { name: "service_refund_case_reader_identity", args: { p_case_id: "group-case", p_machine_id: "machine-a" } },
    { name: "service_refund_case_reader_identity", args: { p_case_id: "group-case", p_machine_id: "machine-b" } },
  ]);
});

Deno.test("failed or malformed original identity fails closed", async () => {
  await assertRejects(() => resolveRefundCaseReader(client({ data: null, error: new Error("scope changed") }, []), "case", "machine"), Error, "scope changed");
  await assertRejects(() => resolveRefundCaseReader(client({ data: {}, error: null }, []), "case", "machine"), Error, "Original reader identity unavailable");
});

Deno.test("execution validates frozen original against trusted old tuple, not replacement configuration", async () => {
  const original = await resolveRefundExecutionReader(client({ data: { readerId: "OLD", accountKey: "OLD_ACCOUNT" }, error: null }, []), "case", "machine");
  const expected = { caseId: "case", caseVersion: 3, attemptGeneration: 0, transactionId: "12345678", siteId: 6,
    amountCents: 700, accountScope: original.accountKey, providerMachineId: original.readerId,
    machineAuthorizationInstant: "2026-08-26T17:17:08.123Z" };
  const frozen = { ...expected, contextHash: "a".repeat(64), originalAmountCents: 700, currencyCode: "USD",
    machineAuthorizationTime: "2026-08-26T13:17:08.123", machineAuthorizationTimeSource: "MachineAuthorizationTime",
    machineAuthorizationTimeInstant: expected.machineAuthorizationInstant, machineAuthorizationTimeWire: "2026-08-26T13:17:08.123",
    machineAuthorizationTimeSerializationMode: "exact_source", machineAuthorizationTimeSerializationSource: "exact_source" };
  assertEquals(parseNayaxRefundExecutionContext(frozen, expected)?.providerMachineId, "OLD");
  assertEquals(parseNayaxRefundExecutionContext({ ...frozen, providerMachineId: "NEW" }, expected), null);
  assertEquals(parseNayaxRefundExecutionContext({ ...frozen, accountScope: "NEW_ACCOUNT" }, expected), null);
});

Deno.test("unknown original cannot supply execution credentials or wildcard queue scope", async () => {
  await assertRejects(() => resolveRefundExecutionReader(client({ data: { readerId: null, accountKey: null }, error: null }, []), "case", "machine"), Error, "requires review");
});

Deno.test("retired original inventory clock uses exact case scope without current ownership pointer", async () => {
  const calls: unknown[] = [];
  const clock = await loadRefundCaseReaderClock(client({ data: { provider_clock_timezone: "America/Los_Angeles",
    provider_clock_source: "native_machine_configuration", provider_clock_observed_at: "2026-09-01T00:00:00Z", provider_clock_daylight_saving: true }, error: null }, calls), "old-case", "original-machine");
  assertEquals(clock, { reportingMachineId: "original-machine", timezone: "America/Los_Angeles", source: "native_machine_configuration", observedAt: "2026-09-01T00:00:00Z" });
  assertEquals(calls, [{ name: "service_refund_case_reader_clock", args: { p_case_id: "old-case", p_machine_id: "original-machine" } }]);
  await assertRejects(() => loadRefundCaseReaderClock(client({ data: null, error: new Error("wrong case scope") }, []), "wrong", "machine"), Error, "wrong case scope");
});
