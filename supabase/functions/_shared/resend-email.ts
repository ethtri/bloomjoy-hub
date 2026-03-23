const RESEND_API_BASE_URL = "https://api.resend.com/emails";

export type ResendEmailInput = {
  from?: string | null;
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
};

const resolveConfiguredFromEmail = () =>
  Deno.env.get("PARTNER_INVITE_FROM_EMAIL") ??
  Deno.env.get("TRANSACTIONAL_FROM_EMAIL") ??
  Deno.env.get("INTERNAL_NOTIFICATION_FROM_EMAIL");

export async function sendResendEmail({
  from,
  to,
  subject,
  text,
  html,
}: ResendEmailInput) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const resolvedFrom = from?.trim() || resolveConfiguredFromEmail()?.trim();
  const recipients = Array.isArray(to) ? to : [to];
  const normalizedRecipients = recipients
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (!resendApiKey) {
    throw new Error("Missing RESEND_API_KEY.");
  }

  if (!resolvedFrom) {
    throw new Error(
      "Missing invite sender email. Set PARTNER_INVITE_FROM_EMAIL, TRANSACTIONAL_FROM_EMAIL, or INTERNAL_NOTIFICATION_FROM_EMAIL."
    );
  }

  if (!normalizedRecipients.length) {
    throw new Error("No email recipients configured.");
  }

  const response = await fetch(RESEND_API_BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resolvedFrom,
      to: normalizedRecipients,
      subject,
      text,
      ...(html ? { html } : {}),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Resend request failed (${response.status}): ${errorBody || "Unknown error"}`
    );
  }
}
