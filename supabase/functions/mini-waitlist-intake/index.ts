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
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

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

type WaitlistRecord = {
  id: string;
  product_slug: string;
  email: string;
  source_page: string;
  created_at: string;
  internal_notification_sent_at: string | null;
};

const baseSelectedColumns = "id, product_slug, email, source_page, created_at";
const notificationSelectedColumns = `${baseSelectedColumns}, internal_notification_sent_at`;

const isDispatchBookkeepingError = (code: string | undefined) =>
  code === "23514" || code === "42501" || code === "42P01";

const isMissingNotificationColumnError = (code: string | undefined) =>
  code === "42703";

const normalizeWaitlistRecord = (value: Record<string, unknown> | null): WaitlistRecord | null => {
  if (!value) {
    return null;
  }

  return {
    id: String(value.id ?? ""),
    product_slug: String(value.product_slug ?? "mini"),
    email: String(value.email ?? ""),
    source_page: String(value.source_page ?? "/machines/mini"),
    created_at: String(value.created_at ?? new Date().toISOString()),
    internal_notification_sent_at:
      typeof value.internal_notification_sent_at === "string"
        ? value.internal_notification_sent_at
        : null,
  };
};

const fetchWaitlistEntry = async (email: string): Promise<{
  entry: WaitlistRecord | null;
  supportsNotificationColumn: boolean;
}> => {
  if (!supabase) {
    return { entry: null, supportsNotificationColumn: false };
  }

  const fullResult = await supabase
    .from("mini_waitlist_submissions")
    .select(notificationSelectedColumns)
    .eq("product_slug", "mini")
    .eq("email", email)
    .maybeSingle();

  if (!fullResult.error) {
    return {
      entry: normalizeWaitlistRecord(fullResult.data as Record<string, unknown> | null),
      supportsNotificationColumn: true,
    };
  }

  if (!isMissingNotificationColumnError(fullResult.error.code)) {
    throw new Error(fullResult.error.message || "Unable to load the waitlist entry.");
  }

  const fallbackResult = await supabase
    .from("mini_waitlist_submissions")
    .select(baseSelectedColumns)
    .eq("product_slug", "mini")
    .eq("email", email)
    .maybeSingle();

  if (fallbackResult.error) {
    throw new Error(fallbackResult.error.message || "Unable to load the waitlist entry.");
  }

  return {
    entry: normalizeWaitlistRecord(fallbackResult.data as Record<string, unknown> | null),
    supportsNotificationColumn: false,
  };
};

const claimDispatch = async (eventKey: string, sourceId: string): Promise<boolean> => {
  if (!supabase) return false;

  const { error } = await supabase.from("internal_notification_dispatches").insert({
    event_key: eventKey,
    dispatch_type: "mini_waitlist",
    source_table: "mini_waitlist_submissions",
    source_id: sourceId,
  });

  if (!error) {
    return true;
  }

  if (error.code === "23505") {
    return false;
  }

  if (isDispatchBookkeepingError(error.code)) {
    console.warn(
      "Dispatch claim fallback: proceeding without dedupe bookkeeping.",
      error
    );
    return true;
  }

  throw new Error(error.message || "Failed to claim Mini waitlist notification.");
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
      return buildJsonResponse({ error: "Mini waitlist intake is not configured." }, 500);
    }

    const body = await req.json();
    const email = sanitizeText(body?.email).toLowerCase();
    const sourcePage = sanitizeText(body?.sourcePage) || "/machines/mini";
    const website = sanitizeText(body?.website);

    if (website) {
      return buildJsonResponse({ ok: true });
    }

    if (!emailPattern.test(email)) {
      return buildJsonResponse({ error: "Please enter a valid email address." }, 400);
    }

    const { error: insertError } = await supabase
      .from("mini_waitlist_submissions")
      .insert({
        product_slug: "mini",
        email,
        source_page: sourcePage,
      });

    let alreadyExists = false;

    if (insertError) {
      if (insertError.code !== "23505") {
        throw new Error(insertError.message || "Unable to join the waitlist right now.");
      }

      alreadyExists = true;
    }

    const {
      entry: waitlistEntry,
      supportsNotificationColumn,
    } = await fetchWaitlistEntry(email);

    if (!waitlistEntry || waitlistEntry.internal_notification_sent_at) {
      return buildJsonResponse({ ok: true, alreadyExists });
    }

    if (alreadyExists && !supportsNotificationColumn) {
      return buildJsonResponse({ ok: true, alreadyExists });
    }

    try {
      const eventKey = `mini_waitlist:${waitlistEntry.id}`;
      const dispatchClaimed = await claimDispatch(eventKey, waitlistEntry.id);

      if (!dispatchClaimed) {
        return buildJsonResponse({ ok: true, alreadyExists });
      }

      await sendInternalEmail({
        subject: `New Mini waitlist sign-up: ${waitlistEntry.email}`,
        text: [
          "A new Mini waitlist sign-up was submitted.",
          "",
          `Submission ID: ${waitlistEntry.id}`,
          `Submitted At (UTC): ${waitlistEntry.created_at}`,
          `Product: ${waitlistEntry.product_slug}`,
          `Email: ${waitlistEntry.email}`,
          `Source Page: ${waitlistEntry.source_page}`,
        ].join("\n"),
      });

      await sendWeComAlertSafe({
        tag: "Bloomjoy Mini",
        title: "New Mini waitlist sign-up",
        lines: [
          `Submission ID: ${waitlistEntry.id}`,
          `Submitted At (UTC): ${waitlistEntry.created_at}`,
          `Product: ${waitlistEntry.product_slug}`,
          `Email: ${waitlistEntry.email}`,
          `Source Page: ${waitlistEntry.source_page}`,
        ],
      });

      if (supportsNotificationColumn) {
        await supabase
          .from("mini_waitlist_submissions")
          .update({ internal_notification_sent_at: new Date().toISOString() })
          .eq("id", waitlistEntry.id);
      }

      await markDispatchSent(eventKey, {
        product_slug: waitlistEntry.product_slug,
        source_page: waitlistEntry.source_page,
        email: waitlistEntry.email,
      });
    } catch (error) {
      const eventKey = `mini_waitlist:${waitlistEntry.id}`;
      console.error("mini-waitlist-intake notification follow-up failed", error);
      await releaseDispatch(eventKey);
      return buildJsonResponse({ ok: true, alreadyExists });
    }

    return buildJsonResponse({ ok: true, alreadyExists });
  } catch (error) {
    console.error("mini-waitlist-intake error", error);
    return buildJsonResponse({ error: "Unable to join the waitlist right now." }, 500);
  }
});
