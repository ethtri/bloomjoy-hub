import { createHash } from "node:crypto";

export type SupplyClaim = {
  attemptId: string;
  claimToken: string;
  reconcile: boolean;
  requestedCount: number;
  pool: { id: string; provider: string; provider_account_id: string; currency: string; face_value_cents: number; expires_at: string };
  config: Record<string, unknown>;
  baseline: string[];
  attemptedAt: string | null;
};
export type ProviderCode = { provider_code_id: string; code: string; valid_from: string; expires_at: string; provider_evidence: Record<string, unknown> };
export class SupplyError extends Error {
  constructor(public reason: string, public unknown = false) { super(reason); }
}
type Row = Record<string, unknown>;
type Requester = (path: string, method: string, body?: Row) => Promise<Row>;

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const identity = (value: unknown) => typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value)) ? String(value) : "";
const decimal = (cents: number) => (cents / 100).toFixed(2);
const cents = (value: unknown) => {
  const s = String(value ?? "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) throw new SupplyError("provider_value_invalid", true);
  const [whole, fraction = ""] = s.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
};
const array = (value: unknown): Row[] => Array.isArray(value) && value.every((v) => v && typeof v === "object" && !Array.isArray(v)) ? value : [];

// Dates sent to KeMore are explicit local wall clocks under the configured provider
// timezone. A returned offset-free value must round-trip to the exact requested clock.
export const providerClock = (instant: string, timezone: string) => {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new SupplyError("invalid_expiry");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (key: string) => parts.find((p) => p.type === key)?.value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
};
const assertClock = (value: unknown, expectedInstant: string, timezone: string) => {
  const s = text(value);
  if (s.replace("T", " ") === providerClock(expectedInstant, timezone)) return;
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Date.parse(s) === Date.parse(expectedInstant)) return;
  throw new SupplyError("provider_dates_mismatch", true);
};

const safeConfig = (claim: SupplyClaim) => {
  const c = claim.config;
  if (c.scope_verified !== true || c.currency_verified !== true || !/^[A-Z][A-Z0-9_]{0,70}$/.test(text(c.credential_prefix))) throw new SupplyError("provider_configuration_incomplete");
  if (!Number.isSafeInteger(claim.requestedCount) || claim.requestedCount < 1 || claim.requestedCount > 200 || !Number.isSafeInteger(claim.pool.face_value_cents) || claim.pool.face_value_cents < 1) throw new SupplyError("invalid_batch");
  if (claim.pool.currency !== "USD") throw new SupplyError("provider_currency_unverified");
  return c;
};

async function transport(fetchImpl: typeof fetch, url: string, options: RequestInit, mutation = false): Promise<Row> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal, redirect: "error" });
    if (!response.ok) throw new SupplyError("provider_http_failure", mutation && response.status !== 401 && response.status !== 403);
    const payload = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new SupplyError("provider_response_invalid", mutation);
    return payload;
  } catch (error) {
    if (error instanceof SupplyError) throw error;
    // Never include request URLs, credentials, raw responses or real codes in errors.
    throw new SupplyError("provider_transport_failure", mutation);
  } finally { clearTimeout(timeout); }
}

async function allPages(request: Requester, path: string, query: Row, sunzee = false): Promise<Row[]> {
  const rows: Row[] = [];
  let total: number | null = null;
  const seen = new Set<string>();
  for (let page = 1; page <= 100; page++) {
    const payload = await request(path, sunzee ? "POST" : "GET", { ...query, [sunzee ? "current" : "page"]: page, size: 50 });
    if (sunzee ? payload.code !== "00000" : payload.code !== 0) throw new SupplyError("provider_list_failure");
    const data = payload.data as Row;
    const records = data?.[sunzee ? "records" : "list"];
    if (!Array.isArray(records) || !Number.isSafeInteger(data?.total) || Number(data.total) < 0) throw new SupplyError("provider_list_invalid");
    total ??= Number(data.total);
    if (total !== Number(data.total)) throw new SupplyError("provider_list_drift");
    for (const row of array(records)) {
      const id = identity(row.id);
      if (!id || seen.has(id)) throw new SupplyError("provider_list_duplicate");
      seen.add(id); rows.push(row);
    }
    if (rows.length === total) return rows;
    if (records.length === 0 || rows.length > total) throw new SupplyError("provider_list_incomplete");
  }
  throw new SupplyError("provider_page_limit");
}

