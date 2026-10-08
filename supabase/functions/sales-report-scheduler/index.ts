import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendTransactionalEmail } from "../_shared/internal-email.ts";
import {
  SALES_REPORT_PDF_GENERATOR_VERSION,
  buildSalesReportReference,
  buildSalesReportPdf,
  getSalesReportCalculationVersion,
  summarizeSalesReportPdfRows,
  buildSalesReportEstimateSnapshotSummary,
  type SalesReportPdfRow,
} from "../_shared/sales-report-pdf.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const schedulerSecret = Deno.env.get("REPORT_SCHEDULER_SECRET");
const exportBucket = "sales-report-exports";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false },
      })
    : null;

type ReportSchedule = {
  id: string;
  title: string;
  timezone: string;
  send_day_of_week: number;
  send_hour_local: number;
  report_filters: Record<string, unknown>;
  created_by: string | null;
  last_sent_at: string | null;
  report_schedule_recipients?: Array<{
    email: string;
    active: boolean;
  }>;
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const dateInput = (date: Date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const getLocalParts = (date: Date, timezone: string) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  const localDate = new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    dayOfWeek: localDate.getUTCDay(),
    dateKey: dateInput(localDate),
    localDate,
  };
};

const getPreviousWeekRange = (timezone: string, now: Date) => {
  const local = getLocalParts(now, timezone);
  const daysSinceMonday = (local.dayOfWeek + 6) % 7;
  const currentMonday = addDays(local.localDate, -daysSinceMonday);
  const previousMonday = addDays(currentMonday, -7);
  const previousSunday = addDays(previousMonday, 6);

  return {
    dateFrom: dateInput(previousMonday),
    dateTo: dateInput(previousSunday),
  };
};

const normalizeUuidArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((entry) => String(entry).trim()).filter((entry) => uuidPattern.test(entry))
    : [];

const normalizePaymentMethods = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => String(entry).trim().toLowerCase())
        .filter((entry) => ["cash", "credit", "other", "unknown"].includes(entry))
    : [];

