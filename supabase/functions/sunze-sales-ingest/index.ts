import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendInternalEmail } from "../_shared/internal-email.ts";
import { sendWeComAlertResult } from "../_shared/wecom-alert.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ingestToken = Deno.env.get("REPORTING_INGEST_TOKEN");
const rowHashSalt = Deno.env.get("REPORTING_ROW_HASH_SALT");
const maxRowsPerRun = Number(Deno.env.get("SUNZE_INGEST_MAX_ROWS") ?? "20000");
const staleHoursConfig = Number(Deno.env.get("SUNZE_SYNC_STALE_HOURS") ?? "30");
const staleHoursDefault = Number.isFinite(staleHoursConfig) && staleHoursConfig > 0 ? staleHoursConfig : 30;
const validPaymentMethods = new Set(["cash", "credit", "other", "unknown"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false },
      })
    : null;

type SunzeIngestRow = {
  sourceOrderNumber?: unknown;
  tradeName?: unknown;
  itemQuantity?: unknown;
  machineCode?: unknown;
  machineName?: unknown;
  orderAmountCents?: unknown;
  taxCents?: unknown;
  paymentMethod?: unknown;
  sourcePaymentMethod?: unknown;
  paymentTimeIso?: unknown;
  saleDate?: unknown;
  sourceStatus?: unknown;
};

type ReportingMachine = {
  id: string;
  location_id: string;
  sunze_machine_id: string | null;
};

type SalesFact = {
  reporting_machine_id: string;
  reporting_location_id: string;
  sale_date: string;
  payment_method: string;
  net_sales_cents: number;
  transaction_count: number;
  source_trade_name: string | null;
  item_quantity: number;
  tax_cents: number;
  source_payment_status: string;
  payment_time: string;
  source: "sunze_browser";
  source_order_hash: string;
  source_row_hash: string;
  import_run_id: string;
  raw_payload: Record<string, unknown>;
};

type SunzeMachineDiscovery = {
  sunze_machine_id: string;
  sunze_machine_name: string | null;
  status: "pending" | "mapped" | "ignored";
  reporting_machine_id: string | null;
};

type SunzeUnmappedSale = {
  sunze_machine_id: string;
  sunze_machine_name: string | null;
  source_order_hash: string;
  source_row_hash: string;
  sale_date: string;
  payment_method: string;
  net_sales_cents: number;
  transaction_count: number;
  status: "pending" | "ignored";
  import_run_id: string | null;
  raw_payload: Record<string, unknown>;
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sanitizeText = (value: unknown, maxLength = 500) =>
  String(value ?? "")
    .trim()
    .slice(0, maxLength);

const sanitizeCodeArray = (value: unknown) =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .map((entry) => sanitizeText(entry, 100))
            .filter((entry) => /^[A-Za-z0-9][A-Za-z0-9._-]{1,99}$/.test(entry))
        ),
      ].sort()
    : [];

const safeInteger = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) ? numberValue : null;
};

const positiveNumber = (value: unknown, fallback: number) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback;
};

const requiredText = (value: unknown, fieldName: string) => {
  const text = sanitizeText(value);
  if (!text) {
    throw new Error(`${fieldName} is required.`);
  }
  return text;
};

const nonNegativeInteger = (value: unknown, fieldName: string) => {
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }
  return numberValue;
};

