import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendTransactionalEmail } from "../_shared/internal-email.ts";
import {
  buildSalesReportPdf,
  summarizeSalesReportPdfRows,
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

type MachineRow = {
  id: string;
  machine_label: string;
  location_id: string;
  reporting_locations?: { name: string } | Array<{ name: string }> | null;
};

type SalesFactRow = {
  reporting_machine_id: string;
  reporting_location_id: string;
  sale_date: string;
  payment_method: string;
  net_sales_cents: number;
  transaction_count: number;
};

type AdjustmentFactRow = {
  reporting_machine_id: string;
  reporting_location_id: string;
  adjustment_date: string;
  amount_cents: number;
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

const toBlobPart = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const getLocationName = (machine: MachineRow | undefined) => {
  const location = machine?.reporting_locations;
  if (Array.isArray(location)) {
    return location[0]?.name ?? "Location";
  }
  return location?.name ?? "Location";
};

const startOfPeriod = (dateValue: string, grain: string) => {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (grain === "month") {
    return `${year}-${String(month).padStart(2, "0")}-01`;
  }

  if (grain === "day") {
    return dateValue;
  }

  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return dateInput(addDays(date, -daysSinceMonday));
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
  let machineQuery = supabase
    .from("reporting_machines")
    .select("id, machine_label, location_id, reporting_locations(name)")
    .eq("status", "active");

  if (filters.machineIds.length > 0) {
    machineQuery = machineQuery.in("id", filters.machineIds);
  }

  if (filters.locationIds.length > 0) {
    machineQuery = machineQuery.in("location_id", filters.locationIds);
  }

  const { data: machineData, error: machineError } = await machineQuery;
  if (machineError) {
    throw new Error(machineError.message);
  }

  const machines = (((machineData ?? []) as unknown) as MachineRow[]).filter((machine) =>
    uuidPattern.test(machine.id)
  );
  const machineIds = machines.map((machine) => machine.id);
  const machineById = new Map(machines.map((machine) => [machine.id, machine]));

  if (machineIds.length === 0) {
    return { rows: [], filters };
  }

  let salesQuery = supabase
    .from("machine_sales_facts")
    .select(
      "reporting_machine_id, reporting_location_id, sale_date, payment_method, net_sales_cents, transaction_count"
    )
    .gte("sale_date", filters.dateFrom)
    .lte("sale_date", filters.dateTo)
    .in("reporting_machine_id", machineIds);

  if (filters.paymentMethods.length > 0) {
    salesQuery = salesQuery.in("payment_method", filters.paymentMethods);
  }

  const { data: salesData, error: salesError } = await salesQuery;
  if (salesError) {
    throw new Error(salesError.message);
  }

  const { data: adjustmentData, error: adjustmentError } = await supabase
    .from("sales_adjustment_facts")
    .select("reporting_machine_id, reporting_location_id, adjustment_date, amount_cents")
    .gte("adjustment_date", filters.dateFrom)
    .lte("adjustment_date", filters.dateTo)
    .in("reporting_machine_id", machineIds);

  if (adjustmentError) {
    throw new Error(adjustmentError.message);
  }

  const grouped = new Map<string, SalesReportPdfRow>();
  const totals = new Map<string, number>();
  const adjustments = new Map<string, number>();

  ((salesData ?? []) as SalesFactRow[]).forEach((fact) => {
    const periodStart = startOfPeriod(fact.sale_date, filters.grain);
    const totalKey = `${periodStart}:${fact.reporting_machine_id}:${fact.reporting_location_id}`;
    const rowKey = `${totalKey}:${fact.payment_method}`;
    const current =
      grouped.get(rowKey) ??
      ({
        period_start: periodStart,
        machine_label: machineById.get(fact.reporting_machine_id)?.machine_label ?? "Machine",
        location_name: getLocationName(machineById.get(fact.reporting_machine_id)),
        payment_method: fact.payment_method,
        net_sales_cents: 0,
        refund_amount_cents: 0,
        gross_sales_cents: 0,
        transaction_count: 0,
      } satisfies SalesReportPdfRow);

    current.net_sales_cents =
      Number(current.net_sales_cents ?? 0) + Number(fact.net_sales_cents ?? 0);
    current.transaction_count =
      Number(current.transaction_count ?? 0) + Number(fact.transaction_count ?? 0);
    grouped.set(rowKey, current);
    totals.set(totalKey, Number(totals.get(totalKey) ?? 0) + Number(fact.net_sales_cents ?? 0));
  });

  ((adjustmentData ?? []) as AdjustmentFactRow[]).forEach((adjustment) => {
    const periodStart = startOfPeriod(adjustment.adjustment_date, filters.grain);
    const totalKey = `${periodStart}:${adjustment.reporting_machine_id}:${adjustment.reporting_location_id}`;
    adjustments.set(totalKey, Number(adjustments.get(totalKey) ?? 0) + Number(adjustment.amount_cents ?? 0));
  });

  const rows = [...grouped.entries()].map(([rowKey, row]) => {
    const totalKey = rowKey.split(":").slice(0, 3).join(":");
    const netSales = Number(row.net_sales_cents ?? 0);
    const totalNetSales = Number(totals.get(totalKey) ?? 0);
    const totalAdjustments = Number(adjustments.get(totalKey) ?? 0);
    const allocatedRefunds =
      totalNetSales > 0 ? Math.round((totalAdjustments * netSales) / totalNetSales) : 0;

    return {
      ...row,
      refund_amount_cents: allocatedRefunds,
      gross_sales_cents: netSales + allocatedRefunds,
    };
  });

  rows.sort((left, right) =>
    String(left.period_start ?? "").localeCompare(String(right.period_start ?? ""))
  );

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
  const { data: snapshot, error: snapshotError } = await supabase
    .from("report_view_snapshots")
    .insert({
      report_view_id: schedule.id,
      created_by: schedule.created_by,
      title: filters.title,
      filters,
      summary: {
        net_sales_cents: summary.netSalesCents,
        refund_amount_cents: summary.refundAmountCents,
        gross_sales_cents: summary.grossSalesCents,
        transaction_count: summary.transactionCount,
        row_count: rows.length,
      },
      export_status: "pending",
    })
    .select("id")
    .single();

  if (snapshotError || !snapshot) {
    throw new Error(snapshotError?.message || "Unable to create report snapshot.");
  }

  const pdfBytes = buildSalesReportPdf({
    title: filters.title,
    subtitle: `${filters.dateFrom} through ${filters.dateTo}`,
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

  const text = [
    filters.title,
    "",
    `Date range: ${filters.dateFrom} through ${filters.dateTo}`,
    `Rows: ${rows.length}`,
    `Net sales: ${summary.netSalesCents / 100}`,
    `Gross sales: ${summary.grossSalesCents / 100}`,
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
