import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ingestToken = Deno.env.get("REPORTING_INGEST_TOKEN");
const rowHashSalt = Deno.env.get("REPORTING_ROW_HASH_SALT");
const maxRowsPerRun = Number(Deno.env.get("SUNZE_INGEST_MAX_ROWS") ?? "20000");
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
  source_order_hash: string;
  source_trade_name: string | null;
  item_quantity: number;
  tax_cents: number;
  source_payment_status: string;
  payment_time: string;
  source: "sunze_browser";
  source_row_hash: string;
  import_run_id: string;
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
  }
) => {
  if (!supabase) return;

  await supabase
    .from("sales_import_runs")
    .update({
      status: values.status,
      rows_imported: values.rowsImported ?? 0,
      rows_skipped: values.rowsSkipped ?? 0,
      error_message: values.errorMessage ?? null,
      completed_at: new Date().toISOString(),
    })
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

const normalizePayloadRows = async (
  rows: SunzeIngestRow[],
  importRunId: string
): Promise<SalesFact[]> => {
  if (!rowHashSalt) {
    throw new Error("REPORTING_ROW_HASH_SALT is not configured.");
  }

  if (rows.length > maxRowsPerRun) {
    throw new Error(`Sunze ingest row count exceeds limit ${maxRowsPerRun}.`);
  }

  const machineBySunzeId = await loadMachineMap();
  const facts: SalesFact[] = [];

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 1;
    const sourceOrderNumber = requiredText(row.sourceOrderNumber, `rows[${rowNumber}].sourceOrderNumber`);
    const tradeName = sanitizeText(row.tradeName, 500);
    const machineCode = requiredText(row.machineCode, `rows[${rowNumber}].machineCode`);
    const machine = machineBySunzeId.get(machineCode.toLowerCase());
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

    if (!machine) {
      throw new Error(`Unknown Sunze machine code at row ${rowNumber}. Configure the machine first.`);
    }

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
        machineCode,
        paymentTimeIso,
        orderAmountCents,
        paymentMethod,
        sourceStatus,
      ].join(":")
    );

    facts.push({
      reporting_machine_id: machine.id,
      reporting_location_id: machine.location_id,
      sale_date: saleDate,
      payment_method: paymentMethod,
      net_sales_cents: orderAmountCents,
      transaction_count: 1,
      source_order_hash: sourceOrderHash,
      source_trade_name: tradeName || null,
      item_quantity: itemQuantity,
      tax_cents: taxCents,
      source_payment_status: sourceStatus,
      payment_time: paymentTimeIso,
      source: "sunze_browser",
      source_row_hash: sourceRowHash,
      import_run_id: importRunId,
      raw_payload: {
        source_order_hash: sourceOrderHash,
        trade_name: tradeName || null,
        item_quantity: itemQuantity,
        machine_code: machineCode,
        machine_name: sanitizeText(row.machineName, 200),
        payment_method_source: sourcePaymentMethod,
        payment_time_iso: paymentTimeIso,
        status_source: sourceStatus,
        order_amount_cents: orderAmountCents,
        tax_cents: taxCents,
      },
    });
  }

  return facts;
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

    if (!supabase || !ingestToken || !rowHashSalt) {
      return jsonResponse({ error: "Sunze ingest is not configured." }, 500);
    }

    if (!authHeaderMatches(req)) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const rows = Array.isArray(body.rows) ? (body.rows as SunzeIngestRow[]) : [];
    const sourceReference =
      sanitizeText(body.sourceReference, 500) || `sunze-orders:${new Date().toISOString()}`;

    importRunId = await recordRun({
      sourceReference,
      rowsSeen: rows.length,
      meta: {
        ingest: "sunze-sales-ingest",
        date_preset: sanitizeText(body.datePreset, 100) || null,
        window_start: sanitizeText(body.windowStart, 40) || null,
        window_end: sanitizeText(body.windowEnd, 40) || null,
        generated_at: sanitizeText(body.generatedAt, 80) || null,
        worker: (body.meta as Record<string, unknown> | undefined)?.worker ?? null,
        github_run_id: (body.meta as Record<string, unknown> | undefined)?.githubRunId ?? null,
      },
    });

    const facts = await normalizePayloadRows(rows, importRunId);

    if (facts.length > 0) {
      const { data, error } = await supabase
        .from("machine_sales_facts")
        .upsert(facts, { onConflict: "source,source_row_hash" })
        .select("id");

      if (error) {
        throw new Error(error.message || "Unable to upsert Sunze sales facts.");
      }

      await finishRun(importRunId, {
        status: "completed",
        rowsImported: data?.length ?? facts.length,
        rowsSkipped: 0,
      });

      return jsonResponse({
        importRunId,
        rowsSeen: rows.length,
        rowsImported: data?.length ?? facts.length,
        rowsSkipped: 0,
      });
    }

    await finishRun(importRunId, {
      status: "completed",
      rowsImported: 0,
      rowsSkipped: 0,
    });

    return jsonResponse({
      importRunId,
      rowsSeen: rows.length,
      rowsImported: 0,
      rowsSkipped: 0,
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
    }

    console.error("sunze-sales-ingest error", message);
    return jsonResponse({ error: message }, 400);
  }
});