const sha256 = async (value: string) => {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const authHeaderMatches = (req: Request) =>
  Boolean(ingestToken) && req.headers.get("Authorization") === `Bearer ${ingestToken}`;

const getBodyMeta = (body: Record<string, unknown>) =>
  typeof body.meta === "object" && body.meta !== null
    ? (body.meta as Record<string, unknown>)
    : {};

const sendReportingAlert = async ({
  title,
  lines,
}: {
  title: string;
  lines: string[];
}) => {
  const cleanLines = lines.map((line) => sanitizeText(line, 500)).filter(Boolean);

  const [wecomResult, emailResult] = await Promise.allSettled([
    sendWeComAlertResult({
      title,
      lines: cleanLines,
      tag: "SUNZE",
    }),
    sendInternalEmail({
      subject: `[Sunze Sales Sync] ${title}`,
      text: [title, ...cleanLines].join("\n"),
    }),
  ]);

  if (wecomResult.status === "rejected") {
    console.warn("Sunze sync WeCom alert failed.", wecomResult.reason);
  }

  if (emailResult.status === "rejected") {
    console.warn("Sunze sync email alert failed.", emailResult.reason);
  }
};

const recordRun = async ({
  sourceReference,
  rowsSeen,
  meta,
}: {
  sourceReference: string;
  rowsSeen: number;
  meta: Record<string, unknown>;
}) => {
  if (!supabase) {
    throw new Error("Supabase service client is not configured.");
  }

  const { data, error } = await supabase
    .from("sales_import_runs")
    .insert({
      source: "sunze_browser",
      status: "running",
      source_reference: sourceReference,
      rows_seen: rowsSeen,
      meta,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message || "Unable to create Sunze import run.");
  }

  return data.id as string;
};

const finishRun = async (
  importRunId: string,
  values: {
    status: "completed" | "failed";
    rowsImported?: number;
    rowsSkipped?: number;
    errorMessage?: string;
    meta?: Record<string, unknown>;
  }
) => {
  if (!supabase) return;

  const updateValues: Record<string, unknown> = {
    status: values.status,
    rows_imported: values.rowsImported ?? 0,
    rows_skipped: values.rowsSkipped ?? 0,
    error_message: values.errorMessage ?? null,
    completed_at: new Date().toISOString(),
  };

  if (values.meta) {
    updateValues.meta = values.meta;
  }

  await supabase
    .from("sales_import_runs")
    .update(updateValues)
    .eq("id", importRunId);
};

const loadMachineMap = async () => {
  if (!supabase) {
    throw new Error("Supabase service client is not configured.");
  }

  const { data, error } = await supabase
    .from("reporting_machines")
    .select("id, location_id, sunze_machine_id")
    .not("sunze_machine_id", "is", null);

  if (error) {
    throw new Error(error.message || "Unable to load reporting machines.");
  }

  return new Map(
    ((data ?? []) as ReportingMachine[])
      .filter((machine) => machine.sunze_machine_id)
      .map((machine) => [String(machine.sunze_machine_id).toLowerCase(), machine])
  );
};

const uniqueCodes = (values: unknown[]) =>
  [
    ...new Set(
      values
        .map((value) => sanitizeText(value, 100))
        .filter((value) => /^[A-Za-z0-9][A-Za-z0-9._-]{1,99}$/.test(value))
    ),
  ].sort();

const summarizeMachineCoverage = ({
  meta,
  machineBySunzeId,
  rowMachineCodes,
}: {
  meta: Record<string, unknown>;
  machineBySunzeId: Map<string, ReportingMachine>;
  rowMachineCodes: string[];
}) => {
  const visibleCodes = sanitizeCodeArray(meta.visibleSunzeMachineCodes);
  const expectedCount = safeInteger(meta.expectedVisibleMachineCount);
  const coverageRequired = meta.machineCoverageRequired !== false;

  if (coverageRequired && visibleCodes.length === 0) {
    throw new Error("Sunze machine coverage verification is required but no machine codes were provided.");
  }

  const unmappedVisibleCodes = visibleCodes.filter(
    (code) => !machineBySunzeId.has(code.toLowerCase())
  );
  const unmappedRowMachineCodes = rowMachineCodes.filter(
    (code) => !machineBySunzeId.has(code.toLowerCase())
  );

  return {
    visibleMachineCount: visibleCodes.length,
    configuredMachineCount: machineBySunzeId.size,
    expectedVisibleMachineCount: expectedCount,
    visibleMachineCountMismatch:
      expectedCount !== null && (coverageRequired || visibleCodes.length > 0)
        ? visibleCodes.length !== expectedCount
        : false,
    unmappedVisibleMachineCount: unmappedVisibleCodes.length,
    unmappedRowMachineCount: unmappedRowMachineCodes.length,
    discoveredMachineCodes: uniqueCodes([...visibleCodes, ...rowMachineCodes]),
  };
};

const buildMachineNameMap = (rows: SunzeIngestRow[]) => {
  const namesByCode = new Map<string, string>();

  for (const row of rows) {
    const machineCode = sanitizeText(row.machineCode, 100);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,99}$/.test(machineCode)) continue;

    const machineName = sanitizeText(row.machineName, 200);
    if (machineName) {
      namesByCode.set(machineCode.toLowerCase(), machineName);
    }
  }

  return namesByCode;
};

