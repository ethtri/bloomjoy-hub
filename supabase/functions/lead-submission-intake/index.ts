import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendInternalEmail } from "../_shared/internal-email.ts";
import { sendWeComAlertSafe } from "../_shared/wecom-alert.ts";

export const config = {
  verify_jwt: false,
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const validSubmissionTypes = new Set(["quote", "demo", "procurement", "general"]);
const validAudienceSegments = new Set([
  "commercial_operator",
  "event_operator",
  "venue_or_procurement",
  "consumer_home_buyer",
  "not_sure",
]);
const validPurchaseTimelines = new Set([
  "now_30_days",
  "one_to_three_months",
  "three_to_six_months",
  "six_plus_months",
  "not_sure",
]);
const validBudgetStatuses = new Set([
  "budget_approved",
  "procurement_started",
  "evaluating_budget",
  "no_budget_yet",
  "not_sure",
]);
const attributionKeys = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "first_landing_page",
  "latest_page",
  "source_page",
  "first_referrer",
  "latest_referrer",
  "first_seen_at",
  "latest_seen_at",
]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!supabaseUrl) {
  console.error("Missing SUPABASE_URL");
}

if (!supabaseServiceRoleKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
      },
    })
  : null;

const sanitizeText = (value: unknown, maxLength = 2000) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const sanitizeEnum = (value: unknown, allowed: Set<string>) => {
  const cleaned = sanitizeText(value, 100);
  return allowed.has(cleaned) ? cleaned : null;
};

const sanitizeBoolean = (value: unknown) => value === true;

const sanitizeAttribution = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!attributionKeys.has(key) || typeof rawValue !== "string") {
      continue;
    }

    const cleaned = rawValue.trim().slice(0, 300);
    if (cleaned) {
      result[key] = cleaned;
    }
  }

  return result;
};

const hasSpecificValue = (value: string | null | undefined) =>
  Boolean(value && value !== "not_sure");

const scoreLead = ({
  submissionType,
  machineInterest,
  audienceSegment,
  purchaseTimeline,
  budgetStatus,
  name,
  email,
  companyName,
}: {
  submissionType: string;
  machineInterest: string;
  audienceSegment: string | null;
  purchaseTimeline: string | null;
  budgetStatus: string | null;
  name: string;
  email: string;
  companyName: string;
}) => {
  const hasUseCase =
    submissionType === "quote" &&
    (Boolean(machineInterest) || hasSpecificValue(audienceSegment));
  const hasTimeline =
    purchaseTimeline === "now_30_days" ||
    purchaseTimeline === "one_to_three_months" ||
    purchaseTimeline === "three_to_six_months";
  const hasBudgetOrProcurement =
    budgetStatus === "budget_approved" ||
    budgetStatus === "procurement_started" ||
    budgetStatus === "evaluating_budget";
  const hasContactQuality =
    Boolean(name && email) &&
    (Boolean(companyName) || audienceSegment === "consumer_home_buyer");
  const matchedSignals = [
    hasUseCase,
    hasTimeline,
    hasBudgetOrProcurement,
    hasContactQuality,
  ].filter(Boolean).length;

  return {
    grade: matchedSignals === 4 ? "A" : matchedSignals >= 3 ? "B" : "C",
    signals: {
      has_use_case: hasUseCase,
      has_timeline: hasTimeline,
      has_budget_or_procurement: hasBudgetOrProcurement,
      has_contact_quality: hasContactQuality,
      matched_signal_count: matchedSignals,
    },
  };
};

const claimDispatch = async (
  eventKey: string,
  dispatchType: "lead_quote",
  sourceId: string
): Promise<boolean> => {
  if (!supabase) return false;

  const { error } = await supabase.from("internal_notification_dispatches").insert({
    event_key: eventKey,
    dispatch_type: dispatchType,
    source_table: "lead_submissions",
    source_id: sourceId,
  });

  if (!error) {
    return true;
  }

  if (error.code === "23505") {
    return false;
  }

  // Keep quote intake resilient if dispatch bookkeeping cannot write due
  // transient schema drift or non-service-role function credentials.
  if (error.code === "42501" || error.code === "42P01") {
    console.warn(
      "Dispatch claim fallback: proceeding without dedupe bookkeeping.",
      error
    );
    return true;
  }

  throw new Error(error.message || "Failed to claim notification dispatch.");
};

