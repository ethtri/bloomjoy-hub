import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { sendTransactionalEmail } from "../_shared/internal-email.ts";
import { createMachineEmailDispatcher } from "../_shared/machine-email-alert-dispatch.ts";
import { machineEmailLinks } from "../_shared/machine-email-alert-delivery.ts";
import { collectMachineEmailSignals } from "../_shared/machine-email-alert-signals.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const client = supabaseUrl && serviceKey
  ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  : null;
const tokenForAccount = (accountKey: string) =>
  Deno.env.get(`NAYAX_LYNX_API_TOKEN_${accountKey}`) ||
  (accountKey === "TGPACI_USA_DB"
    ? Deno.env.get("NAYAX_LYNX_API_TOKEN")
    : undefined);
const dispatcher = client
  ? createMachineEmailDispatcher({
    client,
    secret: Deno.env.get("EMAIL_ALERT_SCHEDULER_SECRET"),
    transportConfigured: Boolean(
      Deno.env.get("RESEND_API_KEY") &&
        Deno.env.get("INTERNAL_NOTIFICATION_FROM_EMAIL"),
    ),
    sendEmail: sendTransactionalEmail,
    links: machineEmailLinks(
      Deno.env.get("EMAIL_ALERT_PORTAL_ORIGIN") ||
        "https://app.bloomjoyusa.com",
    ),
    collectSignals: (observedAt) =>
      collectMachineEmailSignals({
        client,
        observedAt,
        tokenForAccount,
        baseUrl: Deno.env.get("NAYAX_LYNX_BASE_URL") ||
          "https://lynx.nayax.com/operational/v1",
      }),
  })
  : null;

serve((request) =>
  dispatcher
    ? dispatcher(request)
    : new Response(JSON.stringify({ error: "service_not_configured" }), {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    })
);
