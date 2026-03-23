import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { sendResendEmail } from "../_shared/resend-email.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const defaultAppOrigin = "https://app.bloomjoyusa.com";

if (!supabaseUrl) {
  console.error("Missing SUPABASE_URL");
}

if (!supabaseServiceRoleKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    })
  : null;

type CustomerAccountInviteRow = {
  id: string;
  account_id: string;
  email: string;
  role: "partner" | "operator";
  invited_by_user_id: string | null;
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
  last_sent_at: string | null;
  last_send_error: string | null;
  created_at: string;
  updated_at: string;
};

type CustomerAccountRow = {
  id: string;
  name: string;
  operator_seat_limit: number;
};

type PortalAccessContext = {
  account_id: string | null;
  account_role: "partner" | "operator" | null;
  access_tier: "baseline" | "training" | "plus";
  can_manage_operators: boolean;
  is_admin: boolean;
};

type AuthenticatedUser = {
  id: string;
  email: string;
};

type TeamAction =
  | "create_operator_invite"
  | "resend_invite"
  | "revoke_access"
  | "admin_invite_partner";

const sanitizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const getAppOrigin = () =>
  sanitizeText(Deno.env.get("APP_ORIGIN")).replace(/\/+$/, "") || defaultAppOrigin;

const getRpcErrorStatus = (message: string) => {
  const normalized = message.toLowerCase();

  if (normalized.includes("authentication required") || normalized.includes("unauthorized")) {
    return 401;
  }

  if (
    normalized.includes("access denied") ||
    normalized.includes("partner access required") ||
    normalized.includes("admin access required")
  ) {
    return 403;
  }

  if (normalized.includes("not found")) {
    return 404;
  }

  return 400;
};

const buildInviteLoginUrl = ({
  email,
  role,
  accountName,
}: {
  email: string;
  role: "partner" | "operator";
  accountName: string;
}) => {
  const pathname = role === "operator" ? "/login/operator" : "/login";
  const url = new URL(`${getAppOrigin()}${pathname}`);
  url.searchParams.set("invite", "1");
  url.searchParams.set("email", email);
  url.searchParams.set("role", role);
  url.searchParams.set("account", accountName);
  return url.toString();
};

const buildInviteEmailCopy = ({
  invite,
  inviterEmail,
  accountName,
  loginUrl,
}: {
  invite: CustomerAccountInviteRow;
  inviterEmail: string;
  accountName: string;
  loginUrl: string;
}) => {
  const accessLabel = invite.role === "partner"
    ? "Bloomjoy partner access"
    : "Bloomjoy operator training access";
  const subject = invite.role === "partner"
    ? "You've been granted Bloomjoy partner access"
    : "You've been invited to the Bloomjoy operator app";
  const text = [
    `Hello,`,
    ``,
    invite.role === "partner"
      ? `${inviterEmail} has granted you partner access for ${accountName}.`
      : `${inviterEmail} has invited you to join ${accountName} as an operator.`,
    ``,
    `Access included: ${accessLabel}`,
    invite.role === "partner"
      ? `Partner access includes training, onboarding, support, and team invite management.`
      : `Operator access includes training resources only.`,
    ``,
    `Use the exact invited email address (${invite.email}) when you sign in or create your account.`,
    `Open the Bloomjoy app here: ${loginUrl}`,
    ``,
    `This invite email is not itself a sign-in link.`,
    `Depending on which sign-in method you choose, you may receive a normal Bloomjoy auth confirmation or magic-link email after this.`,
    ``,
    `If you were not expecting this invite, you can ignore this email.`,
  ].join("\n");

  return { subject, text };
};

const resolveAuthenticatedUser = async (req: Request): Promise<AuthenticatedUser | null> => {
  if (!supabase) {
    return null;
  }

  const accessToken = resolveSupabaseAccessToken(req);
  if (!accessToken) {
    return null;
  }

  const { data, error } = await supabase.auth.getUser(accessToken);
  const email = sanitizeText(data?.user?.email).toLowerCase();

  if (error || !data?.user || !email) {
    return null;
  }

  return {
    id: data.user.id,
    email,
  };
};