const upsertSunzeMachineDiscoveries = async ({
  machineCodes,
  machineNamesByCode,
  machineBySunzeId,
  importRunId,
  write,
}: {
  machineCodes: string[];
  machineNamesByCode: Map<string, string>;
  machineBySunzeId: Map<string, ReportingMachine>;
  importRunId: string | null;
  write: boolean;
}) => {
  if (!supabase || machineCodes.length === 0) {
    return {
      discoveriesByCode: new Map<string, SunzeMachineDiscovery>(),
      pendingMachineCount: 0,
      ignoredMachineCount: 0,
      newlyPendingMachineCount: 0,
    };
  }

  const { data: existingData, error: existingError } = await supabase
    .from("sunze_machine_discoveries")
    .select("sunze_machine_id, sunze_machine_name, status, reporting_machine_id")
    .in("sunze_machine_id", machineCodes);

  if (existingError) {
    throw new Error(existingError.message || "Unable to load Sunze machine discovery state.");
  }

  const existingByCode = new Map(
    ((existingData ?? []) as SunzeMachineDiscovery[]).map((discovery) => [
      discovery.sunze_machine_id.toLowerCase(),
      discovery,
    ])
  );

  let newlyPendingMachineCount = 0;
  const nowIso = new Date().toISOString();
  const records = machineCodes.map((machineCode) => {
    const normalizedCode = machineCode.toLowerCase();
    const mappedMachine = machineBySunzeId.get(normalizedCode);
    const existingDiscovery = existingByCode.get(normalizedCode);
    const hasMapping = Boolean(mappedMachine);
    const status = hasMapping
      ? "mapped"
      : existingDiscovery?.status === "ignored"
        ? "ignored"
        : "pending";

    if (!hasMapping && status === "pending" && existingDiscovery?.status !== "pending") {
      newlyPendingMachineCount += 1;
    }

    return {
      sunze_machine_id: machineCode,
      sunze_machine_name:
        machineNamesByCode.get(normalizedCode) ?? existingDiscovery?.sunze_machine_name ?? null,
      status,
      reporting_machine_id: mappedMachine?.id ?? null,
      last_seen_import_run_id: importRunId,
      last_seen_at: nowIso,
      mapped_at: hasMapping ? nowIso : existingDiscovery?.status === "mapped" ? nowIso : null,
      ignored_at: status === "ignored" ? undefined : null,
      ignored_by: status === "ignored" ? undefined : null,
      ignore_reason: status === "ignored" ? undefined : null,
    };
  });

  if (!write) {
    const discoveries = records.map((record) => ({
      sunze_machine_id: record.sunze_machine_id,
      sunze_machine_name: record.sunze_machine_name,
      status: record.status,
      reporting_machine_id: record.reporting_machine_id,
    })) as SunzeMachineDiscovery[];
    const discoveriesByCode = new Map(
      discoveries.map((discovery) => [discovery.sunze_machine_id.toLowerCase(), discovery])
    );

    return {
      discoveriesByCode,
      pendingMachineCount: discoveries.filter((discovery) => discovery.status === "pending").length,
      ignoredMachineCount: discoveries.filter((discovery) => discovery.status === "ignored").length,
      newlyPendingMachineCount,
    };
  }

  const { data, error } = await supabase
    .from("sunze_machine_discoveries")
    .upsert(records, { onConflict: "sunze_machine_id" })
    .select("sunze_machine_id, sunze_machine_name, status, reporting_machine_id");

  if (error) {
    throw new Error(error.message || "Unable to update Sunze machine discovery queue.");
  }

  const discoveries = (data ?? []) as SunzeMachineDiscovery[];
  const discoveriesByCode = new Map(
    discoveries.map((discovery) => [discovery.sunze_machine_id.toLowerCase(), discovery])
  );

  return {
    discoveriesByCode,
    pendingMachineCount: discoveries.filter((discovery) => discovery.status === "pending").length,
    ignoredMachineCount: discoveries.filter((discovery) => discovery.status === "ignored").length,
    newlyPendingMachineCount,
  };
};

