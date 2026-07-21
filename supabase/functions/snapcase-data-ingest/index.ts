import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ingestToken = Deno.env.get("SNAPCASE_INGEST_TOKEN");
const rowHashSalt = Deno.env.get("REPORTING_ROW_HASH_SALT");
const maxRows = Number(Deno.env.get("SNAPCASE_INGEST_MAX_ROWS") ?? "20000");

const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false },
      })
    : null;

const forbiddenKeys = new Set([
  "authorization",
  "bearertoken",
  "cardlast4",
  "contactemail",
  "contactperson",
  "contactphone",
  "customeremail",
  "customername",
  "deliveryaddress",
  "lastconnectip",
  "password",
  "receipturl",
  "registerip",
  "shippingaddress",
  "token",
  "workimageurl",
]);

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sanitizeText = (value: unknown, maxLength = 300) =>
  String(value ?? "").trim().slice(0, maxLength);

const normalizeKey = (value: string) =>
  value.replace(/[^a-z0-9]/gi, "").toLowerCase();

const assertNoSensitiveFields = (value: unknown, path = "body") => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSensitiveFields(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenKeys.has(normalizeKey(key))) {
      throw new Error(`Sensitive provider field is not accepted at ${path}.${key}`);
    }
    assertNoSensitiveFields(nestedValue, `${path}.${key}`);
  }
};

const encoder = new TextEncoder();

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const authMatches = async (authorization: string | null) => {
  if (!ingestToken || !authorization) return false;
  const expected = await sha256(`Bearer ${ingestToken}`);
  const actual = await sha256(authorization);
  return expected === actual;
};

const requiredText = (value: unknown, field: string, maxLength = 300) => {
  const normalized = sanitizeText(value, maxLength);
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
};

const requiredSha256 = (value: unknown, field: string) => {
  const normalized = requiredText(value, field, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${field} must be a SHA-256 digest`);
  }
  return normalized;
};

const pickRedactedPayload = (value: unknown, allowedKeys: readonly string[]) => {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("redactedPayload must be an object");
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, string | number | boolean | null> = {};
  for (const key of allowedKeys) {
    if (!Object.hasOwn(source, key)) continue;
    const item = source[key];
    if (
      item !== null &&
      typeof item !== "string" &&
      typeof item !== "number" &&
      typeof item !== "boolean"
    ) {
      throw new Error(`redactedPayload.${key} must be a primitive value`);
    }
    result[key] = typeof item === "string" ? sanitizeText(item, 120) : item;
  }
  return result;
};

const optionalText = (value: unknown, maxLength = 300) =>
  sanitizeText(value, maxLength) || null;

const optionalCurrency = (value: unknown) => {
  const normalized = sanitizeText(value, 3).toUpperCase();
  if (!normalized) return null;
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error("Currency must be an ISO-4217 code");
  return normalized;
};

const optionalInteger = (value: unknown, field: string) => {
  if (value === null || value === undefined || value === "") return null;
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return normalized;
};

const optionalSignedInteger = (value: unknown, field: string) => {
  if (value === null || value === undefined || value === "") return null;
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized)) {
    throw new Error(`${field} must be a safe integer`);
  }
  return normalized;
};

const optionalTimestamp = (value: unknown) => {
  const normalized = optionalText(value, 50);
  if (!normalized) return null;
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

const asRecordArray = (value: unknown, field: string) => {
  if (value === undefined || value === null) return [] as Record<string, unknown>[];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  if (value.length > maxRows) throw new Error(`${field} exceeds the ingest row limit`);
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${field}[${index}] must be an object`);
    }
    return entry as Record<string, unknown>;
  });
};

const chunk = <T>(values: T[], size = 500) => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

type ProviderAccount = {
  id: string;
  provider: "kexiazhan" | "nayax";
  account_key: string;
  contract_status: "pending" | "approved" | "suspended";
  default_timezone: string | null;
  default_currency_code: string | null;
};

const loadProviderAccount = async (
  provider: "kexiazhan" | "nayax",
  accountKeyValue: unknown,
) => {
  if (!supabase) throw new Error("Snapcase ingest is not configured");
  const accountKey = requiredText(accountKeyValue, `${provider}AccountKey`, 120);
  const { data, error } = await supabase
    .from("reporting_provider_accounts")
    .select("id, provider, account_key, contract_status, default_timezone, default_currency_code")
    .eq("provider", provider)
    .eq("account_key", accountKey)
    .maybeSingle();

  if (error) throw new Error(error.message || "Unable to load provider account");
  if (!data) throw new Error(`${provider} provider account is not configured`);
  return data as ProviderAccount;
};