const fetchPortalAccessContext = async (userId: string): Promise<PortalAccessContext> => {
  if (!supabase) {
    throw new Error("Customer account team access is not configured.");
  }

  const { data, error } = await supabase.rpc("get_portal_access_context_for_user", {
    p_user_id: userId,
  });

  if (error || !data) {
    throw new Error(error?.message || "Unable to resolve access context.");
  }

  return data as PortalAccessContext;
};

const fetchInvite = async (inviteId: string): Promise<CustomerAccountInviteRow> => {
  if (!supabase) {
    throw new Error("Customer account team access is not configured.");
  }

  const { data, error } = await supabase
    .from("customer_account_invites")
    .select("*")
    .eq("id", inviteId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(error?.message || "Invite not found.");
  }

  return data as CustomerAccountInviteRow;
};

const fetchAccount = async (accountId: string): Promise<CustomerAccountRow> => {
  if (!supabase) {
    throw new Error("Customer account team access is not configured.");
  }

  const { data, error } = await supabase
    .from("customer_accounts")
    .select("id,name,operator_seat_limit")
    .eq("id", accountId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(error?.message || "Customer account not found.");
  }

  return data as CustomerAccountRow;
};

const sendInviteEmail = async ({
  invite,
  account,
  inviterEmail,
}: {
  invite: CustomerAccountInviteRow;
  account: CustomerAccountRow;
  inviterEmail: string;
}) => {
  const loginUrl = buildInviteLoginUrl({
    email: invite.email,
    role: invite.role,
    accountName: account.name,
  });
  const { subject, text } = buildInviteEmailCopy({
    invite,
    inviterEmail,
    accountName: account.name,
    loginUrl,
  });

  await sendResendEmail({
    to: invite.email,
    subject,
    text,
  });

  return loginUrl;
};

const recordInviteDelivery = async ({
  actorUserId,
  inviteId,
  deliveryError,
}: {
  actorUserId: string;
  inviteId: string;
  deliveryError: string | null;
}) => {
  if (!supabase) {
    throw new Error("Customer account team access is not configured.");
  }

  const { data, error } = await supabase.rpc(
    "record_customer_account_invite_delivery_as_actor",
    {
      p_actor_user_id: actorUserId,
      p_invite_id: inviteId,
      p_send_error: deliveryError,
    },
  );

  if (error || !data) {
    throw new Error(error?.message || "Unable to record invite delivery.");
  }

  return data as CustomerAccountInviteRow;
};