export type SupplyAdapter = {
  prepare(): Promise<string[]>;
  create(): Promise<ProviderCode[]>;
  reconcile(): Promise<ProviderCode[] | null>;
};

export async function createSupplyAdapter(claim: SupplyClaim, {
  fetchImpl = fetch,
  env = (name: string) => Deno.env.get(name),
}: { fetchImpl?: typeof fetch; env?: (name: string) => string | undefined } = {}): Promise<SupplyAdapter> {
  const config = safeConfig(claim);
  const prefix = text(config.credential_prefix);
  const username = env(`${prefix}_USERNAME`);
  const password = env(`${prefix}_PASSWORD`);
  if (!username || !password) throw new SupplyError("provider_credentials_missing");
  if (claim.pool.provider === "kemore") {
    const base = "https://kxzus.kexiaozhan.com/mer";
    const login = await transport(fetchImpl, `${base}/user/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    const token = text((login.data as Row)?.token);
    if (login.code !== 0 || !token) throw new SupplyError("provider_login_failed");
    const merchantId = text(config.merchant_id);
    const timezone = text(config.timezone);
    const machineIds = config.machine_ids;
    if (merchantId !== claim.pool.provider_account_id || !timezone || !Array.isArray(machineIds) || !machineIds.length || machineIds.some((v) => typeof v !== "string" || !v)) throw new SupplyError("provider_scope_invalid");
    const start = claim.attemptedAt ?? new Date().toISOString();
    const name = `Bloomjoy refill ${claim.attemptId}`;
    const scopes = [{ scopeType: 1, scopeValue: machineIds }, { scopeType: 2, scopeValue: [] }, { scopeType: 3, scopeValue: [] }];
    const request: Requester = async (path, method, body = {}) => {
      const url = new URL(base + path);
      if (method === "GET") for (const [k, v] of Object.entries(body)) url.searchParams.set(k, String(v));
      return transport(fetchImpl, url.href, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Language: "en-US", Timezone: timezone }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) }, method === "POST");
    };
    const reconcile = async (): Promise<ProviderCode[] | null> => {
      const coupons = (await allPages(request, "/v1/coupons", { name })).filter((r) => r.name === name);
      if (!coupons.length) return null; // Absence does not establish a failed creation.
      if (coupons.length !== 1) throw new SupplyError("provider_batch_ambiguous", true);
      const coupon = coupons[0];
      if (identity(coupon.merchantId) !== merchantId || coupon.discountType !== 1 || cents(coupon.discountValue) !== claim.pool.face_value_cents || coupon.currency !== claim.pool.currency || coupon.isActive !== true || coupon.useScopeType !== 0) throw new SupplyError("provider_batch_mismatch", true);
      const returnedScopes = array(coupon.scopes);
      const deviceScope = returnedScopes.find((s) => s.scopeType === 1);
      if (!deviceScope || !Array.isArray(deviceScope.scopeValue) || JSON.stringify([...deviceScope.scopeValue].map(String).sort()) !== JSON.stringify([...machineIds].sort())) throw new SupplyError("provider_scope_mismatch", true);
      const records = await allPages(request, "/v1/coupon-codes", { couponId: identity(coupon.id) });
      if (records.length !== claim.requestedCount) throw new SupplyError("provider_batch_count_mismatch", true);
      return records.map((r) => {
        if (typeof r.code !== "string" || !/^\d{9}$/.test(r.code) || identity(r.couponId) !== identity(coupon.id) || identity(r.merchantId) !== merchantId || r.status !== 0 || r.availableCount !== 1 || r.usedCount !== 0) throw new SupplyError("provider_code_mismatch", true);
        assertClock(r.startTime, start, timezone); assertClock(r.endTime, claim.pool.expires_at, timezone);
        return { provider_code_id: identity(r.id), code: r.code, valid_from: start, expires_at: claim.pool.expires_at, provider_evidence: { source: "kemore_merchant", coupon_id: identity(coupon.id), one_use: true, attempt_id: claim.attemptId } };
      });
    };
    return {
      prepare: async () => [],
      create: async () => {
        const result = await request("/v1/coupon-compose", "POST", { currency: claim.pool.currency, merchantId, name, description: name, isActive: true, discountType: 1, discountValue: decimal(claim.pool.face_value_cents), useScopeType: 0, useMerchantScope: [], scopes, number: claim.requestedCount, availableCount: 1, startTime: providerClock(start, timezone), endTime: providerClock(claim.pool.expires_at, timezone) });
        if (result.code !== 0) throw new SupplyError("provider_creation_rejected");
        try { const result = await reconcile(); if (!result) throw new SupplyError("provider_creation_not_visible", true); return result; }
        catch (e) { throw new SupplyError(e instanceof SupplyError ? e.reason : "provider_verification_failed", true); }
      }, reconcile,
    };
  }
  if (claim.pool.provider === "sunzee") {
    const base = "https://sz.sunzee.com.cn/SZWL-SERVER";
    const hash = createHash("md5").update(password).digest("hex");
    const login = await transport(fetchImpl, `${base}/tAdmin/loginSys`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: hash, hostName: "Sunzee" }) });
    const account = login.data as Row;
    if (login.code !== "00000" || !text(account?.currentToken) || identity(account.id) !== claim.pool.provider_account_id) throw new SupplyError("provider_login_scope_mismatch");
    const months = config.validity_months;
    if (config.account_wide_scope !== true || !Number.isInteger(months) || Number(months) < 1 || Number(months) > 3) throw new SupplyError("provider_scope_invalid");
    const request: Requester = (path, method, body = {}) => transport(fetchImpl, base + path, { method, headers: { Authorization: text(account.currentToken), "Content-Type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) }, path.startsWith("/tPromoCode/add"));
    const list = () => allPages(request, "/tPromoCode/list", { adminId: account.id, isUse: "0" }, true);
    let baseline = claim.baseline;
    return {
      prepare: async () => { baseline = (await list()).map((r) => identity(r.id)); return baseline; },
      create: async () => {
        const params = new URLSearchParams({ adminId: identity(account.id), addMode: "1", codeNum: "", number: String(claim.requestedCount), month: String(months), type: "1", discount: decimal(claim.pool.face_value_cents), frpCode: "WEIXIN_NATIVE" });
        const result = await request(`/tPromoCode/add?${params}`, "GET");
        if (result.code !== "00000") throw new SupplyError("provider_creation_rejected");
        try {
          const fresh = (await list()).filter((r) => !baseline.includes(identity(r.id)));
          if (fresh.length !== claim.requestedCount) throw new SupplyError("provider_batch_ambiguous", true);
          return fresh.map((r) => {
            if (identity(r.adminId) !== claim.pool.provider_account_id || r.type !== "1" || r.isUse !== "0" || cents(r.discount) !== claim.pool.face_value_cents || !Number.isSafeInteger(r.code) || Number(r.code) < 100000 || Number(r.code) > 999999 || typeof r.lastUseDate !== "number" || r.lastUseDate < Date.parse(claim.pool.expires_at) || typeof r.createDate !== "number" || r.createDate < Date.parse(claim.attemptedAt ?? new Date().toISOString()) - 60_000) throw new SupplyError("provider_code_mismatch", true);
            return { provider_code_id: identity(r.id), code: String(r.code), valid_from: new Date(r.createDate).toISOString(), expires_at: new Date(r.lastUseDate).toISOString(), provider_evidence: { source: "sunzee_account_delta", one_use: true, attempt_id: claim.attemptId } };
          });
        } catch (e) { throw new SupplyError(e instanceof SupplyError ? e.reason : "provider_verification_failed", true); }
      },
      // Sunzee does not expose a creation marker. A list delta without the
      // observed successful response cannot prove which request made that batch.
      reconcile: async () => null,
    };
  }
  throw new SupplyError("provider_unsupported");
}
