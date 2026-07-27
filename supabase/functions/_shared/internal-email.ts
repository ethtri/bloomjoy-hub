const RESEND_API_BASE_URL = "https://api.resend.com/emails";
const DEFAULT_RECIPIENTS = [
  "etrifari@bloomjoysweets.com",
  "ian@bloomjoysweets.com",
];

const parseRecipients = (value: string | undefined | null): string[] => {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
};

export const getInternalNotificationRecipients = (): string[] => {
  const configuredRecipients = parseRecipients(
    Deno.env.get("INTERNAL_NOTIFICATION_RECIPIENTS")
  );
  return Array.from(new Set([...DEFAULT_RECIPIENTS, ...configuredRecipients]));
};

export type InternalEmailInput = {
  subject: string;
  text: string;
};

export type TransactionalEmailInput = {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string | string[] | null;
  idempotencyKey?: string | null;
};

const getResendConfig = () => {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("INTERNAL_NOTIFICATION_FROM_EMAIL");

  if (!resendApiKey) {
    throw new Error("Missing RESEND_API_KEY.");
  }

  if (!fromEmail) {
    throw new Error("Missing INTERNAL_NOTIFICATION_FROM_EMAIL.");
  }

  return {
    resendApiKey,
    fromEmail,
  };
};

export async function sendTransactionalEmail({
  to,
  subject,
  text,
  html,
  replyTo,
  idempotencyKey,
}: TransactionalEmailInput) {
  const { resendApiKey, fromEmail } = getResendConfig();

  if (!to.length) {
    throw new Error("No email recipients configured.");
  }

  const recipients = to.map((value) => value.trim().toLowerCase()).filter(Boolean);

  if (!recipients.length) {
    throw new Error("No email recipients configured.");
  }

  const payload: Record<string, unknown> = {
    from: fromEmail,
    to: recipients,
    subject,
    text,
  };

  if (html) {
    payload.html = html;
  }

  const replyToRecipients = Array.isArray(replyTo)
    ? replyTo.map((value) => value.trim().toLowerCase()).filter(Boolean)
    : typeof replyTo === "string" && replyTo.trim()
      ? [replyTo.trim().toLowerCase()]
      : [];

  if (replyToRecipients.length === 1) {
    payload.reply_to = replyToRecipients[0];
  } else if (replyToRecipients.length > 1) {
    payload.reply_to = replyToRecipients;
  }

  const normalizedIdempotencyKey = idempotencyKey?.trim() ?? "";
  if (
    normalizedIdempotencyKey &&
    (
      normalizedIdempotencyKey.length > 256 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(normalizedIdempotencyKey)
    )
  ) {
    throw new Error("Invalid email idempotency key.");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${resendApiKey}`,
    "Content-Type": "application/json",
  };
  if (normalizedIdempotencyKey) {
    headers["Idempotency-Key"] = normalizedIdempotencyKey;
  }

  const response = await fetch(RESEND_API_BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Resend request failed (${response.status}).`);
  }

  const responseBody = await response.json().catch(() => ({})) as { id?: unknown };
  const providerMessageId =
    typeof responseBody.id === "string" ? responseBody.id.trim() : "";
  return {
    providerMessageId: /^[A-Za-z0-9][A-Za-z0-9._:-]{5,159}$/.test(
        providerMessageId,
      )
      ? providerMessageId
      : null,
  };
}

export async function sendInternalEmail({ subject, text }: InternalEmailInput) {
  const recipients = getInternalNotificationRecipients();

  if (!recipients.length) {
    throw new Error("No internal email recipients configured.");
  }

  await sendTransactionalEmail({
    to: recipients,
    subject,
    text,
  });
}