const normalizePayloadRows = async (
  rows: SunzeIngestRow[],
  importRunId: string,
  machineBySunzeId: Map<string, ReportingMachine>,
  discoveriesByCode: Map<string, SunzeMachineDiscovery>
): Promise<{ facts: SalesFact[]; unmappedSales: SunzeUnmappedSale[] }> => {
  if (!rowHashSalt) {
    throw new Error("REPORTING_ROW_HASH_SALT is not configured.");
  }

  if (rows.length > maxRowsPerRun) {
    throw new Error(`Sunze ingest row count exceeds limit ${maxRowsPerRun}.`);
  }

  const facts: SalesFact[] = [];
  const unmappedSales: SunzeUnmappedSale[] = [];

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 1;
    const sourceOrderNumber = requiredText(row.sourceOrderNumber, `rows[${rowNumber}].sourceOrderNumber`);
    const tradeName = sanitizeText(row.tradeName, 500);
    const machineCode = requiredText(row.machineCode, `rows[${rowNumber}].machineCode`);
    const machine = machineBySunzeId.get(machineCode.toLowerCase());
    const discovery = discoveriesByCode.get(machineCode.toLowerCase());
    const saleDate = requiredText(row.saleDate, `rows[${rowNumber}].saleDate`);
    const paymentTimeIso = requiredText(row.paymentTimeIso, `rows[${rowNumber}].paymentTimeIso`);
    const paymentMethod = requiredText(row.paymentMethod, `rows[${rowNumber}].paymentMethod`).toLowerCase();
    const sourceStatus = requiredText(row.sourceStatus, `rows[${rowNumber}].sourceStatus`);
    const sourcePaymentMethod = sanitizeText(row.sourcePaymentMethod, 100);
    const orderAmountCents = nonNegativeInteger(
      row.orderAmountCents,
      `rows[${rowNumber}].orderAmountCents`
    );
    const taxCents = nonNegativeInteger(row.taxCents ?? 0, `rows[${rowNumber}].taxCents`);
    const itemQuantity = nonNegativeInteger(row.itemQuantity ?? 1, `rows[${rowNumber}].itemQuantity`);

    if (!datePattern.test(saleDate)) {
      throw new Error(`Invalid sale date at row ${rowNumber}.`);
    }

    if (!Number.isFinite(Date.parse(paymentTimeIso))) {
      throw new Error(`Invalid payment timestamp at row ${rowNumber}.`);
    }

    if (!validPaymentMethods.has(paymentMethod)) {
      throw new Error(`Invalid payment method at row ${rowNumber}.`);
    }

    if (sourceStatus.toLowerCase() !== "payment success") {
      throw new Error(`Unsupported Sunze order status at row ${rowNumber}: ${sourceStatus}`);
    }

    const sourceOrderHash = await sha256(`${rowHashSalt}:order:${sourceOrderNumber}`);
    const sourceRowHash = await sha256(
      [
        rowHashSalt,
        "sunze_order",
        sourceOrderNumber,
        tradeName,
        itemQuantity,
        machineCode,
        paymentTimeIso,
        orderAmountCents,
        taxCents,
        paymentMethod,
        sourceStatus,
      ].join(":")
    );

    const rawPayload = {
      source_order_hash: sourceOrderHash,
      source_row_hash: sourceRowHash,
      trade_name: tradeName || null,
      item_quantity: itemQuantity,
      machine_code: machineCode,
      machine_name: sanitizeText(row.machineName, 200),
      payment_method_source: sourcePaymentMethod,
      payment_time_iso: paymentTimeIso,
      status_source: sourceStatus,
      order_amount_cents: orderAmountCents,
      tax_cents: taxCents,
    };

    if (!machine) {
      unmappedSales.push({
        sunze_machine_id: machineCode,
        sunze_machine_name: sanitizeText(row.machineName, 200) || null,
        source_order_hash: sourceOrderHash,
        source_row_hash: sourceRowHash,
        sale_date: saleDate,
        payment_method: paymentMethod,
        net_sales_cents: orderAmountCents,
        transaction_count: 1,
        status: discovery?.status === "ignored" ? "ignored" : "pending",
        import_run_id: importRunId,
        raw_payload: rawPayload,
      });
      continue;
    }

    facts.push({
      reporting_machine_id: machine.id,
      reporting_location_id: machine.location_id,
      sale_date: saleDate,
      payment_method: paymentMethod,
      net_sales_cents: orderAmountCents,
      transaction_count: 1,
      source_trade_name: tradeName || null,
      item_quantity: itemQuantity,
      tax_cents: taxCents,
      source_payment_status: sourceStatus,
      payment_time: paymentTimeIso,
      source: "sunze_browser",
      source_order_hash: sourceOrderHash,
      source_row_hash: sourceRowHash,
      import_run_id: importRunId,
      raw_payload: rawPayload,
    });
  }

  return { facts, unmappedSales };
};