const loadExistingByValues = async ({
  table,
  providerAccountId,
  column,
  values,
  select,
}: {
  table: string;
  providerAccountId: string;
  column: string;
  values: string[];
  select: string;
}) => {
  if (!supabase || values.length === 0) return [] as Record<string, unknown>[];
  const rows: Record<string, unknown>[] = [];
  for (const valueChunk of chunk([...new Set(values)])) {
    const { data, error } = await supabase
    .from(table)
      .select(select)
      .eq("provider_account_id", providerAccountId)
      .in(column, valueChunk);
    if (error) throw new Error(error.message || `Unable to load ${table}`);
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
  }
  return rows;
};

const startRun = async (source: "kexiazhan_api" | "nayax_api", rowsSeen: number, meta: object) => {
  if (!supabase) throw new Error("Snapcase ingest is not configured");
  const { data, error } = await supabase
    .from("sales_import_runs")
    .insert({
      source,
      status: "running",
      source_reference: `snapcase-shadow:${source}:${new Date().toISOString()}`,
      rows_seen: rowsSeen,
      rows_imported: 0,
      rows_skipped: 0,
      meta: {
        ...meta,
        shadow_only: true,
        sales_publication_enabled: false,
      },
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message || "Unable to create provider sync run");
  return String(data.id);
};

const finishRun = async ({
  runId,
  status,
  imported,
  skipped,
  errorMessage,
}: {
  runId: string;
  status: "completed" | "failed";
  imported: number;
  skipped: number;
  errorMessage?: string;
}) => {
  if (!supabase) return;
  const { error } = await supabase
    .from("sales_import_runs")
    .update({
      status,
      rows_imported: imported,
      rows_skipped: skipped,
      error_message: errorMessage ? sanitizeText(errorMessage, 500) : null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (error) throw new Error(error.message || "Unable to finish provider sync run");
};

const recordSyncCursors = async ({
  account,
  resources,
  windowStart,
  windowEnd,
  runId,
}: {
  account: ProviderAccount;
  resources: { resource: string; rowCount: number }[];
  windowStart: string;
  windowEnd: string;
  runId: string;
}) => {
  if (!supabase || resources.length === 0) return;
  const nowIso = new Date().toISOString();
  const { error } = await supabase.from("provider_sync_cursors").upsert(
    resources.map(({ resource, rowCount }) => ({
      provider_account_id: account.id,
      resource,
      window_start: windowStart,
      window_end: windowEnd,
      last_successful_at: nowIso,
      last_import_run_id: runId,
      meta: {
        row_count: rowCount,
        shadow_only: true,
        overlap_strategy: "rolling_35_day_window",
      },
    })),
    { onConflict: "provider_account_id,resource" },
  );
  if (error) throw new Error(error.message || "Unable to record provider sync cursor");
};

const getSyncScope = async (body: Record<string, unknown>) => {
  const account = await loadProviderAccount("kexiazhan", body.accountKey);
  if (account.contract_status !== "approved") {
    return jsonResponse({
      approved: false,
      machineIds: [],
      merchantIds: [],
      reason: "provider_contract_not_approved",
    });
  }

  if (!supabase) throw new Error("Snapcase ingest is not configured");
  const { data, error } = await supabase
    .from("reporting_source_machines")
    .select("source_machine_id, source_merchant_id")
    .eq("provider_account_id", account.id)
    .eq("mapping_status", "approved");
  if (error) throw new Error(error.message || "Unable to load Snapcase sync scope");

  const machineIds = [...new Set((data ?? []).map((row) => sanitizeText(row.source_machine_id, 120)).filter(Boolean))];
  const merchantIds = [...new Set((data ?? []).map((row) => sanitizeText(row.source_merchant_id, 120)).filter(Boolean))];
  return jsonResponse({
    approved: true,
    machineIds,
    merchantIds,
    defaultTimezone: account.default_timezone,
    defaultCurrencyCode: account.default_currency_code,
  });
};

const stageMerchantsAndMachines = async ({
  account,
  machines,
}: {
  account: ProviderAccount;
  machines: Record<string, unknown>[];
}) => {
  if (!supabase) throw new Error("Snapcase ingest is not configured");
  const nowIso = new Date().toISOString();

  const merchantInputs = new Map<string, { id: string; name: string | null }>();
  for (const machine of machines) {
    const merchantId = optionalText(machine.sourceMerchantId, 120);
    if (merchantId && !merchantInputs.has(merchantId)) {
      merchantInputs.set(merchantId, {
        id: merchantId,
        name: optionalText(machine.merchantName, 200),
      });
    }
  }

  const existingMerchants = await loadExistingByValues({
    table: "reporting_source_merchants",
    providerAccountId: account.id,
    column: "source_merchant_id",
    values: [...merchantInputs.keys()],
    select: "source_merchant_id, scope_status, mapped_account_id, approved_by, approved_at, approval_reason, first_seen_at",
  });
  const merchantById = new Map(existingMerchants.map((row) => [String(row.source_merchant_id), row]));

  if (merchantInputs.size > 0) {
    const { error } = await supabase.from("reporting_source_merchants").upsert(
      [...merchantInputs.values()].map((merchant) => {
        const existing = merchantById.get(merchant.id);
        return {
          provider_account_id: account.id,
          source_merchant_id: merchant.id,
          merchant_name: merchant.name,
          scope_status: existing?.scope_status ?? "discovered",
          mapped_account_id: existing?.mapped_account_id ?? null,
          approved_by: existing?.approved_by ?? null,
          approved_at: existing?.approved_at ?? null,
          approval_reason: existing?.approval_reason ?? null,
          first_seen_at: existing?.first_seen_at ?? nowIso,
          last_seen_at: nowIso,
        };
      }),
      { onConflict: "provider_account_id,source_merchant_id" },
    );
    if (error) throw new Error(error.message || "Unable to stage provider merchants");
  }

  const machineIds = machines.map((machine) =>
    requiredText(machine.sourceMachineId, "machines[].sourceMachineId", 120)
  );
  const existingMachines = await loadExistingByValues({
    table: "reporting_source_machines",
    providerAccountId: account.id,
    column: "source_machine_id",
    values: machineIds,
    select: "source_machine_id, mapping_status, reporting_machine_id, approved_by, approved_at, approval_reason, first_seen_at",
  });
  const machineById = new Map(existingMachines.map((row) => [String(row.source_machine_id), row]));

  if (machines.length > 0) {
    const { error } = await supabase.from("reporting_source_machines").upsert(
      machines.map((machine) => {
        const sourceMachineId = requiredText(machine.sourceMachineId, "machines[].sourceMachineId", 120);
        const existing = machineById.get(sourceMachineId);
        const sourceMachineType = requiredText(machine.sourceMachineType, "machines[].sourceMachineType", 40);
        if (!["phone_case_printer", "film_applicator", "unknown"].includes(sourceMachineType)) {
          throw new Error("Unsupported Kexiazhan machine type");
        }
        return {
          provider_account_id: account.id,
          source_machine_id: sourceMachineId,
          source_serial: optionalText(machine.sourceSerial, 160),
          source_merchant_id: optionalText(machine.sourceMerchantId, 120),
          source_machine_type: sourceMachineType,
          source_machine_name: optionalText(machine.sourceMachineName, 200),
          source_timezone: optionalText(machine.sourceTimezone, 100) ?? account.default_timezone,
          source_currency_code:
            optionalCurrency(machine.sourceCurrencyCode) ?? account.default_currency_code,
          source_status: optionalText(machine.sourceStatus, 80),
          mapping_status: existing?.mapping_status ?? "discovered",
          reporting_machine_id: existing?.reporting_machine_id ?? null,
          approved_by: existing?.approved_by ?? null,
          approved_at: existing?.approved_at ?? null,
          approval_reason: existing?.approval_reason ?? null,
          first_seen_at: existing?.first_seen_at ?? nowIso,
          last_seen_at: nowIso,
        };
      }),
      { onConflict: "provider_account_id,source_machine_id" },
    );
    if (error) throw new Error(error.message || "Unable to stage provider machines");
  }
};

const loadApprovedScope = async (account: ProviderAccount) => {
  if (!supabase) throw new Error("Snapcase ingest is not configured");
  const [{ data: machines, error: machineError }, { data: merchants, error: merchantError }] =
    await Promise.all([
      supabase
        .from("reporting_source_machines")
        .select("source_machine_id, source_merchant_id, source_machine_type, source_timezone, source_currency_code")
        .eq("provider_account_id", account.id)
        .eq("mapping_status", "approved"),
      supabase
        .from("reporting_source_merchants")
        .select("source_merchant_id")
        .eq("provider_account_id", account.id)
        .eq("scope_status", "approved"),
    ]);
  if (machineError) throw new Error(machineError.message || "Unable to load approved source machines");
  if (merchantError) throw new Error(merchantError.message || "Unable to load approved source merchants");

  return {
    machines: new Map(
      (machines ?? []).map((machine) => [String(machine.source_machine_id), machine]),
    ),
    merchants: new Set(
      (merchants ?? []).map((merchant) => String(merchant.source_merchant_id)),
    ),
  };
};

const quarantineReasons = ({
  account,
  scope,
  sourceMachineId,
  sourceMerchantId,
  sourceMachineType,
  currencyCode,
  absoluteTimestamp,
  stableSourceId = true,
}: {
  account: ProviderAccount;
  scope: Awaited<ReturnType<typeof loadApprovedScope>>;
  sourceMachineId: string | null;
  sourceMerchantId: string | null;
  sourceMachineType?: string | null;
  currencyCode: string | null;
  absoluteTimestamp: string | null;
  stableSourceId?: boolean;
}) => {
  const reasons: string[] = [];
  if (account.contract_status !== "approved") reasons.push("provider_contract_not_approved");
  const approvedMachine = sourceMachineId ? scope.machines.get(sourceMachineId) : null;
  if (!approvedMachine) reasons.push("machine_not_allowlisted");
  if (
    sourceMerchantId &&
    !scope.merchants.has(sourceMerchantId)
  ) reasons.push("merchant_not_allowlisted");
  if (
    sourceMachineType === "film_applicator" ||
    approvedMachine?.source_machine_type === "film_applicator"
  ) reasons.push("unsupported_machine_type");
  if (!currencyCode) reasons.push("missing_currency_code");
  else if (currencyCode !== "USD") reasons.push("unsupported_currency");
  if (!absoluteTimestamp) reasons.push("ambiguous_timestamp");
  if (!stableSourceId) reasons.push("unstable_source_identifier");
  return [...new Set(reasons)].sort();
};

const stageOrders = async ({
  account,
  orders,
  scope,
  runId,
}: {
  account: ProviderAccount;
  orders: Record<string, unknown>[];
  scope: Awaited<ReturnType<typeof loadApprovedScope>>;
  runId: string;
}) => {
  if (!supabase || !rowHashSalt || orders.length === 0) return [] as { id: string; hash: string }[];
  const nowIso = new Date().toISOString();
  const normalized = await Promise.all(orders.map(async (order) => {
    const rawId = requiredText(order.sourceOrderId, "orders[].sourceOrderId", 160);
    const sourceMachineId = optionalText(order.sourceMachineId, 120);
    const sourceMerchantId = optionalText(order.sourceMerchantId, 120);
    const currencyCode = optionalCurrency(order.currencyCode);
    const paymentAt = optionalTimestamp(order.paymentAt);
    const reasons = quarantineReasons({
      account,
      scope,
      sourceMachineId,
      sourceMerchantId,
      sourceMachineType: Number(order.sourceOrderType) === 1 ? "phone_case_printer" : "unknown",
      currencyCode,
      absoluteTimestamp: paymentAt,
    });
    if (Number(order.sourceOrderType) !== 1) reasons.push("unsupported_order_type");
    const hash = await sha256(`${rowHashSalt}:kexiazhan:order:${rawId}`);
    return {
      hash,
      row: {
        provider_account_id: account.id,
        source_order_hash: hash,
        source_machine_id: sourceMachineId,
        source_merchant_id: sourceMerchantId,
        source_order_type: optionalSignedInteger(order.sourceOrderType, "sourceOrderType"),
        source_order_status: optionalText(order.sourceOrderStatus, 80),
        source_payment_status: optionalText(order.sourcePaymentStatus, 80),
        created_time_raw: optionalText(order.createdTimeRaw, 50),
        payment_time_raw: optionalText(order.paymentTimeRaw, 50),
        finish_time_raw: optionalText(order.finishTimeRaw, 50),
        created_at_utc: optionalTimestamp(order.createdAtUtc),
        payment_at: paymentAt,
        finished_at: optionalTimestamp(order.finishedAt),
        source_timezone: optionalText(order.sourceTimezone, 100) ?? account.default_timezone,
        currency_code: currencyCode,
        order_amount_minor: optionalInteger(order.orderAmountMinor, "orderAmountMinor"),
        discount_amount_minor: optionalInteger(order.discountAmountMinor, "discountAmountMinor"),
        payment_amount_minor: optionalInteger(order.paymentAmountMinor, "paymentAmountMinor"),
        refund_amount_minor: optionalInteger(order.refundAmountMinor, "refundAmountMinor"),
        tax_amount_minor: optionalInteger(order.taxAmountMinor, "taxAmountMinor"),
        tip_amount_minor: optionalInteger(order.tipAmountMinor, "tipAmountMinor"),
        product_name: optionalText(order.productName, 240),
        record_state: reasons.length === 0 ? "validated" : "quarantined",
        quarantine_reasons: [...new Set(reasons)].sort(),
        source_payload_hash: requiredSha256(order.sourcePayloadHash, "sourcePayloadHash"),
        redacted_payload: pickRedactedPayload(order.redactedPayload, [
          "itemQuantity",
          "materialCount",
          "platform",
          "sourcePayloadRedacted",
        ]),
        first_seen_import_run_id: runId,
        last_seen_import_run_id: runId,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
      },
    };
  }));

  const existing = await loadExistingByValues({
    table: "kexiazhan_order_staging",
    providerAccountId: account.id,
    column: "source_order_hash",
    values: normalized.map((entry) => entry.hash),
    select: "source_order_hash, first_seen_import_run_id, first_seen_at, record_state",
  });
  const existingByHash = new Map(existing.map((row) => [String(row.source_order_hash), row]));
  const rows = normalized.map((entry) => {
    const current = existingByHash.get(entry.hash);
    return {
      ...entry.row,
      first_seen_import_run_id: current?.first_seen_import_run_id ?? runId,
      first_seen_at: current?.first_seen_at ?? nowIso,
      record_state: current?.record_state === "rejected" ? "rejected" : entry.row.record_state,
    };
  });

  const { data, error } = await supabase
    .from("kexiazhan_order_staging")
    .upsert(rows, { onConflict: "provider_account_id,source_order_hash" })
    .select("id, source_order_hash");
  if (error) throw new Error(error.message || "Unable to stage Kexiazhan orders");
  return (data ?? []).map((row) => ({ id: String(row.id), hash: String(row.source_order_hash) }));
};

const stagePayments = async ({
  account,
  payments,
  scope,
  runId,
}: {
  account: ProviderAccount;
  payments: Record<string, unknown>[];
  scope: Awaited<ReturnType<typeof loadApprovedScope>>;
  runId: string;
}) => {
  if (!supabase || !rowHashSalt || payments.length === 0) {
    return [] as { id: string; hash: string; sourceOrderIds: string[]; paymentAt: string | null }[];
  }
  const nowIso = new Date().toISOString();
  const normalized = await Promise.all(payments.map(async (payment) => {
    const rawId = requiredText(payment.sourcePaymentId, "payments[].sourcePaymentId", 600);
    const externalReference = optionalText(payment.externalReference, 180);
    const sourceMachineId = optionalText(payment.sourceMachineId, 120);
    const sourceMerchantId = optionalText(payment.sourceMerchantId, 120);
    const currencyCode = optionalCurrency(payment.currencyCode);
    const paymentAt = optionalTimestamp(payment.paymentAt);
    const stableSourceId = payment.stableSourceId === true;
    const reasons = quarantineReasons({
      account,
      scope,
      sourceMachineId,
      sourceMerchantId,
      currencyCode,
      absoluteTimestamp: paymentAt,
      stableSourceId,
    });
    const method = requiredText(payment.normalizedPaymentMethod, "normalizedPaymentMethod", 20);
    if (!["cash", "credit", "other", "unknown"].includes(method)) {
      throw new Error("Unsupported normalized payment method");
    }
    const sourceOrderIds = Array.isArray(payment.sourceOrderIds)
      ? payment.sourceOrderIds.map((value) => sanitizeText(value, 160)).filter(Boolean)
      : [];
    const hash = await sha256(`${rowHashSalt}:kexiazhan:payment:${rawId}`);
    return {
      hash,
      sourceOrderIds,
      paymentAt,
      row: {
        provider_account_id: account.id,
        source_payment_hash: hash,
        external_reference_hash: externalReference
          ? await sha256(`${rowHashSalt}:shared-payment-reference:${externalReference}`)
          : null,
        source_machine_id: sourceMachineId,
        source_merchant_id: sourceMerchantId,
        payment_time_raw: optionalText(payment.paymentTimeRaw, 50),
        payment_at: paymentAt,
        source_timezone: optionalText(payment.sourceTimezone, 100) ?? account.default_timezone,
        currency_code: currencyCode,
        normalized_payment_method: method,
        source_payment_method: optionalText(payment.sourcePaymentMethod, 80),
        source_payment_instrument: optionalText(payment.sourcePaymentInstrument, 100),
        source_payment_status: optionalText(payment.sourcePaymentStatus, 80),
        payment_amount_minor: optionalInteger(payment.paymentAmountMinor, "paymentAmountMinor"),
        refund_amount_minor: optionalInteger(payment.refundAmountMinor, "refundAmountMinor"),
        tip_amount_minor: optionalInteger(payment.tipAmountMinor, "tipAmountMinor"),
        record_state: reasons.length === 0 ? "validated" : "quarantined",
        quarantine_reasons: reasons,
        source_payload_hash: requiredSha256(payment.sourcePayloadHash, "sourcePayloadHash"),
        redacted_payload: pickRedactedPayload(payment.redactedPayload, [
          "orderReferenceCount",
          "sourcePayloadRedacted",
        ]),
        first_seen_import_run_id: runId,
        last_seen_import_run_id: runId,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
      },
    };
  }));

  const existing = await loadExistingByValues({
    table: "kexiazhan_payment_staging",
    providerAccountId: account.id,
    column: "source_payment_hash",
    values: normalized.map((entry) => entry.hash),
    select: "source_payment_hash, first_seen_import_run_id, first_seen_at, record_state",
  });
  const existingByHash = new Map(existing.map((row) => [String(row.source_payment_hash), row]));
  const rows = normalized.map((entry) => {
    const current = existingByHash.get(entry.hash);
    return {
      ...entry.row,
      first_seen_import_run_id: current?.first_seen_import_run_id ?? runId,
      first_seen_at: current?.first_seen_at ?? nowIso,
      record_state: current?.record_state === "rejected" ? "rejected" : entry.row.record_state,
    };
  });

  const { data, error } = await supabase
    .from("kexiazhan_payment_staging")
    .upsert(rows, { onConflict: "provider_account_id,source_payment_hash" })
    .select("id, source_payment_hash");
  if (error) throw new Error(error.message || "Unable to stage Kexiazhan payments");
  const idByHash = new Map((data ?? []).map((row) => [String(row.source_payment_hash), String(row.id)]));
  return normalized.map((entry) => ({
    id: idByHash.get(entry.hash) ?? "",
    hash: entry.hash,
    sourceOrderIds: entry.sourceOrderIds,
    paymentAt: entry.paymentAt,
  })).filter((entry) => entry.id);
};

const stagePaymentOrderLinks = async ({
  account,
  payments,
  orders,
}: {
  account: ProviderAccount;
  payments: { id: string; sourceOrderIds: string[] }[];
  orders: { id: string; hash: string }[];
}) => {
  if (!supabase || !rowHashSalt) return 0;
  const orderByHash = new Map(orders.map((order) => [order.hash, order.id]));
  const links: { provider_account_id: string; kexiazhan_payment_id: string; kexiazhan_order_id: string }[] = [];

  for (const payment of payments) {
    for (const rawOrderId of payment.sourceOrderIds) {
      const orderHash = await sha256(`${rowHashSalt}:kexiazhan:order:${rawOrderId}`);
      const orderId = orderByHash.get(orderHash);
      if (orderId) {
        links.push({
          provider_account_id: account.id,
          kexiazhan_payment_id: payment.id,
          kexiazhan_order_id: orderId,
        });
      }
    }
  }

  if (links.length === 0) return 0;
  const { error } = await supabase
    .from("kexiazhan_payment_order_links")
    .upsert(links, { onConflict: "kexiazhan_payment_id,kexiazhan_order_id" });
  if (error) throw new Error(error.message || "Unable to stage payment/order links");
  return links.length;
};

const stageNayaxTransactions = async ({
  account,
  transactions,
  scope,
  runId,
}: {
  account: ProviderAccount;
  transactions: Record<string, unknown>[];
  scope: Awaited<ReturnType<typeof loadApprovedScope>>;
  runId: string;
}) => {
  if (!supabase || !rowHashSalt || transactions.length === 0) return 0;
  const nowIso = new Date().toISOString();
  const normalized = await Promise.all(transactions.map(async (transaction) => {
    const rawId = requiredText(transaction.sourceTransactionId, "nayaxTransactions[].sourceTransactionId", 160);
    const paymentServiceId = optionalText(transaction.paymentServiceTransactionId, 180);
    const sourceMachineId = optionalText(transaction.sourceMachineId, 120);
    const currencyCode = optionalCurrency(transaction.currencyCode);
    const authorizedAt = optionalTimestamp(transaction.authorizedAt);
    const reasons = quarantineReasons({
      account,
      scope,
      sourceMachineId,
      sourceMerchantId: null,
      currencyCode,
      absoluteTimestamp: authorizedAt,
    });
    const hash = await sha256(`${rowHashSalt}:nayax:transaction:${rawId}`);
    return {
      hash,
      row: {
        provider_account_id: account.id,
        source_transaction_hash: hash,
        payment_service_transaction_hash: paymentServiceId
          ? await sha256(`${rowHashSalt}:shared-payment-reference:${paymentServiceId}`)
          : null,
        source_machine_id: requiredText(sourceMachineId, "nayaxTransactions[].sourceMachineId", 120),
        authorization_time_raw: optionalText(transaction.authorizationTimeRaw, 50),
        authorized_at: authorizedAt,
        settlement_time_raw: optionalText(transaction.settlementTimeRaw, 50),
        settled_at: optionalTimestamp(transaction.settledAt),
        currency_code: currencyCode,
        authorization_amount_minor: optionalInteger(
          transaction.authorizationAmountMinor,
          "authorizationAmountMinor",
        ),
        settlement_amount_minor: optionalInteger(
          transaction.settlementAmountMinor,
          "settlementAmountMinor",
        ),
        source_payment_method: optionalText(transaction.sourcePaymentMethod, 100),
        source_payment_status: optionalText(transaction.sourcePaymentStatus, 100),
        product_name: optionalText(transaction.productName, 240),
        quantity: optionalInteger(transaction.quantity, "quantity"),
        record_state: reasons.length === 0 ? "validated" : "quarantined",
        quarantine_reasons: reasons,
        source_payload_hash: requiredSha256(transaction.sourcePayloadHash, "sourcePayloadHash"),
        redacted_payload: pickRedactedPayload(transaction.redactedPayload, [
          "paymentServiceProvider",
          "sourcePayloadRedacted",
        ]),
        first_seen_import_run_id: runId,
        last_seen_import_run_id: runId,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
      },
    };
  }));

  const existing = await loadExistingByValues({
    table: "nayax_transaction_staging",
    providerAccountId: account.id,
    column: "source_transaction_hash",
    values: normalized.map((entry) => entry.hash),
    select: "source_transaction_hash, first_seen_import_run_id, first_seen_at, record_state",
  });
  const existingByHash = new Map(existing.map((row) => [String(row.source_transaction_hash), row]));
  const rows = normalized.map((entry) => {
    const current = existingByHash.get(entry.hash);
    return {
      ...entry.row,
      first_seen_import_run_id: current?.first_seen_import_run_id ?? runId,
      first_seen_at: current?.first_seen_at ?? nowIso,
      record_state: current?.record_state === "rejected" ? "rejected" : entry.row.record_state,
    };
  });

  const { error } = await supabase
    .from("nayax_transaction_staging")
    .upsert(rows, { onConflict: "provider_account_id,source_transaction_hash" });
  if (error) throw new Error(error.message || "Unable to stage Nayax transactions");
  return rows.length;
};

const stagePayload = async (body: Record<string, unknown>) => {
  if (!supabase || !rowHashSalt) throw new Error("Snapcase ingest is not configured");
  assertNoSensitiveFields(body);

  const machines = asRecordArray(body.machines, "machines");
  const orders = asRecordArray(body.orders, "orders");
  const payments = asRecordArray(body.payments, "payments");
  const nayaxTransactions = asRecordArray(body.nayaxTransactions, "nayaxTransactions");
  const totalRows = machines.length + orders.length + payments.length + nayaxTransactions.length;
  if (totalRows > maxRows) throw new Error("Combined Snapcase ingest row count exceeds the limit");

  const kexiazhanAccount = await loadProviderAccount("kexiazhan", body.accountKey);
  const nayaxAccount = nayaxTransactions.length > 0
    ? await loadProviderAccount("nayax", body.nayaxAccountKey)
    : null;
  const dryRun = body.dryRun === true;
  const syncWindowStart = optionalTimestamp(body.windowStart);
  const syncWindowEnd = optionalTimestamp(body.windowEnd);

  if (!dryRun && kexiazhanAccount.contract_status !== "approved") {
    throw new Error("Kexiazhan contract approval is required before staging writes");
  }
  if (!dryRun && nayaxAccount && nayaxAccount.contract_status !== "approved") {
    throw new Error("Nayax contract approval is required before staging writes");
  }
  if (
    !dryRun &&
    (
      !syncWindowStart ||
      !syncWindowEnd ||
      Date.parse(syncWindowEnd) <= Date.parse(syncWindowStart) ||
      Date.parse(syncWindowEnd) - Date.parse(syncWindowStart) > 35 * 24 * 60 * 60 * 1000
    )
  ) {
    throw new Error("Shadow staging requires a valid sync window no longer than 35 days");
  }

  if (dryRun) {
    return jsonResponse({
      ok: true,
      dryRun: true,
      rowsValidated: totalRows,
      machineCount: machines.length,
      orderCount: orders.length,
      paymentCount: payments.length,
      nayaxTransactionCount: nayaxTransactions.length,
      salesPublicationEnabled: false,
    });
  }

  const kexRunId = await startRun(
    "kexiazhan_api",
    machines.length + orders.length + payments.length,
    {
      machine_count: machines.length,
      order_count: orders.length,
      payment_count: payments.length,
    },
  );
  let nayaxRunId: string | null = null;

  try {
    await stageMerchantsAndMachines({ account: kexiazhanAccount, machines });
    const kexScope = await loadApprovedScope(kexiazhanAccount);
    const stagedOrders = await stageOrders({
      account: kexiazhanAccount,
      orders,
      scope: kexScope,
      runId: kexRunId,
    });
    const stagedPayments = await stagePayments({
      account: kexiazhanAccount,
      payments,
      scope: kexScope,
      runId: kexRunId,
    });
    const linkCount = await stagePaymentOrderLinks({
      account: kexiazhanAccount,
      payments: stagedPayments,
      orders: stagedOrders,
    });

    let nayaxCount = 0;
    let reconciliation: unknown = null;
    if (nayaxAccount && nayaxTransactions.length > 0) {
      nayaxRunId = await startRun("nayax_api", nayaxTransactions.length, {
        transaction_count: nayaxTransactions.length,
      });
      const nayaxScope = await loadApprovedScope(nayaxAccount);
      nayaxCount = await stageNayaxTransactions({
        account: nayaxAccount,
        transactions: nayaxTransactions,
        scope: nayaxScope,
        runId: nayaxRunId,
      });

      const paymentTimes = stagedPayments
        .map((payment) => payment.paymentAt)
        .filter((value): value is string => Boolean(value))
        .map((value) => Date.parse(value))
        .filter(Number.isFinite);
      if (paymentTimes.length > 0) {
        const windowStart = new Date(Math.min(...paymentTimes)).toISOString();
        const windowEnd = new Date(Math.max(...paymentTimes) + 1).toISOString();
        const { data, error } = await supabase.rpc(
          "refresh_snapcase_payment_reconciliations",
          {
            p_kexiazhan_provider_account_id: kexiazhanAccount.id,
            p_nayax_provider_account_id: nayaxAccount.id,
            p_window_start: windowStart,
            p_window_end: windowEnd,
          },
        );
        if (error) throw new Error(error.message || "Unable to refresh Snapcase reconciliation");
        reconciliation = data;
      }
      await recordSyncCursors({
        account: nayaxAccount,
        resources: [
          { resource: "nayax_transactions", rowCount: nayaxCount },
        ],
        windowStart: syncWindowStart!,
        windowEnd: syncWindowEnd!,
        runId: nayaxRunId,
      });
      await finishRun({
        runId: nayaxRunId,
        status: "completed",
        imported: nayaxCount,
        skipped: 0,
      });
    }

    await recordSyncCursors({
      account: kexiazhanAccount,
      resources: [
        { resource: "machines", rowCount: machines.length },
        { resource: "orders", rowCount: stagedOrders.length },
        { resource: "payments", rowCount: stagedPayments.length },
      ],
      windowStart: syncWindowStart!,
      windowEnd: syncWindowEnd!,
      runId: kexRunId,
    });
    await finishRun({
      runId: kexRunId,
      status: "completed",
      imported: stagedOrders.length + stagedPayments.length,
      skipped: machines.length,
    });

    return jsonResponse({
      ok: true,
      dryRun: false,
      importRunId: kexRunId,
      machineCount: machines.length,
      orderCount: stagedOrders.length,
      paymentCount: stagedPayments.length,
      paymentOrderLinkCount: linkCount,
      nayaxTransactionCount: nayaxCount,
      reconciliation,
      salesPublicationEnabled: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Snapcase staging failed";
    await finishRun({
      runId: kexRunId,
      status: "failed",
      imported: 0,
      skipped: 0,
      errorMessage: message,
    });
    if (nayaxRunId) {
      await finishRun({
        runId: nayaxRunId,
        status: "failed",
        imported: 0,
        skipped: 0,
        errorMessage: message,
      });
    }
    throw error;
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    if (!await authMatches(req.headers.get("Authorization"))) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.action === "get_sync_scope") return await getSyncScope(body);
    if (body.action === "stage") return await stagePayload(body);
    return jsonResponse({ error: "Unsupported action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Snapcase ingest failed";
    console.error("snapcase-data-ingest error", sanitizeText(message, 500));
    return jsonResponse({ error: message }, 400);
  }
});