const releaseDispatch = async (eventKey: string) => {
  if (!supabase) return;
  await supabase.from("internal_notification_dispatches").delete().eq("event_key", eventKey);
};

const markDispatchSent = async (eventKey: string, meta: Record<string, unknown>) => {
  if (!supabase) return;
  await supabase
    .from("internal_notification_dispatches")
    .update({ sent_at: new Date().toISOString(), meta })
    .eq("event_key", eventKey);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!supabase) {
      return new Response(
        JSON.stringify({ error: "Lead intake is not configured." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const body = await req.json();

    const submissionType = sanitizeText(body?.submissionType).toLowerCase();
    const name = sanitizeText(body?.name, 200);
    const email = sanitizeText(body?.email).toLowerCase();
    const sourcePage = sanitizeText(body?.sourcePage, 300) || "/contact";
    const message = sanitizeText(body?.message);
    const companyName = sanitizeText(body?.companyName, 200);
    const machineInterest = sanitizeText(body?.machineInterest, 100);
    const audienceSegment = sanitizeEnum(body?.audienceSegment, validAudienceSegments);
    const purchaseTimeline = sanitizeEnum(body?.purchaseTimeline, validPurchaseTimelines);
    const budgetStatus = sanitizeEnum(body?.budgetStatus, validBudgetStatuses);
    const plusInterest = sanitizeBoolean(body?.plusInterest);
    const marketingConsent = sanitizeBoolean(body?.marketingConsent);
    const attribution = sanitizeAttribution(body?.attribution);
    const clientSubmissionId = sanitizeText(body?.clientSubmissionId).toLowerCase();

    if (!validSubmissionTypes.has(submissionType)) {
      return new Response(
        JSON.stringify({ error: "Invalid inquiry type." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!name || !email || !message) {
      return new Response(
        JSON.stringify({ error: "Name, email, and message are required." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!emailPattern.test(email)) {
      return new Response(
        JSON.stringify({ error: "Please enter a valid email address." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!clientSubmissionId || !uuidPattern.test(clientSubmissionId)) {
      return new Response(
        JSON.stringify({ error: "Missing submission token. Refresh and try again." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const normalizedMessage =
      submissionType === "quote" && machineInterest
        ? `Machine of interest: ${machineInterest}\n\n${message}`
        : message;

    const leadScore = scoreLead({
      submissionType,
      machineInterest,
      audienceSegment,
      purchaseTimeline,
      budgetStatus,
      name,
      email,
      companyName,
    });

    const selectedColumns =
      "id, submission_type, name, email, source_page, message, machine_interest, audience_segment, purchase_timeline, budget_status, plus_interest, marketing_consent, qualification_grade, qualification_signals, attribution, created_at, internal_notification_sent_at";

    const { data: insertedLead, error: insertError } = await supabase
      .from("lead_submissions")
      .insert({
        submission_type: submissionType,
        name,
        email,
        company_name: companyName || null,
        message: normalizedMessage,
        source_page: sourcePage,
        machine_interest: machineInterest || null,
        audience_segment: audienceSegment,
        purchase_timeline: purchaseTimeline,
        budget_status: budgetStatus,
        plus_interest: plusInterest,
        marketing_consent: marketingConsent,
        marketing_consent_at: marketingConsent ? new Date().toISOString() : null,
        attribution,
        qualification_grade: leadScore.grade,
        qualification_signals: leadScore.signals,
        client_submission_id: clientSubmissionId,
      })
      .select(selectedColumns)
      .single();

    let leadSubmission = insertedLead;

    if (insertError) {
      if (insertError.code !== "23505") {
        throw new Error(insertError.message || "Unable to submit contact request.");
      }

      const { data: existingLead, error: existingLeadError } = await supabase
        .from("lead_submissions")
        .select(selectedColumns)
        .eq("client_submission_id", clientSubmissionId)
        .maybeSingle();

      if (existingLeadError || !existingLead) {
        throw new Error("Unable to submit contact request.");
      }

      leadSubmission = existingLead;
    }

    if (
      submissionType !== "quote" ||
      !leadSubmission ||
      leadSubmission.internal_notification_sent_at
    ) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const eventKey = `lead_quote:${leadSubmission.id}`;
    const dispatchClaimed = await claimDispatch(eventKey, "lead_quote", leadSubmission.id);

    if (!dispatchClaimed) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const quoteSubject = `New quote request: ${leadSubmission.name}`;
    const quoteText = [
      "A new quote request was submitted.",
      "",
      `Submission ID: ${leadSubmission.id}`,
      `Submitted At (UTC): ${leadSubmission.created_at}`,
      `Inquiry Type: ${leadSubmission.submission_type}`,
      `Qualification Grade: ${leadSubmission.qualification_grade ?? "n/a"}`,
      `Name: ${leadSubmission.name}`,
      `Email: ${leadSubmission.email}`,
      `Source Page: ${leadSubmission.source_page}`,
      `Machine Interest: ${leadSubmission.machine_interest ?? "n/a"}`,
      `Audience Segment: ${leadSubmission.audience_segment ?? "n/a"}`,
      `Timeline: ${leadSubmission.purchase_timeline ?? "n/a"}`,
      `Budget / Procurement: ${leadSubmission.budget_status ?? "n/a"}`,
      `Plus Interest: ${leadSubmission.plus_interest ? "yes" : "no"}`,
      `Marketing Consent: ${leadSubmission.marketing_consent ? "yes" : "no"}`,
      `Attribution: ${JSON.stringify(leadSubmission.attribution ?? {})}`,
      "",
      "Message:",
      leadSubmission.message,
    ].join("\n");

    try {
      await sendInternalEmail({
        subject: quoteSubject,
        text: quoteText,
      });
    } catch (error) {
      await releaseDispatch(eventKey);
      throw error;
    }

    await sendWeComAlertSafe({
      tag: "Bloomjoy Quote",
      title: `New quote request: ${leadSubmission.name}`,
      lines: [
        `Submission ID: ${leadSubmission.id}`,
        `Submitted At (UTC): ${leadSubmission.created_at}`,
        `Inquiry Type: ${leadSubmission.submission_type}`,
        `Qualification Grade: ${leadSubmission.qualification_grade ?? "n/a"}`,
        `Name: ${leadSubmission.name}`,
        `Email: ${leadSubmission.email}`,
        `Source Page: ${leadSubmission.source_page}`,
        `Machine Interest: ${leadSubmission.machine_interest ?? "n/a"}`,
        `Audience Segment: ${leadSubmission.audience_segment ?? "n/a"}`,
        `Timeline: ${leadSubmission.purchase_timeline ?? "n/a"}`,
        `Budget / Procurement: ${leadSubmission.budget_status ?? "n/a"}`,
        `Plus Interest: ${leadSubmission.plus_interest ? "yes" : "no"}`,
        `Marketing Consent: ${leadSubmission.marketing_consent ? "yes" : "no"}`,
        "Message:",
        leadSubmission.message,
      ],
    });

    await Promise.all([
      supabase
        .from("lead_submissions")
        .update({ internal_notification_sent_at: new Date().toISOString() })
        .eq("id", leadSubmission.id),
      markDispatchSent(eventKey, {
        submission_type: leadSubmission.submission_type,
        source_page: leadSubmission.source_page,
        qualification_grade: leadSubmission.qualification_grade,
      }),
    ]);

    return new Response(JSON.stringify({ ok: true, qualificationGrade: leadScore.grade }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("lead-submission-intake error", error);
    return new Response(
      JSON.stringify({ error: "Unable to submit contact request." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
