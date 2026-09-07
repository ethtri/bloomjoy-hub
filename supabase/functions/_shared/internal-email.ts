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
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string | string[] | null;
  senderName?: string | null;
  idempotencyKey?: string | null;
};

export type TransactionalEmailReceipt = {
  provider: "resend";
  providerMessageId: string;
  acceptedAt: string;
};

export class TransactionalEmailDeliveryUnknownError extends TypeError {
  constructor() {
    super("Transactional email provider acceptance could not be confirmed.");
    this.name = "TransactionalEmailDeliveryUnknownError";
  }
}

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

const formatTransactionalSender = (
  configuredSender: string,
  senderName: string | null | undefined,
) => {
  if (!senderName) return configuredSender;
  const normalizedName = senderName.trim();
  const configuredAddress = configuredSender.trim().match(/<([^<>]+)>$/)?.[1] ??
    configuredSender.trim();
  const normalizedAddress = configuredAddress.trim().toLowerCase();
  if (
    !normalizedName || /[\r\n<>]/.test(normalizedName) ||
    /[\r\n]/.test(configuredSender) || !EMAIL_PATTERN.test(normalizedAddress)
  ) {
    throw new Error("Transactional email sender is invalid.");
  }
  return `${normalizedName} <${normalizedAddress}>`;
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
  cc = [],
  subject,
  text,
  html,
  replyTo,
  senderName,
  idempotencyKey,
}: TransactionalEmailInput): Promise<TransactionalEmailReceipt> {
  const { resendApiKey, fromEmail } = getResendConfig();

  if (!to.length) {
    throw new Error("No email recipients configured.");
  }

  const recipients = to.map((value) => value.trim().toLowerCase()).filter(Boolean);

  if (!recipients.length) {
    throw new Error("No email recipients configured.");
  }

  const payload: Record<string, unknown> = {
    from: formatTransactionalSender(fromEmail, senderName),
    to: recipients,
    subject,
    text,
  };

  const ccRecipients = Array.from(
    new Set(
      cc
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value && !recipients.includes(value)),
    ),
  );
  if (ccRecipients.length > 0) {
    payload.cc = ccRecipients;
  }

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

  const normalizedIdempotencyKey = idempotencyKey?.trim() || "";
  if (
    normalizedIdempotencyKey &&
    !/^[A-Za-z0-9_-]{1,200}$/.test(normalizedIdempotencyKey)
  ) {
    throw new Error("Transactional email idempotency key is invalid.");
  }

  const response = await fetch(RESEND_API_BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      ...(normalizedIdempotencyKey
        ? { "Idempotency-Key": normalizedIdempotencyKey }
        : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Resend request failed (${response.status}).`);
  }

  let responseBody = "";
  try {
    responseBody = await response.text();
    if (responseBody.length > 4096) {
      throw new TransactionalEmailDeliveryUnknownError();
    }
    const parsed = JSON.parse(responseBody) as { id?: unknown };
    const providerMessageId = typeof parsed?.id === "string"
      ? parsed.id.trim()
      : "";
    if (!/^[A-Za-z0-9_-]{8,255}$/.test(providerMessageId)) {
      throw new TransactionalEmailDeliveryUnknownError();
    }
    return {
      provider: "resend",
      providerMessageId,
      acceptedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof TransactionalEmailDeliveryUnknownError) throw error;
    throw new TransactionalEmailDeliveryUnknownError();
  }
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
