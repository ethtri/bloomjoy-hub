import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSupplyAdapter, providerClock, SupplyError, type SupplyClaim } from "./refund-gift-card-providers.ts";

// All codes, credentials and identities here are synthetic fixtures.
const claim = (provider = "kemore"): SupplyClaim => ({
  attemptId: "00000000-0000-4000-8000-000000000001", claimToken: "00000000-0000-4000-8000-000000000002",
  reconcile: false, requestedCount: 1, baseline: ["old"], attemptedAt: "2026-09-30T12:00:00Z",
  pool: { id: "pool", provider, provider_account_id: "42", currency: "USD", face_value_cents: 1500, expires_at: "2026-12-20T12:00:00Z" },
  config: { credential_prefix: "TEST_SUPPLY", scope_verified: true, currency_verified: true, merchant_id: "42", machine_ids: ["machine-synthetic"], timezone: "America/Los_Angeles", validity_months: 3, account_wide_scope: true },
});
const credentials = () => "synthetic-only";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const coupon = (c: SupplyClaim) => ({ id: "coupon", name: `Bloomjoy refill ${c.attemptId}`, merchantId: 42, discountType: 1, discountValue: "15.00", currency: "USD", isActive: true, useScopeType: 0, useMerchantScope: [], scopes: [{ scopeType: 1, scopeValue: ["machine-synthetic"] }] });
const kemoreCode = (c: SupplyClaim) => ({ id: "synthetic-code-id", couponId: "coupon", merchantId: 42, code: "000000123", status: 0, availableCount: 1, usedCount: 0, startTime: providerClock(c.attemptedAt!, "America/Los_Angeles"), endTime: providerClock(c.pool.expires_at, "America/Los_Angeles") });
const kemore = (c: SupplyClaim, transform: (value: Record<string, unknown>) => Record<string, unknown> = (v) => v) => {
  const calls: { path: string; method: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, method: init?.method ?? "GET", body, headers: new Headers(init?.headers) });
    if (path.endsWith("/user/login")) return json({ code: 0, data: { token: "synthetic-token" } });
    if (path.endsWith("/coupon-compose")) return json({ code: 0, data: { codes: ["000000123"] } });
    if (path.endsWith("/coupons")) return json({ code: 0, data: { total: 1, list: [transform(coupon(c))] } });
    // Nonempty response is a prospective fixture: connected account's existing
    // coupons have empty scopes. Fail closed if a first real batch differs.
    if (path.endsWith("/coupon-scopes")) return json({ code: 0, data: { total: 1, list: [{ id: "scope", couponId: "coupon", scopeType: 1, scopeValue: "machine-synthetic" }] } });
    if (path.endsWith("/coupon-codes")) return json({ code: 0, data: { total: 1, list: [transform(kemoreCode(c))] } });
    throw new Error("Unexpected fixture path");
  };
  return { calls, fetchImpl };
};