const ensureInviteActorCanManage = ({
  invite,
  accessContext,
}: {
  invite: CustomerAccountInviteRow;
  accessContext: PortalAccessContext;
}) => {
  if (accessContext.is_admin) {
    return;
  }

  if (
    invite.role === "operator" &&
    accessContext.can_manage_operators &&
    accessContext.account_id === invite.account_id &&
    accessContext.account_role === "partner"
  ) {
    return;
  }

  throw new Error("Access denied");
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed." }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!supabase) {
      return new Response(
        JSON.stringify({ error: "Customer account team access is not configured." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const user = await resolveAuthenticatedUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const action = sanitizeText(body?.action) as TeamAction;

    if (!action) {
      return new Response(JSON.stringify({ error: "Action is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "create_operator_invite") {
      const inviteEmail = sanitizeText(body?.email).toLowerCase();

      if (!inviteEmail) {
        return new Response(JSON.stringify({ error: "Operator email is required." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await supabase.rpc("create_customer_account_invite_as_actor", {
        p_actor_user_id: user.id,
        p_invite_email: inviteEmail,
        p_role: "operator",
      });

      if (error || !data) {
        return new Response(
          JSON.stringify({ error: error?.message || "Unable to create operator invite." }),
          {
            status: getRpcErrorStatus(error?.message || "Unable to create operator invite."),
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const invite = data as CustomerAccountInviteRow;
      const account = await fetchAccount(invite.account_id);
      let loginUrl = "";
      let deliveryStatus: "sent" | "failed" = "sent";
      let deliveryError: string | null = null;

      try {
        loginUrl = await sendInviteEmail({ invite, account, inviterEmail: user.email });
      } catch (error) {
        deliveryStatus = "failed";
        deliveryError = error instanceof Error ? error.message : "Unable to send invite email.";
      }

      const updatedInvite = await recordInviteDelivery({
        actorUserId: user.id,
        inviteId: invite.id,
        deliveryError,
      });

      return new Response(
        JSON.stringify({
          invite: updatedInvite,
          deliveryStatus,
          deliveryError,
          loginUrl,
          accountName: account.name,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (action === "admin_invite_partner") {
      const inviteEmail = sanitizeText(body?.email).toLowerCase();
      const accountName = sanitizeText(body?.accountName);

      if (!inviteEmail) {
        return new Response(JSON.stringify({ error: "Partner email is required." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await supabase.rpc("create_customer_account_invite_as_actor", {
        p_actor_user_id: user.id,
        p_invite_email: inviteEmail,
        p_role: "partner",
        p_account_name: accountName || null,
      });

      if (error || !data) {
        return new Response(
          JSON.stringify({ error: error?.message || "Unable to create partner invite." }),
          {
            status: getRpcErrorStatus(error?.message || "Unable to create partner invite."),
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const invite = data as CustomerAccountInviteRow;
      const account = await fetchAccount(invite.account_id);
      let loginUrl = "";
      let deliveryStatus: "sent" | "failed" = "sent";
      let deliveryError: string | null = null;

      try {
        loginUrl = await sendInviteEmail({
          invite,
          account,
          inviterEmail: "Bloomjoy Team",
        });
      } catch (error) {
        deliveryStatus = "failed";
        deliveryError = error instanceof Error ? error.message : "Unable to send invite email.";
      }

      const updatedInvite = await recordInviteDelivery({
        actorUserId: user.id,
        inviteId: invite.id,
        deliveryError,
      });

      return new Response(
        JSON.stringify({
          invite: updatedInvite,
          deliveryStatus,
          deliveryError,
          loginUrl,
          accountName: account.name,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (action === "resend_invite") {
      const inviteId = sanitizeText(body?.inviteId);
      if (!inviteId) {
        return new Response(JSON.stringify({ error: "Invite id is required." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const accessContext = await fetchPortalAccessContext(user.id);
      const invite = await fetchInvite(inviteId);
      ensureInviteActorCanManage({ invite, accessContext });

      if (invite.accepted_at || invite.revoked_at) {
        return new Response(
          JSON.stringify({ error: "Only pending invites can be resent." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const account = await fetchAccount(invite.account_id);
      let loginUrl = "";
      let deliveryStatus: "sent" | "failed" = "sent";
      let deliveryError: string | null = null;

      try {
        loginUrl = await sendInviteEmail({ invite, account, inviterEmail: user.email });
      } catch (error) {
        deliveryStatus = "failed";
        deliveryError = error instanceof Error ? error.message : "Unable to send invite email.";
      }

      const updatedInvite = await recordInviteDelivery({
        actorUserId: user.id,
        inviteId: invite.id,
        deliveryError,
      });

      return new Response(
        JSON.stringify({
          invite: updatedInvite,
          deliveryStatus,
          deliveryError,
          loginUrl,
          accountName: account.name,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (action === "revoke_access") {
      const inviteId = sanitizeText(body?.inviteId) || null;
      const membershipId = sanitizeText(body?.membershipId) || null;
      const reason = sanitizeText(body?.reason) || null;

      if (!inviteId && !membershipId) {
        return new Response(
          JSON.stringify({ error: "Invite id or membership id is required." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const { data, error } = await supabase.rpc("revoke_customer_account_access_as_actor", {
        p_actor_user_id: user.id,
        p_membership_id: membershipId,
        p_invite_id: inviteId,
        p_reason: reason,
      });

      if (error || !data) {
        return new Response(
          JSON.stringify({ error: error?.message || "Unable to revoke access." }),
          {
            status: getRpcErrorStatus(error?.message || "Unable to revoke access."),
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      return new Response(JSON.stringify({ result: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("customer-account-team error", error);
    const status = error instanceof Error
      ? getRpcErrorStatus(error.message) === 400 &&
          error.message.toLowerCase().startsWith("unable to")
        ? 500
        : getRpcErrorStatus(error.message)
      : 500;
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unable to manage customer account team.",
      }),
      {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