const upsertSunzeFacts = async (facts: SalesFact[]) => {
  if (!supabase) {
    throw new Error("Supabase service client is not configured.");
  }

  const { data, error } = await supabase.rpc("upsert_sunze_sales_facts", {
    p_facts: facts,
  });

  if (error) {
    throw new Error(error.message || "Unable to upsert Sunze sales facts.");
  }

  return Array.isArray(data) ? data : [];
};

const upsertSunzeUnmappedSales = async (sales: SunzeUnmappedSale[]) => {
  if (!supabase || sales.length === 0) return [];

  const { data, error } = await supabase
    .from("sunze_unmapped_sales")
    .upsert(
      sales.map((sale) => ({
        ...sale,
        last_seen_at: new Date().toISOString(),
      })),
      { onConflict: "source_order_hash" }
    )
    .select("id");

  if (error) {
    throw new Error(error.message || "Unable to queue unmapped Sunze sales.");
  }

  return Array.isArray(data) ? data : [];
};

const latestCompletedSunzeRun = async () => {
  if (!supabase) {
    throw new Error("Supabase service client is not configured.");
  }

  const { data, error } = await supabase
    .from("sales_import_runs")
    .select("id, status, rows_seen, rows_imported, completed_at, created_at, meta")
    .eq("source", "sunze_browser")
    .eq("status", "completed")
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to load latest Sunze import run.");
  }

  return data;
};

