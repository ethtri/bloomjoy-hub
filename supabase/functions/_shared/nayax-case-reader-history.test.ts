import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveRefundCaseReader } from "./nayax-lookup.ts";

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
