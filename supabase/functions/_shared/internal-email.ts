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

const getRecipients = (): string[] => {
  const configuredRecipients = parseRecipients(
    Deno.env.get("INTERNAL_NOTIFICATION_RECIPIENTS")
  );
  if (configuredRecipients.length > 0) {
    return configuredRecipients;
  }
  return DEFAULT_RECIPIENTS;
};

export type InternalEmailInput = {
  subject: string;
  text: string;
};

export type TransactionalEmailInput = {
  to: string[];
  subject: string;
  text: string;
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
}: TransactionalEmailInput) {
  const { resendApiKey, fromEmail } = getResendConfig();

  if (!to.length) {
    throw new Error("No email recipients configured.");
  }

  const recipients = to.map((value) => value.trim().toLowerCase()).filter(Boolean);

  if (!recipients.length) {
    throw new Error("No email recipients configured.");
  }

  const response = await fetch(RESEND_API_BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: recipients,
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Resend request failed (${response.status}): ${errorBody || "Unknown error"}`
    );
  }
}

export async function sendInternalEmail({ subject, text }: InternalEmailInput) {
  const recipients = getRecipients();

  if (!recipients.length) {
    throw new Error("No internal email recipients configured.");
  }

  await sendTransactionalEmail({
    to: recipients,
    subject,
    text,
  });
}
