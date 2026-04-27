import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildPartnerReportCsv,
  buildPartnerReportPdf,
  type PartnerReportPreview,
} from "../_shared/partner-report-export.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const exportBucket = "sales-report-exports";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const validFormats = new Set(["pdf", "csv"]);
const validPeriodGrains = new Set(["reporting_week", "calendar_month"]);

type PartnerReportPeriodGrain = "reporting_week" | "calendar_month";

type PartnerPeriodPreviewRpc = {
  partnership_id?: string;
  partnership_name?: string;
  period_grain?: PartnerReportPeriodGrain;
  date_from?: string;
  date_to?: string;
  summary?: Record<string, unknown>;
  machine_periods?: Array<Record<string, unknown>>;
  warnings?: Array<{ message?: string }>;
};

type ExportRequest = {
  partnershipId: string;
  format: string;
  periodGrain: PartnerReportPeriodGrain;
  periodStartDate: string;
  periodEndDate: string;
  periodLabel: string;
  useLegacyWeeklyPreview: boolean;
};

const serviceSupabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  })
  : null;

const encoder = new TextEncoder();

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const dateInputFromDate = (date: Date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getWeekStartDate = (weekEndingDate: string) => {
  const date = new Date(`${weekEndingDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 6);
  return dateInputFromDate(date);
};

const formatMonthLabel = (dateInput: string) => {
  const date = new Date(`${dateInput}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateInput;

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(date);
};

const formatPeriodLabel = (
  periodGrain: PartnerReportPeriodGrain,
  periodStartDate: string,
  periodEndDate: string,
) => {
  if (
    periodGrain === "calendar_month" &&
    periodStartDate.slice(0, 7) === periodEndDate.slice(0, 7)
  ) {
    return formatMonthLabel(periodStartDate);
  }

  return `${periodStartDate} through ${periodEndDate}`;
};

const resolveExportRequest = (
  raw: Record<string, unknown>,
): { request?: ExportRequest; error?: string } => {
  const partnershipId = String(raw.partnershipId ?? "").trim();
  const format = String(raw.format ?? "pdf").trim().toLowerCase();
  const rawPeriodGrain = String(raw.periodGrain ?? "").trim();
  const hasExplicitPeriod = rawPeriodGrain.length > 0;
  const periodGrain = hasExplicitPeriod ? rawPeriodGrain : "reporting_week";

  if (!uuidPattern.test(partnershipId)) {
    return { error: "Valid partnershipId is required." };
  }

  if (!validFormats.has(format)) {
    return { error: "format must be pdf or csv." };
  }

  if (!validPeriodGrains.has(periodGrain)) {
    return { error: "periodGrain must be reporting_week or calendar_month." };
  }

  if (hasExplicitPeriod) {
    const periodStartDate = String(raw.dateFrom ?? "").trim();
    const periodEndDate = String(raw.dateTo ?? "").trim();

    if (
      !datePattern.test(periodStartDate) || !datePattern.test(periodEndDate)
    ) {
      return { error: "Valid dateFrom and dateTo are required." };
    }

    if (periodStartDate > periodEndDate) {
      return { error: "dateFrom must be on or before dateTo." };
    }

    return {
      request: {
        partnershipId,
        format,
        periodGrain: periodGrain as PartnerReportPeriodGrain,
        periodStartDate,
        periodEndDate,
        periodLabel: formatPeriodLabel(
          periodGrain as PartnerReportPeriodGrain,
          periodStartDate,
          periodEndDate,
        ),
        useLegacyWeeklyPreview: false,
      },
    };
  }

  const weekEndingDate = String(raw.weekEndingDate ?? "").trim();

  if (!datePattern.test(weekEndingDate)) {
    return { error: "Valid weekEndingDate is required." };
  }

  const periodStartDate = getWeekStartDate(weekEndingDate);

  return {
    request: {
      partnershipId,
      format,
      periodGrain: "reporting_week",
      periodStartDate,
      periodEndDate: weekEndingDate,
      periodLabel: formatPeriodLabel(
        "reporting_week",
        periodStartDate,
        weekEndingDate,
      ),
      useLegacyWeeklyPreview: true,
    },
  };
};

const toBlobPart = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "partner-report";

const formatCalculationLabel = (rule: Record<string, unknown> | null) => {
  if (!rule) {
    return "No active payout rule covered this preview week.";
  }

  const feeAmount = Number(rule.fee_amount_cents ?? 0);
  const feeBasis = String(rule.fee_basis ?? "none");
  const feeLabel = String(rule.fee_label ?? "Stick cost deduction");
  const feeText = feeAmount > 0 && feeBasis === "per_stick"
    ? `$${
      (feeAmount / 100).toFixed(2)
    } ${feeLabel.toLowerCase()} per paid stick/item`
    : feeAmount > 0
    ? `$${(feeAmount / 100).toFixed(2)} ${feeLabel.toLowerCase()} (${
      feeBasis.replaceAll("_", " ")
    })`
    : "no configured deduction";
  const additionalNotes = String(rule.additional_deductions_notes ?? "").trim();

  return `Net sales split: gross sales less machine taxes and ${feeText}; no-pay rows count in volume but deduct $0.${
    additionalNotes ? ` Additional notes: ${additionalNotes}` : ""
  }`;
};

const getRuleExportLabels = (rule: Record<string, unknown> | null) => ({
  feeLabel: String(rule?.fee_label ?? "Stick cost deduction"),
  costLabel: String(rule?.cost_label ?? "Costs"),
  additionalDeductionsNotes: String(rule?.additional_deductions_notes ?? "")
    .trim() || null,
});

const getPayoutRecipientLabels = async (
  partnershipId: string,
): Promise<string[]> => {
  if (!serviceSupabase) return [];

  const { data: parties, error: partiesError } = await serviceSupabase
    .from("reporting_partnership_parties")
    .select("partner_id, party_role, created_at")
    .eq("partnership_id", partnershipId)
    .eq("party_role", "revenue_share_recipient")
    .order("created_at", { ascending: true });

  if (partiesError || !parties?.length) {
    return [];
  }

  const partnerIds = parties.map((party) => party.partner_id).filter(Boolean);
  const { data: partners, error: partnersError } = await serviceSupabase
    .from("reporting_partners")
    .select("id, name, legal_name")
    .in("id", partnerIds);

  if (partnersError || !partners?.length) {
    return [];
  }

  const partnerNameById = new Map(
    partners.map((partner) => [partner.id, partner.legal_name || partner.name]),
  );
  return parties
    .map((party) => partnerNameById.get(party.partner_id))
    .filter((name): name is string => Boolean(name));
};

const getActiveFinancialRule = async (
  partnershipId: string,
  periodStartDate: string,
  periodEndDate: string,
): Promise<Record<string, unknown> | null> => {
  if (!serviceSupabase) return null;

  const { data, error } = await serviceSupabase
    .from("reporting_partnership_financial_rules")
    .select("*")
    .eq("partnership_id", partnershipId)
    .eq("status", "active")
    .lte("effective_start_date", periodEndDate)
    .or(`effective_end_date.is.null,effective_end_date.gte.${periodStartDate}`)
    .order("effective_start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to load payout rule.");
  }

  return data ?? null;
};

const mapPeriodPreviewToPartnerReportPreview = (
  data: PartnerPeriodPreviewRpc | null,
  request: ExportRequest,
): PartnerReportPreview => {
  const summary = data?.summary ?? {};
  const machinePeriods = Array.isArray(data?.machine_periods)
    ? data.machine_periods
    : [];

  return {
    partnershipId: String(data?.partnership_id ?? request.partnershipId),
    partnershipName: data?.partnership_name,
    periodGrain: request.periodGrain,
    periodStartDate: request.periodStartDate,
    periodEndDate: request.periodEndDate,
    periodLabel: request.periodLabel,
    weekStartDate: request.periodGrain === "reporting_week"
      ? request.periodStartDate
      : undefined,
    weekEndingDate: request.periodGrain === "reporting_week"
      ? request.periodEndDate
      : undefined,
    summary: {
      order_count: Number(summary.order_count ?? 0),
      item_quantity: Number(summary.item_quantity ?? 0),
      gross_sales_cents: Number(summary.gross_sales_cents ?? 0),
      tax_cents: Number(summary.tax_cents ?? 0),
      fee_cents: Number(summary.fee_cents ?? 0),
      cost_cents: Number(summary.cost_cents ?? 0),
      net_sales_cents: Number(summary.net_sales_cents ?? 0),
      split_base_cents: Number(summary.split_base_cents ?? 0),
      amount_owed_cents: Number(summary.amount_owed_cents ?? 0),
      bloomjoy_retained_cents: Number(summary.bloomjoy_retained_cents ?? 0),
    },
    machines: machinePeriods.map((machine) => ({
      machine_label: String(machine.machine_label ?? "Unnamed machine"),
      order_count: Number(machine.order_count ?? 0),
      item_quantity: Number(machine.item_quantity ?? 0),
      gross_sales_cents: Number(machine.gross_sales_cents ?? 0),
      tax_cents: Number(machine.tax_cents ?? 0),
      fee_cents: Number(machine.fee_cents ?? 0),
      cost_cents: Number(machine.cost_cents ?? 0),
      net_sales_cents: Number(machine.net_sales_cents ?? 0),
    })),
    warnings: (data?.warnings ?? []).map((warning) => ({
      message: warning.message,
    })),
  };
};

const getOrCreateSnapshot = async ({
  partnershipId,
  periodGrain,
  periodStartDate,
  periodEndDate,
  userId,
  summaryJson,
}: {
  partnershipId: string;
  periodGrain: PartnerReportPeriodGrain;
  periodStartDate: string;
  periodEndDate: string;
  userId: string;
  summaryJson: Record<string, unknown>;
}) => {
  if (!serviceSupabase) {
    throw new Error("Partner report export is not configured.");
  }

  const { data: existing, error: existingError } = await serviceSupabase
    .from("partner_report_snapshots")
    .select("id, summary_json")
    .eq("partnership_id", partnershipId)
    .eq("period_grain", periodGrain)
    .eq("period_start_date", periodStartDate)
    .eq("period_end_date", periodEndDate)
    .eq("status", "draft")
    .maybeSingle();

  if (existingError) {
    throw new Error(
      existingError.message || "Unable to load partner report snapshot.",
    );
  }

  if (existing?.id) {
    const { data: updated, error: updateError } = await serviceSupabase
      .from("partner_report_snapshots")
      .update({
        generated_at: new Date().toISOString(),
        generated_by: userId,
        week_ending_date: periodEndDate,
        period_grain: periodGrain,
        period_start_date: periodStartDate,
        period_end_date: periodEndDate,
        summary_json: {
          ...((existing.summary_json as Record<string, unknown> | null) ?? {}),
          ...summaryJson,
        },
      })
      .eq("id", existing.id)
      .select("id, summary_json")
      .single();

    if (updateError || !updated) {
      throw new Error(
        updateError?.message || "Unable to update partner report snapshot.",
      );
    }

    return updated;
  }

  const { data: inserted, error: insertError } = await serviceSupabase
    .from("partner_report_snapshots")
    .insert({
      partnership_id: partnershipId,
      week_ending_date: periodEndDate,
      period_grain: periodGrain,
      period_start_date: periodStartDate,
      period_end_date: periodEndDate,
      status: "draft",
      generated_by: userId,
      summary_json: summaryJson,
    })
    .select("id, summary_json")
    .single();

  if (insertError || !inserted) {
    throw new Error(
      insertError?.message || "Unable to create partner report snapshot.",
    );
  }

  return inserted;
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
      return jsonResponse(
        { error: "Partner report export is not configured." },
        500,
      );
    }

    const accessToken = resolveSupabaseAccessToken(req);
    if (!accessToken) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const { data: authData, error: authError } = await serviceSupabase.auth
      .getUser(accessToken);
    const user = authData?.user;
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const raw = body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
    const { request, error: requestError } = resolveExportRequest(raw);

    if (!request) {
      return jsonResponse(
        { error: requestError ?? "Invalid export request." },
        400,
      );
    }

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });

    const { data: previewData, error: previewError } = request
        .useLegacyWeeklyPreview
      ? await userSupabase.rpc(
        "admin_preview_partner_weekly_report",
        {
          p_partnership_id: request.partnershipId,
          p_week_ending_date: request.periodEndDate,
        },
      )
      : await userSupabase.rpc(
        "admin_preview_partner_period_report",
        {
          p_partnership_id: request.partnershipId,
          p_date_from: request.periodStartDate,
          p_date_to: request.periodEndDate,
          p_period_grain: request.periodGrain,
        },
      );

    if (previewError) {
      return jsonResponse({
        error: previewError.message || "Unable to preview partner report.",
      }, 400);
    }

    const preview = request.useLegacyWeeklyPreview
      ? ({
        ...((previewData ?? {}) as PartnerReportPreview),
        periodGrain: "reporting_week",
        periodStartDate: request.periodStartDate,
        periodEndDate: request.periodEndDate,
        periodLabel: request.periodLabel,
      } satisfies PartnerReportPreview)
      : mapPeriodPreviewToPartnerReportPreview(
        (previewData ?? {}) as PartnerPeriodPreviewRpc,
        request,
      );
    const generatedAt = new Date().toISOString();
    const [payoutRecipientLabels, financialRule] = await Promise.all([
      getPayoutRecipientLabels(request.partnershipId),
      getActiveFinancialRule(
        request.partnershipId,
        request.periodStartDate,
        request.periodEndDate,
      ),
    ]);
    const calculationLabel = formatCalculationLabel(financialRule);
    const ruleExportLabels = getRuleExportLabels(financialRule);
    const exportPayoutRecipientLabels = request.useLegacyWeeklyPreview
      ? payoutRecipientLabels
      : payoutRecipientLabels.length > 1
      ? [payoutRecipientLabels.join(" + ")]
      : payoutRecipientLabels;
    const snapshot = await getOrCreateSnapshot({
      partnershipId: request.partnershipId,
      periodGrain: request.periodGrain,
      periodStartDate: request.periodStartDate,
      periodEndDate: request.periodEndDate,
      userId: user.id,
      summaryJson: {
        preview,
        calculationLabel,
        payoutRecipientLabels: exportPayoutRecipientLabels,
        ...ruleExportLabels,
        generatedAt,
        periodGrain: request.periodGrain,
        periodStartDate: request.periodStartDate,
        periodEndDate: request.periodEndDate,
        periodLabel: request.periodLabel,
      },
    });
    const context = {
      preview,
      payoutRecipientLabels: exportPayoutRecipientLabels,
      calculationLabel,
      generatedAt,
      snapshotId: snapshot.id,
      ...ruleExportLabels,
    };
    const fileBytes = request.format === "pdf"
      ? buildPartnerReportPdf(context)
      : encoder.encode(buildPartnerReportCsv(context));
    const contentType = request.format === "pdf"
      ? "application/pdf"
      : "text/csv";
    const periodSlug = request.periodGrain === "calendar_month"
      ? request.periodStartDate.slice(0, 7)
      : request.periodEndDate;
    const fileName = `${slugify(preview.partnershipName ?? "partner-report")}-${
      request.periodGrain === "calendar_month" ? "monthly" : "weekly"
    }-${periodSlug}.${request.format}`;
    const storagePath =
      `partner-reports/${request.partnershipId}/${request.periodGrain}/${snapshot.id}/${fileName}`;

    const { error: uploadError } = await serviceSupabase.storage
      .from(exportBucket)
      .upload(
        storagePath,
        new Blob([toBlobPart(fileBytes)], { type: contentType }),
        {
          contentType,
          upsert: true,
        },
      );

    if (uploadError) {
      if (
        request.format === "csv" &&
        uploadError.message?.toLowerCase().includes("mime")
      ) {
        throw new Error(
          "CSV export storage is not configured for text/csv. Apply the latest reporting export migration and retry.",
        );
      }
      throw new Error(
        uploadError.message || "Unable to upload partner report.",
      );
    }

    const nextSummaryJson = {
      ...((snapshot.summary_json as Record<string, unknown> | null) ?? {}),
      preview,
      calculationLabel,
      payoutRecipientLabels: exportPayoutRecipientLabels,
      snapshotId: snapshot.id,
      ...ruleExportLabels,
      periodGrain: request.periodGrain,
      periodStartDate: request.periodStartDate,
      periodEndDate: request.periodEndDate,
      periodLabel: request.periodLabel,
      exports: {
        ...(((snapshot.summary_json as Record<string, unknown> | null)
          ?.exports as Record<string, unknown> | undefined) ?? {}),
        [request.format]: {
          storagePath,
          generatedAt,
          fileName,
        },
      },
    };

    const { error: snapshotUpdateError } = await serviceSupabase
      .from("partner_report_snapshots")
      .update({
        export_storage_path: storagePath,
        week_ending_date: request.periodEndDate,
        period_grain: request.periodGrain,
        period_start_date: request.periodStartDate,
        period_end_date: request.periodEndDate,
        summary_json: nextSummaryJson,
        generated_at: generatedAt,
      })
      .eq("id", snapshot.id);

    if (snapshotUpdateError) {
      throw new Error(
        snapshotUpdateError.message ||
          "Unable to update partner report snapshot.",
      );
    }

    const { data: signedUrlData, error: signedUrlError } = await serviceSupabase
      .storage
      .from(exportBucket)
      .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      throw new Error(
        signedUrlError?.message || "Unable to sign partner report export.",
      );
    }

    return jsonResponse({
      snapshotId: snapshot.id,
      storagePath,
      signedUrl: signedUrlData.signedUrl,
      format: request.format,
      fileName,
      periodGrain: request.periodGrain,
      periodStartDate: request.periodStartDate,
      periodEndDate: request.periodEndDate,
    });
  } catch (error) {
    console.error("partner-report-export error", error);
    return jsonResponse(
      {
        error: error instanceof Error && error.message
          ? error.message
          : "Unable to export partner report.",
      },
      500,
    );
  }
});