const recordHealthFailure = async ({
  sourceReference,
  errorMessage,
  meta,
}: {
  sourceReference: string;
  errorMessage: string;
  meta: Record<string, unknown>;
}) => {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("sales_import_runs")
    .insert({
      source: "sunze_browser",
      status: "failed",
      source_reference: sourceReference,
      rows_seen: 0,
      rows_imported: 0,
      rows_skipped: 0,
      error_message: errorMessage,
      meta,
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("Sunze health failure run insert failed.", error);
    return null;
  }

  return data?.id ?? null;
};

const handleHealthCheck = async (body: Record<string, unknown>) => {
  const meta = getBodyMeta(body);
  const event = sanitizeText(body.event, 80) || "freshness_check";
  const staleHours = positiveNumber(body.staleHours, staleHoursDefault);
  const latestRun = await latestCompletedSunzeRun();
  const latestCompletedAt = sanitizeText(latestRun?.completed_at, 80) || null;
  const staleCutoffMs = Date.now() - staleHours * 60 * 60 * 1000;
  const latestCompletedMs = latestCompletedAt ? Date.parse(latestCompletedAt) : Number.NaN;
  const isStale = !Number.isFinite(latestCompletedMs) || latestCompletedMs < staleCutoffMs;
  const isFailureEvent = event === "failure";
  const githubRunId = sanitizeText(meta.githubRunId, 80) || null;
  const githubRunUrl = sanitizeText(meta.githubRunUrl, 300) || null;

  let healthRunId: string | null = null;

  if (isFailureEvent || isStale) {
    const errorMessage = isFailureEvent
      ? sanitizeText(body.message, 500) || "Sunze GitHub Actions workflow reported a failure."
      : `No successful Sunze import completed within ${staleHours} hours.`;

    healthRunId = await recordHealthFailure({
      sourceReference: `sunze-health:${event}:${githubRunId ?? new Date().toISOString()}`,
      errorMessage,
      meta: {
        health_check: true,
        event,
        stale_hours: staleHours,
        latest_completed_at: latestCompletedAt,
        github_run_id: githubRunId,
        github_run_url: githubRunUrl,
      },
    });

    await sendReportingAlert({
      title: isFailureEvent ? "Sunze sales sync failed" : "Sunze sales data is stale",
      lines: [
        errorMessage,
        latestCompletedAt ? `Latest completed import: ${latestCompletedAt}` : "No completed Sunze import found.",
        githubRunUrl ? `GitHub run: ${githubRunUrl}` : "",
        healthRunId ? `Health run id: ${healthRunId}` : "",
      ],
    });
  }

  return jsonResponse({
    ok: true,
    event,
    stale: isStale,
    latestCompletedAt,
    healthRunId,
  });
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let importRunId: string | null = null;

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    if (!supabase || !ingestToken) {
      return jsonResponse({ error: "Sunze ingest is not configured." }, 500);
    }

    if (!authHeaderMatches(req)) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.action === "sync_health_check") {
      return await handleHealthCheck(body);
    }

    if (!rowHashSalt) {
      return jsonResponse({ error: "REPORTING_ROW_HASH_SALT is not configured." }, 500);
    }

    const rows = Array.isArray(body.rows) ? (body.rows as SunzeIngestRow[]) : [];
    const sourceReference =
      sanitizeText(body.sourceReference, 500) || `sunze-orders:${new Date().toISOString()}`;
    const bodyMeta = getBodyMeta(body);
    const dryRun = body.dryRun === true;
    const runMeta = {
      ingest: "sunze-sales-ingest",
      dry_run: dryRun,
      date_preset: sanitizeText(body.datePreset, 100) || null,
      window_start: sanitizeText(body.windowStart, 40) || null,
      window_end: sanitizeText(body.windowEnd, 40) || null,
      selected_window_start: sanitizeText(bodyMeta.selectedWindowStart, 40) || null,
      selected_window_end: sanitizeText(bodyMeta.selectedWindowEnd, 40) || null,
      selected_window_source: sanitizeText(bodyMeta.selectedWindowSource, 80) || null,
      selected_preset: sanitizeText(bodyMeta.selectedPreset, 100) || null,
      reporting_timezone: sanitizeText(bodyMeta.reportingTimezone, 100) || null,
      ui_record_count: safeInteger(bodyMeta.uiRecordCount),
      ui_revenue_cents: safeInteger(bodyMeta.uiRevenueCents),
      parsed_row_count: safeInteger(bodyMeta.parsedRowCount),
      parsed_machine_count: safeInteger(bodyMeta.parsedMachineCount),
      parsed_order_amount_cents: safeInteger(bodyMeta.parsedOrderAmountCents),
      visible_sunze_machine_count: safeInteger(bodyMeta.visibleSunzeMachineCount),
      expected_visible_machine_count: safeInteger(bodyMeta.expectedVisibleMachineCount),
      machine_coverage_required: bodyMeta.machineCoverageRequired !== false,
      generated_at: sanitizeText(body.generatedAt, 80) || null,
      worker: bodyMeta.worker ?? null,
      github_run_id: bodyMeta.githubRunId ?? null,
      github_run_attempt: bodyMeta.githubRunAttempt ?? null,
    };

    if (!dryRun) {
      importRunId = await recordRun({
        sourceReference,
        rowsSeen: rows.length,
        meta: runMeta,
      });
    }

    const machineBySunzeId = await loadMachineMap();
    const rowMachineCodes = uniqueCodes(rows.map((row) => row.machineCode));
    const machineCoverage = summarizeMachineCoverage({
      meta: bodyMeta,
      machineBySunzeId,
      rowMachineCodes,
    });
    const discoveryState = await upsertSunzeMachineDiscoveries({
      machineCodes: machineCoverage.discoveredMachineCodes,
      machineNamesByCode: buildMachineNameMap(rows),
      machineBySunzeId,
      importRunId,
      write: !dryRun,
    });
    const validationImportRunId = importRunId ?? crypto.randomUUID();
    const normalized = await normalizePayloadRows(
      rows,
      validationImportRunId,
      machineBySunzeId,
      discoveryState.discoveriesByCode
    );
    const pendingUnmappedRows = normalized.unmappedSales.filter((sale) => sale.status === "pending");
    const ignoredUnmappedRows = normalized.unmappedSales.filter((sale) => sale.status === "ignored");
    const finalRunMeta = {
      ...runMeta,
      visible_sunze_machine_count: machineCoverage.visibleMachineCount,
      expected_visible_machine_count: machineCoverage.expectedVisibleMachineCount,
      visible_machine_count_mismatch: machineCoverage.visibleMachineCountMismatch,
      configured_sunze_machine_count: machineCoverage.configuredMachineCount,
      unmapped_visible_machine_count: machineCoverage.unmappedVisibleMachineCount,
      unmapped_row_machine_count: machineCoverage.unmappedRowMachineCount,
      pending_unmapped_machine_count: discoveryState.pendingMachineCount,
      ignored_unmapped_machine_count: discoveryState.ignoredMachineCount,
      newly_pending_unmapped_machine_count: discoveryState.newlyPendingMachineCount,
      mapped_row_count: normalized.facts.length,
      pending_unmapped_row_count: pendingUnmappedRows.length,
      ignored_unmapped_row_count: ignoredUnmappedRows.length,
    };

    if (dryRun) {
      return jsonResponse({
        ok: true,
        dryRun: true,
        rowsSeen: rows.length,
        rowsValidated: normalized.facts.length,
        rowsQuarantined: pendingUnmappedRows.length,
        rowsIgnored: ignoredUnmappedRows.length,
        visibleMachineCount: machineCoverage.visibleMachineCount,
        configuredMachineCount: machineCoverage.configuredMachineCount,
        pendingUnmappedMachineCount: discoveryState.pendingMachineCount,
        ignoredUnmappedMachineCount: discoveryState.ignoredMachineCount,
        newlyPendingUnmappedMachineCount: discoveryState.newlyPendingMachineCount,
      });
    }

    if (!importRunId) {
      throw new Error("Sunze import run was not created.");
    }

    const [factRows, queuedRows] = await Promise.all([
      normalized.facts.length > 0 ? upsertSunzeFacts(normalized.facts) : Promise.resolve([]),
      upsertSunzeUnmappedSales(normalized.unmappedSales),
    ]);

    await finishRun(importRunId, {
      status: "completed",
      rowsImported: factRows?.length ?? normalized.facts.length,
      rowsSkipped: normalized.unmappedSales.length,
      meta: finalRunMeta,
    });

    if (discoveryState.newlyPendingMachineCount > 0) {
      await sendReportingAlert({
        title: "Sunze machines need reporting mapping",
        lines: [
          `${discoveryState.newlyPendingMachineCount} new Sunze machine(s) need admin mapping.`,
          "Open /admin/reporting and review the Sunze mapping queue.",
        ],
      });
    }

    return jsonResponse({
      importRunId,
      rowsSeen: rows.length,
      rowsImported: factRows?.length ?? normalized.facts.length,
      rowsSkipped: normalized.unmappedSales.length,
      rowsQuarantined: pendingUnmappedRows.length,
      rowsIgnored: ignoredUnmappedRows.length,
      unmappedRowsQueued: queuedRows?.length ?? normalized.unmappedSales.length,
      pendingUnmappedMachineCount: discoveryState.pendingMachineCount,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : "Unable to ingest Sunze sales.";

    if (importRunId) {
      await finishRun(importRunId, {
        status: "failed",
        rowsImported: 0,
        rowsSkipped: 0,
        errorMessage: message,
      });

      await sendReportingAlert({
        title: "Sunze sales ingest failed",
        lines: [`Import run id: ${importRunId}`, message],
      });
    }

    console.error("sunze-sales-ingest error", message);
    return jsonResponse({ error: message }, 400);
  }
});