const toAscii = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const uniqueLabels = (values: unknown[]): string[] =>
  [...new Set(values.map(toAscii).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );

const formatPaymentScopeLabel = (paymentMethods: string[]): string => {
  if (!paymentMethods.length) return "All: Cash, Card, Other, Unknown";

  return paymentMethods.map((method) => {
    if (method === "credit") return "Card";
    if (method === "cash") return "Cash";
    if (method === "other") return "Other";
    return "Unknown";
  }).join(", ");
};

const formatScopeLabel = ({
  explicitCount,
  labels,
  singularFallback,
  pluralFallback,
}: {
  explicitCount: number;
  labels: string[];
  singularFallback: string;
  pluralFallback: string;
}): string => {
  if (labels.length === 1) return labels[0];
  if (explicitCount > 0) {
    return `${explicitCount} selected ${explicitCount === 1 ? singularFallback : pluralFallback}`;
  }
  if (labels.length > 1) return `${labels.length} ${pluralFallback}`;
  return `All accessible ${pluralFallback}`;
};

const toBlobPart = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const scheduleIsDue = (schedule: ReportSchedule, now: Date, force: boolean) => {
  if (force) {
    return true;
  }

  const timezone = schedule.timezone || "America/Los_Angeles";
  const local = getLocalParts(now, timezone);
  const lastSentLocalKey = schedule.last_sent_at
    ? getLocalParts(new Date(schedule.last_sent_at), timezone).dateKey
    : null;

  return (
    local.dayOfWeek === schedule.send_day_of_week &&
    local.hour === schedule.send_hour_local &&
    lastSentLocalKey !== local.dateKey
  );
};

const resolveReportFilters = (schedule: ReportSchedule, now: Date) => {
  const filters = schedule.report_filters ?? {};
  const timezone = schedule.timezone || "America/Los_Angeles";
  const preset = String(filters.datePreset ?? "").trim();
  const range =
    preset === "previous_week"
      ? getPreviousWeekRange(timezone, now)
      : {
          dateFrom: String(filters.dateFrom ?? dateInput(addDays(now, -30))),
          dateTo: String(filters.dateTo ?? dateInput(now)),
        };
  const grain = String(filters.grain ?? "week").trim().toLowerCase();

  return {
    title: String(filters.title ?? schedule.title).trim() || schedule.title,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    grain: ["day", "week", "month"].includes(grain) ? grain : "week",
    machineIds: normalizeUuidArray(filters.machineIds),
    locationIds: normalizeUuidArray(filters.locationIds),
    paymentMethods: normalizePaymentMethods(filters.paymentMethods),
  };
};

const buildScheduledReportRows = async (
  schedule: ReportSchedule,
  now: Date
): Promise<{ rows: SalesReportPdfRow[]; filters: ReturnType<typeof resolveReportFilters> }> => {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const filters = resolveReportFilters(schedule, now);
  if (!schedule.created_by || !uuidPattern.test(schedule.created_by)) {
    throw new Error("Scheduled report owner is unavailable.");
  }

  // The narrow service RPC applies the schedule owner's normal machine access
  // before reading the same shared calculation used by the interactive report.
  const { data, error } = await supabase.rpc(
    "sales_report_scheduler_get_sales_report_complete",
    {
      p_actor_user_id: schedule.created_by,
      p_date_from: filters.dateFrom,
      p_date_to: filters.dateTo,
      p_grain: filters.grain,
      p_machine_ids: filters.machineIds.length ? filters.machineIds : null,
      p_location_ids: filters.locationIds.length ? filters.locationIds : null,
      p_payment_methods: filters.paymentMethods.length ? filters.paymentMethods : null,
    },
  );
  if (error) {
    throw new Error(error.message);
  }

  const rows = ((data ?? []) as SalesReportPdfRow[]).sort((left, right) =>
    [
      String(left.period_start ?? ""),
      String(left.location_name ?? ""),
      String(left.machine_label ?? ""),
      String(left.payment_method ?? ""),
    ].join(":").localeCompare([
      String(right.period_start ?? ""),
      String(right.location_name ?? ""),
      String(right.machine_label ?? ""),
      String(right.payment_method ?? ""),
    ].join(":")),
  );
  getSalesReportCalculationVersion(rows);

  return { rows, filters };
};

const processSchedule = async (schedule: ReportSchedule, now: Date) => {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const recipients =
    schedule.report_schedule_recipients
      ?.filter((recipient) => recipient.active)
      .map((recipient) => recipient.email.trim().toLowerCase())
      .filter(Boolean) ?? [];

  if (recipients.length === 0) {
    return { status: "skipped", reason: "No active recipients." };
  }

  const { rows, filters } = await buildScheduledReportRows(schedule, now);
  const summary = summarizeSalesReportPdfRows(rows);
  const calculationVersion = getSalesReportCalculationVersion(rows);
  const formatSummaryMoney = (value: number | null) =>
    value == null ? "Unavailable" : (value / 100).toFixed(2);
  const { data: snapshot, error: snapshotError } = await supabase
    .from("report_view_snapshots")
    .insert({
      report_view_id: schedule.id,
      created_by: schedule.created_by,
      title: filters.title,
      filters,
      summary: {
        pdf_generator_version: SALES_REPORT_PDF_GENERATOR_VERSION,
        ...buildSalesReportEstimateSnapshotSummary(summary),
        known_net_sales_cents: (summary.knownNetContributorRowCount ?? summary.knownNetRowCount) > 0 ? summary.knownNetSalesCents : null,
        known_refund_amount_cents: (summary.knownRefundContributorRowCount ?? summary.knownRefundRowCount) > 0 ? summary.knownRefundAmountCents : null,
        known_gross_sales_cents: (summary.knownGrossContributorRowCount ?? summary.knownGrossRowCount) > 0 ? summary.knownGrossSalesCents : null,
        known_tax_cents: summary.knownTaxRowCount > 0 ? summary.knownTaxCents : null,
        known_net_row_count: summary.knownNetRowCount,
        known_net_contributor_row_count: summary.knownNetContributorRowCount,
        known_refund_row_count: summary.knownRefundRowCount,
        known_refund_contributor_row_count: summary.knownRefundContributorRowCount,
        known_gross_row_count: summary.knownGrossRowCount,
        known_gross_contributor_row_count: summary.knownGrossContributorRowCount,
        known_tax_row_count: summary.knownTaxRowCount,
        omitted_net_row_count: rows.length - summary.knownNetRowCount,
        omitted_refund_row_count: rows.length - summary.knownRefundRowCount,
        omitted_gross_row_count: rows.length - summary.knownGrossRowCount,
        omitted_tax_row_count: rows.length - summary.knownTaxRowCount,
        net_sales_cents: summary.netSalesCents,
        refund_amount_cents: summary.refundAmountCents,
        gross_sales_cents: summary.grossSalesCents,
        tax_cents: summary.taxCents,
        refund_request_deduction_cents: summary.refundRequestDeductionCents,
        refund_reversal_cents: summary.refundReversalCents,
        refund_legacy_paid_deduction_cents: summary.refundLegacyPaidDeductionCents,
        refund_paid_context_cents: summary.refundPaidContextCents,
        refund_outstanding_context_cents: summary.refundOutstandingContextCents,
        unresolved_sales_count: summary.unresolvedSalesCount,
        unresolved_sales_cents: summary.unresolvedSalesCents,
        unresolved_refund_count: summary.unresolvedRefundCount,
        unresolved_refund_cents: summary.unresolvedRefundCents,
        unresolved_paid_context_count: summary.unresolvedPaidContextCount,
        unresolved_paid_context_cents: summary.unresolvedPaidContextCents,
        transaction_count: summary.transactionCount,
        row_count: rows.length,
      },
      export_status: "pending",
    })
    .select("id, created_at")
    .single();

  if (snapshotError || !snapshot) {
    throw new Error(snapshotError?.message || "Unable to create report snapshot.");
  }

  const machineLabels = uniqueLabels(rows.map((row) => row.machine_label));
  const locationLabels = uniqueLabels(rows.map((row) => row.location_name));
  const reportReference = buildSalesReportReference(snapshot.id, filters.dateTo);
  const pdfBytes = await buildSalesReportPdf({
    title: filters.title || "Bloomjoy Operator Sales Report",
    subtitle: "Partner-ready performance report for assigned machines.",
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    grain: filters.grain,
    generatedAt: String(snapshot.created_at ?? new Date().toISOString()),
    snapshotId: snapshot.id,
    reportReference,
    machineScopeLabel: formatScopeLabel({
      explicitCount: filters.machineIds.length,
      labels: machineLabels,
      singularFallback: "machine",
      pluralFallback: "machines",
    }),
    locationScopeLabel: formatScopeLabel({
      explicitCount: filters.locationIds.length,
      labels: locationLabels,
      singularFallback: "location",
      pluralFallback: "locations",
    }),
    paymentScopeLabel: formatPaymentScopeLabel(filters.paymentMethods),
    rows,
    summary,
  });
  const storagePath = `schedules/${schedule.id}/${snapshot.id}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(exportBucket)
    .upload(storagePath, new Blob([toBlobPart(pdfBytes)], { type: "application/pdf" }), {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    await supabase
      .from("report_view_snapshots")
      .update({ export_status: "failed", error_message: uploadError.message })
      .eq("id", snapshot.id);
    throw new Error(uploadError.message);
  }

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from(exportBucket)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    throw new Error(signedUrlError?.message || "Unable to sign report export.");
  }

  await supabase
    .from("report_view_snapshots")
    .update({ export_status: "ready", export_storage_path: storagePath })
    .eq("id", snapshot.id);

  const calculationLines = calculationVersion === "shared-sales-basis-v1"
    ? [
      `Sales before refunds: ${formatSummaryMoney(summary.grossSalesCents)}`,
      `Sales tax separated: ${formatSummaryMoney(summary.taxCents)}`,
      `Refund deductions: ${formatSummaryMoney(summary.refundAmountCents)}`,
      `Paid in period: ${formatSummaryMoney(summary.refundPaidContextCents)}`,
      `Outstanding requested: ${formatSummaryMoney(summary.refundOutstandingContextCents)}`,
      `Net sales: ${formatSummaryMoney(summary.netSalesCents)}`,
    ]
    : [
      `Gross sales: ${formatSummaryMoney(summary.grossSalesCents)}`,
      `Reported refunds: ${formatSummaryMoney(summary.refundAmountCents)}`,
      `Sales after refunds: ${formatSummaryMoney(summary.netSalesCents)}`,
    ];
  const text = [
    filters.title,
    "",
    `Date range: ${filters.dateFrom} through ${filters.dateTo}`,
    `Rows: ${rows.length}`,
    ...calculationLines,
    "",
    "Download the PDF:",
    signedUrlData.signedUrl,
  ].join("\n");
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <h1 style="font-size:20px;line-height:28px;">${escapeHtml(filters.title)}</h1>
      <p>Date range: ${escapeHtml(filters.dateFrom)} through ${escapeHtml(filters.dateTo)}</p>
      <p>Rows: ${rows.length}</p>
      <p>
        <a href="${escapeHtml(
          signedUrlData.signedUrl
        )}" style="color:#be5b7b;font-weight:700;">Download PDF report</a>
      </p>
    </div>
  `;

  await sendTransactionalEmail({
    to: recipients,
    subject: filters.title,
    text,
    html,
  });

  await supabase.from("report_schedules").update({ last_sent_at: now.toISOString() }).eq("id", schedule.id);

  return {
    status: "sent",
    rowCount: rows.length,
    snapshotId: snapshot.id,
    storagePath,
  };
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
      return jsonResponse({ error: "Sales report scheduler is not configured." }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const force = Boolean((body as Record<string, unknown>)?.force);
    const now = new Date();
    const { data, error } = await supabase
      .from("report_schedules")
      .select("*, report_schedule_recipients(email, active)")
      .eq("active", true);

    if (error) {
      throw new Error(error.message);
    }

    const schedules = ((data ?? []) as ReportSchedule[]).filter((schedule) =>
      scheduleIsDue(schedule, now, force)
    );
    const results: Array<Record<string, unknown>> = [];

    for (const schedule of schedules) {
      try {
        results.push({
          scheduleId: schedule.id,
          ...(await processSchedule(schedule, now)),
        });
      } catch (error) {
        console.error("sales-report-scheduler schedule error", schedule.id, error);
        results.push({
          scheduleId: schedule.id,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return jsonResponse({
      processed: results.length,
      results,
    });
  } catch (error) {
    console.error("sales-report-scheduler error", error);
    return jsonResponse(
      {
        error:
          error instanceof Error && error.message
            ? error.message
            : "Unable to process report schedules.",
      },
      500
    );
  }
});
