import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const schedulerSecret = Deno.env.get("REPORT_SCHEDULER_SECRET");
const googleRefundsSheetId = Deno.env.get("GOOGLE_REFUNDS_SHEET_ID");
const googleServiceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
const encoder = new TextEncoder();

const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    })
    : null;

type RefundAdjustmentRow = Record<string, unknown>;

type RefundInput = {
  sourceRowReference: string;
  sourceLocation: string;
  normalizedLocation: string;
  refundDate: string;
  originalOrderDate: string;
  amountCents: number;
  reason: string;
  sourceStatus: string;
  normalizedSourceStatus: string;
  adjustmentType: "refund" | "complaint_refund" | "manual_adjustment";
  complaintCount: number;
};

type MachineProfile = {
  id: string;
  locationId: string;
  machineLabel: string;
  labels: Array<{ kind: string; normalized: string }>;
};

const autoApplyStatuses = new Set([
  "approved",
  "complete",
  "completed",
  "closed",
  "processed",
  "refund approved",
  "refund complete",
  "refund completed",
  "refund issued",
  "refund processed",
  "refunded",
  "resolved",
  "settled",
]);

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sanitizeText = (value: unknown) => typeof value === "string" ? value.trim() : "";

const normalizeMatchText = (value: unknown) =>
  String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeStatus = (value: unknown) =>
  sanitizeText(value).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

