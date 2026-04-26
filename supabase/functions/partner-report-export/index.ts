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
  const feeText = feeAmount > 0 && feeBasis === "per_stick"
    ? `$${
      (feeAmount / 100).toFixed(2)
    } stick-level cost deduction per paid stick/item`
    : feeAmount > 0
    ? `$${(feeAmount / 100).toFixed(2)} ${
      feeBasis.replaceAll("_", " ")
    } deduction`
    : "no stick-level deduction";

  return `Net sales split: gross sales less machine taxes and ${feeText}; no-pay rows count in volume but deduct $0.`;
};

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
    .select("id, name")
    .in("id", partnerIds);

  if (partnersError || !partners?.length) {
    return [];
  }

  const partnerNameById = new Map(
    partners.map((partner) => [partner.id, partner.name]),
  );
  return parties
    .map((party) => partnerNameById.get(party.partner_id))
    .filter((name): name is string => Boolean(name));
};

const getActiveFinancialRule = async (
  partnershipId: string,
  weekStartDate: string,
  weekEndingDate: string,
): Promise<Record<string, unknown> | null> => {
  if (!serviceSupabase) return null;

  const { data, error } = await serviceSupabase
    .from("reporting_partnership_financial_rules")
    .select("*")
    .eq("partnership_id", partnershipId)
    .eq("status", "active")
    .lte("effective_start_date", weekEndingDate)
    .or(`effective_end_date.is.null,effective_end_date.gte.${weekStartDate}`)
    .order("effective_start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to load payout rule.");
  }

  return data ?? null;
};

const getOrCreateSnapshot = async ({
  partnershipId,
  weekEndingDate,
  userId,
  summaryJson,
}: {
  partnershipId: string;
  weekEndingDate: string;
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
    .eq("week_ending_date", weekEndingDate)
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
      week_ending_date: weekEndingDate,
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
    const partnershipId = String(raw.partnershipId ?? "").trim();
    const weekEndingDate = String(raw.weekEndingDate ?? "").trim();
    const format = String(raw.format ?? "pdf").trim().toLowerCase();

    if (!uuidPattern.test(partnershipId)) {
      return jsonResponse({ error: "Valid partnershipId is required." }, 400);
    }

    if (!datePattern.test(weekEndingDate)) {
      return jsonResponse({ error: "Valid weekEndingDate is required." }, 400);
    }

    if (!validFormats.has(format)) {
      return jsonResponse({ error: "format must be pdf or csv." }, 400);
    }

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });

    const { data: previewData, error: previewError } = await userSupabase.rpc(
      "admin_preview_partner_weekly_report",
      {
        p_partnership_id: partnershipId,
        p_week_ending_date: weekEndingDate,
      },
    );

    if (previewError) {
      return jsonResponse({
        error: previewError.message || "Unable to preview partner report.",
      }, 400);
    }

    const preview = (previewData ?? {}) as PartnerReportPreview;
    const weekStartDate = String(
      preview.weekStartDate ?? getWeekStartDate(weekEndingDate),
    );
    const generatedAt = new Date().toISOString();
    const [payoutRecipientLabels, financialRule] = await Promise.all([
      getPayoutRecipientLabels(partnershipId),
      getActiveFinancialRule(partnershipId, weekStartDate, weekEndingDate),
    ]);
    const calculationLabel = formatCalculationLabel(financialRule);
    const context = {
      preview,
      payoutRecipientLabels,
      calculationLabel,
      generatedAt,
    };
    const fileBytes = format === "pdf"
      ? buildPartnerReportPdf(context)
      : encoder.encode(buildPartnerReportCsv(context));
    const contentType = format === "pdf" ? "application/pdf" : "text/csv";
    const fileName = `${
      slugify(preview.partnershipName ?? "partner-report")
    }-${weekEndingDate}.${format}`;
    const snapshot = await getOrCreateSnapshot({
      partnershipId,
      weekEndingDate,
      userId: user.id,
      summaryJson: {
        preview,
        calculationLabel,
        payoutRecipientLabels,
      },
    });
    const storagePath =
      `partner-reports/${partnershipId}/${snapshot.id}/${fileName}`;

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
        format === "csv" &&
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
      payoutRecipientLabels,
      exports: {
        ...(((snapshot.summary_json as Record<string, unknown> | null)
          ?.exports as Record<string, unknown> | undefined) ?? {}),
        [format]: {
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
      format,
      fileName,
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
