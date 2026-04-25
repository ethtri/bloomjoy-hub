import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const schedulerSecret = Deno.env.get("REPORT_SCHEDULER_SECRET");
const googleRefundsSheetId = Deno.env.get("GOOGLE_REFUNDS_SHEET_ID");
const googleServiceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const encoder = new TextEncoder();

const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false },
      })
    : null;

type RefundAdjustmentInput = Record<string, unknown>;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sanitizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const parseCents = (value: unknown) => {
  const normalized =
    typeof value === "number"
      ? value
      : Number(sanitizeText(value).replace(/[$,]/g, ""));
  if (!Number.isFinite(normalized) || normalized < 0) {
    return 0;
  }
  return Math.round(normalized * 100);
};

const parseCount = (value: unknown) => {
  const normalized = Number(value ?? 0);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return 0;
  }
  return Math.round(normalized);
};

const normalizeAdjustmentType = (value: unknown) => {
  const normalized = sanitizeText(value).toLowerCase();
  return ["refund", "complaint_refund", "manual_adjustment"].includes(normalized)
    ? normalized
    : "refund";
};

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const recordRun = async ({
  status,
  sourceReference,
  rowsSeen = 0,
  rowsImported = 0,
  rowsSkipped = 0,
  errorMessage,
}: {
  status: "running" | "completed" | "failed";
  sourceReference?: string | null;
  rowsSeen?: number;
  rowsImported?: number;
  rowsSkipped?: number;
  errorMessage?: string;
}) => {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("sales_import_runs")
    .insert({
      source: "google_sheets_refunds",
      status,
      source_reference: sourceReference ?? googleRefundsSheetId ?? null,
      rows_seen: rowsSeen,
      rows_imported: rowsImported,
      rows_skipped: rowsSkipped,
      error_message: errorMessage ?? null,
      meta: {
        google_sheet_configured: Boolean(googleRefundsSheetId && googleServiceAccountJson),
      },
      completed_at: status === "running" ? null : new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("refund-adjustment-sync import run insert error", error);
    return null;
  }

  return data?.id ?? null;
};

const resolveMachine = async (row: RefundAdjustmentInput) => {
  if (!supabase) {
    return null;
  }

  const machineId = sanitizeText(row.machine_id ?? row.reporting_machine_id);
  const sunzeMachineId = sanitizeText(row.sunze_machine_id ?? row.machine_sunze_id);

  if (uuidPattern.test(machineId)) {
    const { data } = await supabase
      .from("reporting_machines")
      .select("id, location_id")
      .eq("id", machineId)
      .maybeSingle();
    return data as { id: string; location_id: string } | null;
  }

  if (sunzeMachineId) {
    const { data } = await supabase
      .from("reporting_machines")
      .select("id, location_id")
      .ilike("sunze_machine_id", sunzeMachineId)
      .maybeSingle();
    return data as { id: string; location_id: string } | null;
  }

  return null;
};

const importRows = async (
  rows: RefundAdjustmentInput[],
  sourceReference: string | null
) => {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const runId = await recordRun({
    status: "running",
    sourceReference,
    rowsSeen: rows.length,
  });
  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const adjustmentDate = sanitizeText(row.adjustment_date ?? row.date ?? row.refund_date);
    const amountCents = parseCents(
      row.refund_amount_usd ?? row.amount_usd ?? row.refund_amount ?? row.amount
    );
    const machine = await resolveMachine(row);

    if (!datePattern.test(adjustmentDate) || !machine || amountCents <= 0) {
      skipped += 1;
      continue;
    }

    const sourceRowHash = await sha256Hex(JSON.stringify(row));
    const { error } = await supabase.from("sales_adjustment_facts").upsert(
      {
        reporting_machine_id: machine.id,
        reporting_location_id: machine.location_id,
        adjustment_date: adjustmentDate,
        adjustment_type: normalizeAdjustmentType(row.adjustment_type ?? row.type),
        amount_cents: amountCents,
        complaint_count: parseCount(row.complaint_count ?? row.complaints),
        source: "google_sheets",
        source_row_hash: sourceRowHash,
        import_run_id: runId,
        notes: sanitizeText(row.notes ?? row.reason) || null,
        raw_payload: row,
      },
      { onConflict: "source,source_row_hash" }
    );

    if (error) {
      skipped += 1;
      console.error("refund-adjustment-sync row skipped", error);
    } else {
      imported += 1;
    }
  }

  if (runId) {
    await supabase
      .from("sales_import_runs")
      .update({
        status: "completed",
        rows_seen: rows.length,
        rows_imported: imported,
        rows_skipped: skipped,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
  }

  return { runId, imported, skipped };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    if (!schedulerSecret) {
      return jsonResponse({ error: "REPORT_SCHEDULER_SECRET is not configured." }, 500);
    }

    if (req.headers.get("Authorization") !== `Bearer ${schedulerSecret}`) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    if (!supabase) {
      return jsonResponse({ error: "Refund adjustment sync is not configured." }, 500);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const rows = Array.isArray(body.rows) ? (body.rows as RefundAdjustmentInput[]) : [];
    const sourceReference = sanitizeText(body.sourceReference) || googleRefundsSheetId || null;

    if (rows.length === 0) {
      const runId = await recordRun({
        status: "failed",
        sourceReference,
        errorMessage:
          googleRefundsSheetId && googleServiceAccountJson
            ? "Google Sheets fetch is not implemented in this foundation slice."
            : "Google Sheets service account settings are not configured.",
      });
      return jsonResponse({
        status: "not_configured",
        runId,
        message:
          "Send rows in the request body for now. Dedicated Sheets API ingestion is a follow-up after the sheet contract is confirmed.",
      });
    }

    const result = await importRows(rows, sourceReference);

    return jsonResponse({
      status: "completed",
      ...result,
    });
  } catch (error) {
    console.error("refund-adjustment-sync error", error);
    return jsonResponse(
      {
        error:
          error instanceof Error && error.message
            ? error.message
            : "Unable to sync refund adjustments.",
      },
      500
    );
  }
});