const normalizeDate = (value: unknown) => {
  const text = sanitizeText(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

const pickText = (row: RefundAdjustmentRow, keys: string[]) => {
  for (const key of keys) {
    const value = sanitizeText(row[key]);
    if (value) return value;
  }
  return "";
};

const pickNumberValue = (row: RefundAdjustmentRow, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
};

const parseCents = (row: RefundAdjustmentRow) => {
  const centsValue = pickNumberValue(row, ["amount_cents", "refund_amount_cents"]);
  const cents = Number(String(centsValue).replace(/[$,]/g, ""));
  if (Number.isFinite(cents) && cents >= 0 && String(centsValue).trim() !== "") {
    return Math.round(cents);
  }

  const usdValue = pickNumberValue(row, [
    "amount_usd",
    "refund_amount_usd",
    "amount",
    "refund_amount",
    "refund",
  ]);
  const usd = Number(String(usdValue).replace(/[$,]/g, ""));
  if (Number.isFinite(usd) && usd >= 0 && String(usdValue).trim() !== "") {
    return Math.round(usd * 100);
  }

  return 0;
};

const normalizeAdjustmentType = (value: unknown): RefundInput["adjustmentType"] => {
  const normalized = normalizeStatus(value);
  if (normalized.includes("complaint")) return "complaint_refund";
  if (normalized.includes("manual")) return "manual_adjustment";
  return "refund";
};

const parseCount = (value: unknown) => {
  const normalized = Number(value ?? 0);
  if (!Number.isFinite(normalized) || normalized < 0) return 0;
  return Math.round(normalized);
};

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const extractRefundInput = (row: RefundAdjustmentRow, fallbackRowReference: string): RefundInput => {
  const sourceLocation = pickText(row, [
    "location",
    "source_location",
    "machine_location",
    "refund_location",
    "location_name",
    "venue",
    "machine_alias",
    "machine",
  ]);
  const sourceStatus = pickText(row, ["status", "refund_status", "source_status"]);
  return {
    sourceRowReference: pickText(row, [
      "source_row_reference",
      "row_reference",
      "row_id",
      "response_id",
      "timestamp",
    ]) || fallbackRowReference,
    sourceLocation,
    normalizedLocation: normalizeMatchText(sourceLocation),
    refundDate: normalizeDate(pickText(row, ["refund_date", "processed_date", "adjustment_date", "date"])),
    originalOrderDate: normalizeDate(pickText(row, [
      "original_order_date",
      "order_date",
      "sale_date",
      "transaction_date",
    ])),
    amountCents: parseCents(row),
    reason: pickText(row, ["reason", "notes", "complaint_reason", "refund_reason"]),
    sourceStatus,
    normalizedSourceStatus: normalizeStatus(sourceStatus),
    adjustmentType: normalizeAdjustmentType(row.adjustment_type ?? row.type ?? row.reason),
    complaintCount: parseCount(row.complaint_count ?? row.complaints),
  };
};

const sourceRowHash = async (input: RefundInput) =>
  sha256Hex(JSON.stringify({
    sourceLocation: input.normalizedLocation,
    refundDate: input.refundDate,
    originalOrderDate: input.originalOrderDate,
    amountCents: input.amountCents,
    reason: normalizeMatchText(input.reason),
    sourceStatus: input.normalizedSourceStatus,
    adjustmentType: input.adjustmentType,
  }));

const recordRun = async ({
  status,
  sourceReference,
  rowsSeen = 0,
  rowsImported = 0,
  rowsSkipped = 0,
  meta = {},
  errorMessage,
}: {
  status: "running" | "completed" | "failed";
  sourceReference?: string | null;
  rowsSeen?: number;
  rowsImported?: number;
  rowsSkipped?: number;
  meta?: Record<string, unknown>;
  errorMessage?: string;
}) => {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("sales_import_runs")
    .insert({
      source: "google_sheets_refunds",
      status,
      source_reference: sourceReference ?? googleRefundsSheetId ?? "refund-source-export",
      rows_seen: rowsSeen,
      rows_imported: rowsImported,
      rows_skipped: rowsSkipped,
      error_message: errorMessage ?? null,
      meta: {
        mode: "reviewed_refund_adjustment_import",
        external_refund_source_configured: Boolean(googleRefundsSheetId && googleServiceAccountJson),
        ...meta,
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

const updateRun = async (runId: string | null, payload: Record<string, unknown>) => {
  if (!supabase || !runId) return;
  const { error } = await supabase.from("sales_import_runs").update(payload).eq("id", runId);
  if (error) console.error("refund-adjustment-sync import run update error", error);
};

const getLocationName = (machine: Record<string, unknown>) => {
  const relation = machine.reporting_locations;
  if (Array.isArray(relation)) return sanitizeText(relation[0]?.name);
  if (relation && typeof relation === "object") {
    return sanitizeText((relation as Record<string, unknown>).name);
  }
  return "";
};

const buildMachineProfiles = async (): Promise<MachineProfile[]> => {
  if (!supabase) return [];

  const [{ data: machines, error: machineError }, { data: aliases, error: aliasError }] =
    await Promise.all([
      supabase
        .from("reporting_machines")
        .select("id, location_id, machine_label, sunze_machine_id, reporting_locations(name)")
        .eq("status", "active"),
      supabase
        .from("reporting_machine_aliases")
        .select("reporting_machine_id, alias")
        .eq("status", "active"),
    ]);

  if (machineError) throw new Error(machineError.message || "Unable to load reporting machines.");
  if (aliasError) throw new Error(aliasError.message || "Unable to load refund matching aliases.");

  const aliasesByMachine = new Map<string, string[]>();
  (aliases ?? []).forEach((alias: Record<string, unknown>) => {
    const machineId = sanitizeText(alias.reporting_machine_id);
    const label = sanitizeText(alias.alias);
    if (!machineId || !label) return;
    aliasesByMachine.set(machineId, [...(aliasesByMachine.get(machineId) ?? []), label]);
  });

  return ((machines ?? []) as Array<Record<string, unknown>>).map((machine) => {
    const id = sanitizeText(machine.id);
    const labels = [
      { kind: "machine_label", text: sanitizeText(machine.machine_label) },
      { kind: "location_name", text: getLocationName(machine) },
      { kind: "external_machine_id", text: sanitizeText(machine.sunze_machine_id) },
      ...(aliasesByMachine.get(id) ?? []).map((alias) => ({ kind: "alias", text: alias })),
    ]
      .map((label) => ({ kind: label.kind, normalized: normalizeMatchText(label.text) }))
      .filter((label) => label.normalized);

    return {
      id,
      locationId: sanitizeText(machine.location_id),
      machineLabel: sanitizeText(machine.machine_label) || "Unnamed machine",
      labels,
    };
  });
};

const uniqueIds = (machines: MachineProfile[]) => [...new Set(machines.map((machine) => machine.id))];

const matchRefund = (input: RefundInput, machines: MachineProfile[]) => {
  if (!input.refundDate || input.amountCents <= 0 || !input.normalizedLocation) {
    return {
      status: "invalid",
      confidence: 0,
      reason: "missing_required_refund_fields",
      candidateMachineIds: [] as string[],
      matchedMachine: null as MachineProfile | null,
    };
  }

  if (!autoApplyStatuses.has(input.normalizedSourceStatus)) {
    return {
      status: "needs_review",
      confidence: 0,
      reason: input.normalizedSourceStatus ? "source_status_requires_review" : "missing_source_status",
      candidateMachineIds: [] as string[],
      matchedMachine: null as MachineProfile | null,
    };
  }

  const exactMatches = machines.filter((machine) =>
    machine.labels.some((label) => label.normalized === input.normalizedLocation)
  );
  const exactIds = uniqueIds(exactMatches);
  if (exactIds.length === 1) {
    return {
      status: "matched",
      confidence: 1,
      reason: "exact_location_or_alias_match",
      candidateMachineIds: exactIds,
      matchedMachine: exactMatches.find((machine) => machine.id === exactIds[0]) ?? null,
    };
  }
  if (exactIds.length > 1) {
    return {
      status: "ambiguous",
      confidence: 0.5,
      reason: "multiple_exact_location_or_alias_matches",
      candidateMachineIds: exactIds,
      matchedMachine: null as MachineProfile | null,
    };
  }

  const fuzzyMatches = machines.filter((machine) =>
    machine.labels.some((label) =>
      label.kind === "alias" && label.normalized.length >= 5 &&
      (input.normalizedLocation.includes(label.normalized) ||
        label.normalized.includes(input.normalizedLocation))
    )
  );
  const fuzzyIds = uniqueIds(fuzzyMatches);
  if (fuzzyIds.length === 1) {
    return {
      status: "matched",
      confidence: 0.86,
      reason: "single_alias_containment_match",
      candidateMachineIds: fuzzyIds,
      matchedMachine: fuzzyMatches.find((machine) => machine.id === fuzzyIds[0]) ?? null,
    };
  }
  if (fuzzyIds.length > 1) {
    return {
      status: "ambiguous",
      confidence: 0.5,
      reason: "multiple_alias_containment_matches",
      candidateMachineIds: fuzzyIds,
      matchedMachine: null as MachineProfile | null,
    };
  }

  return {
    status: "unmatched",
    confidence: 0,
    reason: "no_conservative_machine_match",
    candidateMachineIds: [] as string[],
    matchedMachine: null as MachineProfile | null,
  };
};

const loadExistingHashes = async () => {
  if (!supabase) return new Set<string>();
  const { data, error } = await supabase
    .from("sales_adjustment_facts")
    .select("source_row_hash")
    .eq("source", "google_sheets");
  if (error) throw new Error(error.message || "Unable to load existing refund adjustments.");
  return new Set(((data ?? []) as Array<Record<string, unknown>>).map((row) => sanitizeText(row.source_row_hash)).filter(Boolean));
};

const importRows = async (
  rows: RefundAdjustmentRow[],
  sourceReference: string | null,
) => {
  if (!supabase) throw new Error("Supabase is not configured.");

  const runId = await recordRun({
    status: "running",
    sourceReference,
    rowsSeen: rows.length,
  });
  const machines = await buildMachineProfiles();
  const existingHashes = await loadExistingHashes();
  const seenHashes = new Set<string>();
  const counts = {
    rowsSeen: rows.length,
    rowsStaged: 0,
    rowsApplied: 0,
    rowsReview: 0,
    rowsDuplicate: 0,
    rowsInvalid: 0,
    rowsAmbiguous: 0,
    rowsUnmatched: 0,
  };

  try {
    for (const [index, row] of rows.entries()) {
      const input = extractRefundInput(row, `row-${index + 1}`);
      const hash = await sourceRowHash(input);
      const duplicate = seenHashes.has(hash) || existingHashes.has(hash);
      seenHashes.add(hash);
      const match = duplicate
        ? {
          status: "duplicate",
          confidence: 0,
          reason: "duplicate_source_row_hash",
          candidateMachineIds: [] as string[],
          matchedMachine: null as MachineProfile | null,
        }
        : matchRefund(input, machines);
      const canApply = match.status === "matched" && match.matchedMachine;

      const { data: staged, error: stageError } = await supabase
        .from("refund_adjustment_review_rows")
        .upsert({
          import_run_id: runId,
          source: "api_payload",
          source_reference: sourceReference ?? googleRefundsSheetId ?? "refund-source-export",
          source_row_reference: input.sourceRowReference,
          source_row_hash: hash,
          source_location: input.sourceLocation || null,
          refund_date: input.refundDate || null,
          original_order_date: input.originalOrderDate || null,
          amount_cents: input.amountCents,
          adjustment_type: input.adjustmentType,
          complaint_count: input.complaintCount,
          reason: input.reason || null,
          source_status: input.sourceStatus || null,
          raw_payload: row,
          match_status: canApply ? "matched" : match.status,
          match_confidence: match.confidence,
          match_reason: match.reason,
          candidate_machine_ids: match.candidateMachineIds,
          matched_machine_id: match.matchedMachine?.id ?? null,
          matched_location_id: match.matchedMachine?.locationId ?? null,
          resolution_status: canApply ? "approved" : "unresolved",
        }, { onConflict: "source,source_reference,source_row_reference" })
        .select("id")
        .single();

      if (stageError || !staged) {
        throw new Error(stageError?.message || "Unable to stage refund review row.");
      }

      counts.rowsStaged += 1;

      if (canApply && match.matchedMachine) {
        const { data: adjustment, error: adjustmentError } = await supabase
          .from("sales_adjustment_facts")
          .upsert({
            reporting_machine_id: match.matchedMachine.id,
            reporting_location_id: match.matchedMachine.locationId,
            adjustment_date: input.refundDate,
            adjustment_type: input.adjustmentType,
            amount_cents: input.amountCents,
            complaint_count: input.complaintCount,
            source: "google_sheets",
            source_reference: sourceReference ?? googleRefundsSheetId ?? "refund-source-export",
            source_row_reference: input.sourceRowReference,
            source_row_hash: hash,
            import_run_id: runId,
            refund_review_row_id: staged.id,
            match_status: "applied",
            match_confidence: match.confidence,
            notes: input.reason || null,
            raw_payload: row,
          }, { onConflict: "source,source_reference,source_row_reference" })
          .select("id")
          .single();

        if (adjustmentError || !adjustment) {
          throw new Error(adjustmentError?.message || "Unable to apply refund adjustment.");
        }

        const { error: reviewUpdateError } = await supabase
          .from("refund_adjustment_review_rows")
          .update({
            match_status: "applied",
            applied_adjustment_id: adjustment.id,
            resolution_status: "approved",
          })
          .eq("id", staged.id);

        if (reviewUpdateError) {
          throw new Error(reviewUpdateError.message || "Unable to mark refund row applied.");
        }

        existingHashes.add(hash);
        counts.rowsApplied += 1;
      } else {
        counts.rowsReview += 1;
        if (match.status === "duplicate") counts.rowsDuplicate += 1;
        if (match.status === "invalid") counts.rowsInvalid += 1;
        if (match.status === "ambiguous") counts.rowsAmbiguous += 1;
        if (match.status === "unmatched") counts.rowsUnmatched += 1;
      }
    }

    await updateRun(runId, {
      status: "completed",
      rows_seen: counts.rowsSeen,
      rows_imported: counts.rowsApplied,
      rows_skipped: counts.rowsSeen - counts.rowsApplied,
      meta: {
        mode: "reviewed_refund_adjustment_import",
        rows_staged: counts.rowsStaged,
        rows_review: counts.rowsReview,
        rows_duplicate: counts.rowsDuplicate,
        rows_invalid: counts.rowsInvalid,
        rows_ambiguous: counts.rowsAmbiguous,
        rows_unmatched: counts.rowsUnmatched,
      },
      completed_at: new Date().toISOString(),
    });

    return { runId, ...counts };
  } catch (error) {
    await updateRun(runId, {
      status: "failed",
      rows_imported: counts.rowsApplied,
      rows_skipped: counts.rowsSeen - counts.rowsApplied,
      error_message: error instanceof Error ? error.message : String(error),
      completed_at: new Date().toISOString(),
    });
    throw error;
  }
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
    const rows = Array.isArray(body.rows) ? (body.rows as RefundAdjustmentRow[]) : [];
    const sourceReference = sanitizeText(body.sourceReference) || googleRefundsSheetId || "refund-source-export";

    if (rows.length === 0) {
      const runId = await recordRun({
        status: "failed",
        sourceReference,
        errorMessage:
          googleRefundsSheetId && googleServiceAccountJson
            ? "External refund source fetch is blocked until the header and status contract is confirmed."
            : "External refund source credentials are not configured.",
      });
      return jsonResponse({
        status: "blocked",
        runId,
        message:
          "Send sanitized rows in the request body for now. Live refund-source ingestion is a follow-up after the sheet contract is confirmed.",
      });
    }

    const result = await importRows(rows, sourceReference);

    return jsonResponse({
      status: "completed",
      source: "refund_adjustments",
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
      500,
    );
  }
});