Deno.test("KeMore uses observed Americas composer and preserves leading zeros after private verification", async () => {
  const c = claim(), fixture = kemore(c);
  const adapter = await createSupplyAdapter(c, { fetchImpl: fixture.fetchImpl, env: credentials });
  const codes = await adapter.create();
  assertEquals(codes[0].code, "000000123");
  const writes = fixture.calls.filter((r) => r.path.endsWith("coupon-compose"));
  assertEquals(writes.length, 1);
  assertEquals(writes[0].body.availableCount, 1);
  assertEquals(writes[0].body.discountValue, "15.00");
  assertEquals(writes[0].body.currency, "USD");
  assertEquals(writes[0].headers.get("X-App-TimeZone"), "America/Los_Angeles");
  assertEquals(writes[0].body.scopes, [{ scopeType: 1, scopeValue: ["machine-synthetic"] }, { scopeType: 2, scopeValue: [] }, { scopeType: 3, scopeValue: [] }]);
});
Deno.test("KeMore validates separate scope rows when coupon list embeds no scopes", async () => {
  const c = claim(), fixture = kemore(c, (v) => "scopes" in v ? { ...v, scopes: [] } : v);
  const adapter = await createSupplyAdapter(c, { fetchImpl: fixture.fetchImpl, env: credentials });
  assertEquals((await adapter.create()).length, 1);
  assertEquals(fixture.calls.some((r) => r.path.endsWith("coupon-scopes")), true);
});
Deno.test("KeMore holds unexpected nonempty separate category scopes", async () => {
  const c = claim(), fixture = kemore(c);
  const adapter = await createSupplyAdapter(c, { env: credentials, fetchImpl: (input, init) => String(input).includes("/coupon-scopes?") ? Promise.resolve(json({ code: 0, data: { total: 1, list: [{ id: "scope", scopeType: 2, scopeValue: "unexpected-category" }] } })) : fixture.fetchImpl(input, init) });
  assertEquals((await assertRejects(() => adapter.create(), SupplyError) as SupplyError).unknown, true);
});
Deno.test("KeMore reconciliation reads exact attempt name without another creation", async () => {
  const c = claim(); c.reconcile = true;
  const fixture = kemore(c);
  const adapter = await createSupplyAdapter(c, { fetchImpl: fixture.fetchImpl, env: credentials });
  assertEquals((await adapter.reconcile())?.length, 1);
  assertEquals(fixture.calls.some((r) => r.path.endsWith("coupon-compose")), false);
});
for (const [name, transform] of [
  ["wrong face value", (v: Record<string, unknown>) => "discountValue" in v ? { ...v, discountValue: "10.00" } : v],
  ["wrong device", (v: Record<string, unknown>) => "scopes" in v ? { ...v, scopes: [{ scopeType: 1, scopeValue: ["wrong"] }] } : v],
  ["extra category scope", (v: Record<string, unknown>) => "scopes" in v ? { ...v, scopes: [...v.scopes as unknown[], { scopeType: 2, scopeValue: ["unexpected-category"] }] } : v],
  ["extra merchant scope", (v: Record<string, unknown>) => "useMerchantScope" in v ? { ...v, useMerchantScope: ["unexpected-merchant"] } : v],
  ["used code", (v: Record<string, unknown>) => "usedCount" in v ? { ...v, usedCount: 1 } : v],
  ["numeric code loses zeros", (v: Record<string, unknown>) => "code" in v ? { ...v, code: 123 } : v],
  ["shortened expiry", (v: Record<string, unknown>) => "endTime" in v ? { ...v, endTime: "2026-10-01 00:00:00" } : v],
] as const) Deno.test(`KeMore holds successful creation with ${name}`, async () => {
  const c = claim(), fixture = kemore(c, transform);
  const adapter = await createSupplyAdapter(c, { fetchImpl: fixture.fetchImpl, env: credentials });
  const error = await assertRejects(() => adapter.create(), SupplyError);
  assertEquals((error as SupplyError).unknown, true);
});
Deno.test("creation transport loss is unknown and never retried", async () => {
  const c = claim(), fixture = kemore(c);
  let writes = 0;
  const adapter = await createSupplyAdapter(c, { env: credentials, fetchImpl: (input, init) => {
    if (String(input).endsWith("coupon-compose")) { writes++; return Promise.reject(new Error("synthetic transport lost")); }
    return fixture.fetchImpl(input, init);
  } });
  const error = await assertRejects(() => adapter.create(), SupplyError);
  assertEquals((error as SupplyError).unknown, true);
  assertEquals(writes, 1);
  assertEquals(error.message.includes("synthetic transport"), false);
});
Deno.test("KeMore missing reconciliation record remains unknown rather than creating again", async () => {
  const c = claim(), fixture = kemore(c);
  const adapter = await createSupplyAdapter(c, { env: credentials, fetchImpl: (input, init) => String(input).includes("/coupons?") ? Promise.resolve(json({ code: 0, data: { total: 0, list: [] } })) : fixture.fetchImpl(input, init) });
  assertEquals(await adapter.reconcile(), null);
});
Deno.test("provider timezone round-trips daylight saving correctly", () => {
  assertEquals(providerClock("2026-11-01T08:30:00Z", "America/Los_Angeles"), "2026-11-01 01:30:00");
  assertEquals(providerClock("2026-11-01T09:30:00Z", "America/Los_Angeles"), "2026-11-01 01:30:00");
});
Deno.test("Sunzee success binds a complete account delta; unknown cannot mint another batch", async () => {
  const c = claim("sunzee");
  let created = false, writes = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("loginSys")) return json({ code: "00000", data: { id: 42, currentToken: "synthetic-token" } });
    if (url.pathname.endsWith("/add")) { writes++; created = true; assertEquals(url.searchParams.get("number"), "1"); return json({ code: "00000" }); }
    const row = { id: "fresh", adminId: 42, type: "1", isUse: "0", code: 123456, discount: 15, createDate: Date.parse(c.attemptedAt!), lastUseDate: Date.parse(c.pool.expires_at) + 86400000 };
    return json({ code: "00000", data: { total: created ? 2 : 1, records: [{ id: "old" }, ...(created ? [row] : [])] } });
  };
  const adapter = await createSupplyAdapter(c, { fetchImpl, env: credentials });
  assertEquals(await adapter.prepare(), ["old"]);
  assertEquals((await adapter.create())[0].code, "123456");
  assertEquals(await adapter.reconcile(), null);
  assertEquals(writes, 1);
});
Deno.test("missing provider setup stops before login or value creation", async () => {
  const c = claim(); c.config.scope_verified = false;
  let calls = 0;
  await assertRejects(() => createSupplyAdapter(c, { env: credentials, fetchImpl: () => { calls++; return Promise.resolve(json({})); } }), SupplyError);
  assertEquals(calls, 0);
});
