import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildSalesReportPdf,
  summarizeSalesReportPdfRows,
  type SalesReportPdfRow,
} from "../_shared/sales-report-pdf.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const exportBucket = "sales-report-exports";
const validGrains = new Set(["day", "week", "month"]);
const validPaymentMethods = new Set(["cash", "credit", "other", "unknown"]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const serviceSupabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false },
      })
    : null;

type ReportFilters = {
  title: string;
  dateFrom: string;
  dateTo: string;
  grain: "day" | "week" | "month";
  machineIds: string[];
  locationIds: string[];
  paymentMethods: string[];
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const dateInput = (date: Date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const normalizeUuidArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((entry) => String(entry).trim()).filter((entry) => uuidPattern.test(entry))
    : [];

const normalizePaymentMethods = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => String(entry).trim().toLowerCase())
        .filter((entry) => validPaymentMethods.has(entry))
    : [];

const normalizeFilters = (value: unknown): ReportFilters => {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const now = new Date();
  const defaultDateTo = dateInput(now);
  const defaultDateFromDate = new Date(now);
  defaultDateFromDate.setUTCDate(defaultDateFromDate.getUTCDate() - 30);
  const defaultDateFrom = dateInput(defaultDateFromDate);
  const grain = String(raw.grain ?? "week").trim().toLowerCase();
  const dateFrom = String(raw.dateFrom ?? defaultDateFrom).trim();
  const dateTo = String(raw.dateTo ?? defaultDateTo).trim();

  return {
    title: String(raw.title ?? "Bloomjoy sales report").trim() || "Bloomjoy sales report",
    dateFrom: datePattern.test(dateFrom) ? dateFrom : defaultDateFrom,
    dateTo: datePattern.test(dateTo) ? dateTo : defaultDateTo,
    grain: validGrains.has(grain) ? (grain as ReportFilters["grain"]) : "week",
    machineIds: normalizeUuidArray(raw.machineIds),
    locationIds: normalizeUuidArray(raw.locationIds),
    paymentMethods: normalizePaymentMethods(raw.paymentMethods),
  };
};

const toBlobPart = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    if (!supabaseUrl || !supabaseAnonKey || !serviceSupabase) {
      return jsonResponse({ error: "Sales report export is not configured." }, 500);
    }

    const accessToken = resolveSupabaseAccessToken(req);
    if (!accessToken) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const { data: authData, error: authError } =
      await serviceSupabase.auth.getUser(accessToken);
    const user = authData?.user;
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const filters = normalizeFilters((body as Record<string, unknown>)?.filters);
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });

    const { data: reportRows, error: reportError } = await userSupabase.rpc(
      "get_sales_report",
      {
        p_date_from: filters.dateFrom,
        p_date_to: filters.dateTo,
        p_grain: filters.grain,
        p_machine_ids: filters.machineIds.length ? filters.machineIds : null,
        p_location_ids: filters.locationIds.length ? filters.locationIds : null,
        p_payment_methods: filters.paymentMethods.length ? filters.paymentMethods : null,
      }
    );

    if (reportError) {
      return jsonResponse({ error: reportError.message || "Unable to load report." }, 400);
    }

    const rows = ((reportRows ?? []) as SalesReportPdfRow[]).sort((left, right) =>
      String(left.period_start ?? "").localeCompare(String(right.period_start ?? ""))
    );
    const summary = summarizeSalesReportPdfRows(rows);

    const { data: snapshot, error: snapshotError } = await serviceSupabase
      .from("report_view_snapshots")
      .insert({
        report_view_id: crypto.randomUUID(),
        created_by: user.id,
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
      subtitle: `${filters.dateFrom} through ${filters.dateTo} by ${filters.grain}`,
      rows,
      summary,
    });
    const storagePath = `${user.id}/${snapshot.id}.pdf`;
    const { error: uploadError } = await serviceSupabase.storage
      .from(exportBucket)
      .upload(storagePath, new Blob([toBlobPart(pdfBytes)], { type: "application/pdf" }), {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      await serviceSupabase
        .from("report_view_snapshots")
        .update({
          export_status: "failed",
          error_message: uploadError.message,
        })
        .eq("id", snapshot.id);
      throw new Error(uploadError.message);
    }

    const { data: signedUrlData, error: signedUrlError } = await serviceSupabase.storage
      .from(exportBucket)
      .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      throw new Error(signedUrlError?.message || "Unable to sign report export.");
    }

    await serviceSupabase
      .from("report_view_snapshots")
      .update({
        export_storage_path: storagePath,
        export_status: "ready",
      })
      .eq("id", snapshot.id);

    return jsonResponse({
      snapshotId: snapshot.id,
      storagePath,
      signedUrl: signedUrlData.signedUrl,
      rowCount: rows.length,
    });
  } catch (error) {
    console.error("sales-report-export error", error);
    return jsonResponse(
      {
        error:
          error instanceof Error && error.message
            ? error.message
            : "Unable to export sales report.",
      },
      500
    );
  }
});
