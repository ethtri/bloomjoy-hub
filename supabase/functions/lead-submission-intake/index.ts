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

const sanitizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const buildJsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });

const submissionTypeLabels: Record<string, string> = {
  quote: "quote request",
  demo: "demo request",
  procurement: "procurement inquiry",
  general: "general inquiry",
};

const isDispatchBookkeepingError = (code: string | undefined) =>
  code === "23514" || code === "42501" || code === "42P01";

const claimDispatch = async (
  eventKey: string,
  dispatchType: "lead_submission",
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

  // Keep lead intake resilient if dispatch bookkeeping cannot write due to
  // schema drift or missing privileges. The durable submission row already
  // exists, so the operator follow-up should not surface as a customer-facing
  // failure.
  if (isDispatchBookkeepingError(error.code)) {
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
    if (req.method !== "POST") {
      return buildJsonResponse({ error: "Method not allowed." }, 405);
    }

    if (!supabase) {
      return buildJsonResponse({ error: "Lead intake is not configured." }, 500);
    }

    const body = await req.json();

    const submissionType = sanitizeText(body?.submissionType).toLowerCase();
    const name = sanitizeText(body?.name);
    const email = sanitizeText(body?.email).toLowerCase();
    const sourcePage = sanitizeText(body?.sourcePage) || "/contact";
    const message = sanitizeText(body?.message);
    const machineInterest = sanitizeText(body?.machineInterest);
    const clientSubmissionId = sanitizeText(body?.clientSubmissionId).toLowerCase();
    const website = sanitizeText(body?.website);

    if (website) {
      return buildJsonResponse({ ok: true });
    }

    if (!validSubmissionTypes.has(submissionType)) {
      return buildJsonResponse({ error: "Invalid inquiry type." }, 400);
    }

    if (!name || !email || !message) {
      return buildJsonResponse({ error: "Name, email, and message are required." }, 400);
    }

    if (!emailPattern.test(email)) {
      return buildJsonResponse({ error: "Please enter a valid email address." }, 400);
    }

    if (!clientSubmissionId || !uuidPattern.test(clientSubmissionId)) {
      return buildJsonResponse(
        { error: "Missing submission token. Refresh and try again." },
        400
      );
    }

    const normalizedMessage =
      submissionType === "quote" && machineInterest
        ? `Machine of interest: ${machineInterest}\n\n${message}`
        : message;

    const selectedColumns =
      "id, submission_type, name, email, source_page, message, created_at, internal_notification_sent_at";

    const { data: insertedLead, error: insertError } = await supabase
      .from("lead_submissions")
      .insert({
        submission_type: submissionType,
        name,
        email,
        message: normalizedMessage,
        source_page: sourcePage,
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

    if (!leadSubmission || leadSubmission.internal_notification_sent_at) {
      return buildJsonResponse({ ok: true });
    }

    const submissionLabel =
      submissionTypeLabels[leadSubmission.submission_type] || "lead submission";
    try {
      const eventKey = `lead_submission:${leadSubmission.id}`;
      const dispatchClaimed = await claimDispatch(
        eventKey,
        "lead_submission",
        leadSubmission.id
      );

      if (!dispatchClaimed) {
        return buildJsonResponse({ ok: true });
      }

      const internalSubject = `New ${submissionLabel}: ${leadSubmission.name}`;
      const internalText = [
        `A new ${submissionLabel} was submitted.`,
        "",
        `Submission ID: ${leadSubmission.id}`,
        `Submitted At (UTC): ${leadSubmission.created_at}`,
        `Inquiry Type: ${leadSubmission.submission_type}`,
        `Name: ${leadSubmission.name}`,
        `Email: ${leadSubmission.email}`,
        `Source Page: ${leadSubmission.source_page}`,
        "",
        "Message:",
        leadSubmission.message,
      ].join("\n");

      await sendInternalEmail({
        subject: internalSubject,
        text: internalText,
      });

      await sendWeComAlertSafe({
        tag: "Bloomjoy Lead",
        title: `New ${submissionLabel}: ${leadSubmission.name}`,
        lines: [
          `Submission ID: ${leadSubmission.id}`,
          `Submitted At (UTC): ${leadSubmission.created_at}`,
          `Inquiry Type: ${leadSubmission.submission_type}`,
          `Name: ${leadSubmission.name}`,
          `Email: ${leadSubmission.email}`,
          `Source Page: ${leadSubmission.source_page}`,
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
          email: leadSubmission.email,
        }),
      ]);
    } catch (error) {
      const eventKey = `lead_submission:${leadSubmission.id}`;
      console.error("lead-submission-intake notification follow-up failed", error);
      await releaseDispatch(eventKey);
      return buildJsonResponse({ ok: true });
    }

    return buildJsonResponse({ ok: true });
  } catch (error) {
    console.error("lead-submission-intake error", error);
    return buildJsonResponse({ error: "Unable to submit contact request." }, 500);
  }
});
