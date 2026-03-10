import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendInternalEmail } from "../_shared/internal-email.ts";

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
    const name = sanitizeText(body?.name);
    const email = sanitizeText(body?.email).toLowerCase();
    const sourcePage = sanitizeText(body?.sourcePage) || "/contact";
    const message = sanitizeText(body?.message);
    const machineInterest = sanitizeText(body?.machineInterest);
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
      `Name: ${leadSubmission.name}`,
      `Email: ${leadSubmission.email}`,
      `Source Page: ${leadSubmission.source_page}`,
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

    await Promise.all([
      supabase
        .from("lead_submissions")
        .update({ internal_notification_sent_at: new Date().toISOString() })
        .eq("id", leadSubmission.id),
      markDispatchSent(eventKey, {
        submission_type: leadSubmission.submission_type,
        source_page: leadSubmission.source_page,
      }),
    ]);

    return new Response(JSON.stringify({ ok: true }), {
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
