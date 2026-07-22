const GMAIL_API_ROOT = "https://gmail.googleapis.com/gmail/v1/users/me";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const REQUEST_TIMEOUT_MS = 20_000;

export const REFUND_GMAIL_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);
export const REFUND_GMAIL_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const REFUND_GMAIL_MAX_ATTACHMENTS_PER_MESSAGE = 3;

export type RefundGmailConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  mailbox: string;
  labelId: string;
  startAt: Date;
};

export type GmailHeader = { name?: string; value?: string };
export type GmailMessagePart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailMessagePart[];
};
export type GmailMessage = {
  id?: string;
  threadId?: string;
  historyId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailMessagePart;
};
export type GmailThread = {
  id?: string;
  historyId?: string;
  messages?: GmailMessage[];
};

export class RefundGmailError extends Error {
  code: string;
  deliveryUncertain: boolean;

  constructor(code: string, message: string, deliveryUncertain = false) {
    super(message);
    this.name = "RefundGmailError";
    this.code = code;
    this.deliveryUncertain = deliveryUncertain;
  }
}

const cleanEnv = (name: string, maxLength: number) =>
  (Deno.env.get(name) ?? "").trim().slice(0, maxLength);

const isEmail = (value: string) =>
  /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) && value.length <= 320;

export const getRefundGmailConfig = (): RefundGmailConfig | null => {
  const clientId = cleanEnv("GMAIL_SUPPORT_CLIENT_ID", 512);
  const clientSecret = cleanEnv("GMAIL_SUPPORT_CLIENT_SECRET", 1024);
  const refreshToken = cleanEnv("GMAIL_SUPPORT_REFRESH_TOKEN", 4096);
  const mailbox = cleanEnv("GMAIL_SUPPORT_MAILBOX", 320).toLowerCase();
  const labelId = cleanEnv("GMAIL_REFUND_LABEL_ID", 255);
  const configuredStartAt = cleanEnv("GMAIL_REFUND_START_AT", 80);
  const parsedStartAt = configuredStartAt ? new Date(configuredStartAt) : null;
  const startAt = parsedStartAt && Number.isFinite(parsedStartAt.getTime())
    ? parsedStartAt
    : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  if (!clientId || !clientSecret || !refreshToken || !isEmail(mailbox) || !labelId) {
    return null;
  }

  return { clientId, clientSecret, refreshToken, mailbox, labelId, startAt };
};

const base64UrlToBytes = (value: string) => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

const bytesToBase64Url = (bytes: Uint8Array) =>
  bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

export const decodeGmailBody = (value: string | undefined, maxBytes = 50_000) => {
  if (!value) return "";
  try {
    const decoded = base64UrlToBytes(value);
    return new TextDecoder().decode(decoded.slice(0, maxBytes));
  } catch {
    return "";
  }
};

const decodeHtmlEntity = (entity: string) => {
  const known: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  const normalized = entity.toLowerCase();
  if (known[normalized]) return known[normalized];
  if (/^#\d+$/.test(normalized)) {
    return String.fromCodePoint(Number(normalized.slice(1)));
  }
  if (/^#x[0-9a-f]+$/.test(normalized)) {
    return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
  }
  return `&${entity};`;
};

export const htmlToPlainText = (html: string) =>
  html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/?(?:p|div|br|li|tr|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&([a-z]+|#\d+|#x[0-9a-f]+);/gi, (_match, entity: string) => decodeHtmlEntity(entity))
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const findBodyPart = (part: GmailMessagePart | undefined, mimeType: string): string => {
  if (!part) return "";
  if ((part.mimeType ?? "").toLowerCase() === mimeType && part.body?.data) {
    return decodeGmailBody(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const value = findBodyPart(child, mimeType);
    if (value) return value;
  }
  return "";
};

export const extractPlainTextBody = (payload: GmailMessagePart | undefined) => {
  const plain = findBodyPart(payload, "text/plain");
  if (plain) return plain.slice(0, 50_000).trim();
  const html = findBodyPart(payload, "text/html");
  return htmlToPlainText(html).slice(0, 50_000);
};

export const getGmailHeader = (headers: GmailHeader[] | undefined, name: string) =>
  (headers ?? []).find((header) => (header.name ?? "").toLowerCase() === name.toLowerCase())?.value?.trim() ?? "";

export const parseEmailAddress = (headerValue: string) => {
  const angleMatch = headerValue.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  const rawEmail = (angleMatch?.[2] ?? headerValue).trim().toLowerCase();
  const emailMatch = rawEmail.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  const email = (emailMatch?.[0] ?? "").toLowerCase().slice(0, 320);
  const name = (angleMatch?.[1] ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .slice(0, 160);
  return { email, name };
};

const luhnValid = (digits: string) => {
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (doubleDigit) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
};

export const redactPaymentCardNumbers = (value: string) => {
  let redacted = false;
  const text = value.replace(/(?:\d[ -]?){13,19}/g, (candidate) => {
    const digits = candidate.replace(/\D/g, "");
    if (!luhnValid(digits)) return candidate;
    redacted = true;
    return `•••• ${digits.slice(-4)}`;
  });
  return { text, redacted };
};

export const containsPaymentCardNumber = (value: string) =>
  redactPaymentCardNumbers(value).redacted;

export const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

type CachedAccessToken = { value: string; expiresAt: number };
let cachedAccessToken: CachedAccessToken | null = null;

const safeErrorCode = (status: number) => {
  if (status === 401) return "authorization_revoked";
  if (status === 403) return "gmail_permission_denied";
  if (status === 404) return "gmail_resource_not_found";
  if (status === 429) return "gmail_rate_limited";
  if (status >= 500) return "gmail_unavailable";
  return "gmail_request_rejected";
};

const refreshAccessToken = async (config: RefundGmailConfig) => {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  });
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new RefundGmailError("google_token_unavailable", "Unable to refresh Gmail authorization.");
  }

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const providerCode = typeof payload.error === "string" ? payload.error : "";
    throw new RefundGmailError(
      providerCode === "invalid_grant" ? "authorization_revoked" : "google_token_rejected",
      "Unable to refresh Gmail authorization.",
    );
  }

  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  const expiresIn = Number(payload.expires_in ?? 3600);
  if (!accessToken) {
    throw new RefundGmailError("google_token_invalid", "Gmail authorization returned no access token.");
  }

  cachedAccessToken = {
    value: accessToken,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };
  return accessToken;
};

const getAccessToken = async (config: RefundGmailConfig, forceRefresh = false) => {
  if (!forceRefresh && cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.value;
  }
  return await refreshAccessToken(config);
};

const gmailRequest = async <T>(
  config: RefundGmailConfig,
  path: string,
  init: RequestInit = {},
  retryUnauthorized = true,
): Promise<T> => {
  const accessToken = await getAccessToken(config);
  let response: Response;
  try {
    response = await fetch(`${GMAIL_API_ROOT}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new RefundGmailError("gmail_network_unknown", "Gmail request outcome is unknown.", init.method === "POST");
  }

  if (response.status === 401 && retryUnauthorized) {
    cachedAccessToken = null;
    await getAccessToken(config, true);
    return await gmailRequest<T>(config, path, init, false);
  }

  if (!response.ok) {
    throw new RefundGmailError(
      safeErrorCode(response.status),
      "Gmail request was rejected.",
      init.method === "POST" && response.status >= 500,
    );
  }

  return await response.json() as T;
};

export const verifyRefundGmailMailbox = async (config: RefundGmailConfig) => {
  const profile = await gmailRequest<{ emailAddress?: string; historyId?: string }>(config, "/profile");
  if ((profile.emailAddress ?? "").trim().toLowerCase() !== config.mailbox) {
    throw new RefundGmailError("mailbox_mismatch", "Gmail authorization is connected to the wrong mailbox.");
  }
  return profile;
};

export const listLabeledRefundThreads = async (
  config: RefundGmailConfig,
  pageToken?: string,
) => {
  const params = new URLSearchParams({
    labelIds: config.labelId,
    q: `after:${Math.floor(config.startAt.getTime() / 1000)}`,
    maxResults: "50",
  });
  if (pageToken) params.set("pageToken", pageToken);
  return await gmailRequest<{
    threads?: Array<{ id?: string; historyId?: string }>;
    nextPageToken?: string;
  }>(config, `/threads?${params.toString()}`);
};

export const getRefundGmailThread = async (config: RefundGmailConfig, threadId: string) =>
  await gmailRequest<GmailThread>(
    config,
    `/threads/${encodeURIComponent(threadId)}?format=full`,
  );

export const getRefundGmailAttachment = async (
  config: RefundGmailConfig,
  messageId: string,
  attachmentId: string,
) => {
  const response = await gmailRequest<{ data?: string; size?: number }>(
    config,
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
  if (!response.data) {
    throw new RefundGmailError("gmail_attachment_missing", "Gmail attachment data is unavailable.");
  }
  return {
    bytes: base64UrlToBytes(response.data),
    size: Number(response.size ?? 0),
  };
};

const sanitizeHeader = (value: string, maxLength: number) =>
  value.replace(/[\r\n]+/g, " ").trim().slice(0, maxLength);

const encodeHeader = (value: string) =>
  `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(value))}?=`;

const wrapBase64 = (value: string) => value.match(/.{1,76}/g)?.join("\r\n") ?? "";

const buildReplyMime = ({
  from,
  to,
  subject,
  text,
  html,
  inReplyTo,
  references,
  operationKey,
}: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  inReplyTo?: string | null;
  references?: string | null;
  operationKey: string;
}) => {
  const boundary = `bloomjoy_refund_${crypto.randomUUID().replaceAll("-", "")}`;
  const safeOperation = operationKey.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80);
  const messageHeader = `<refund-${safeOperation || crypto.randomUUID()}@bloomjoyusa.com>`;
  const headers = [
    `From: ${sanitizeHeader(from, 320)}`,
    `To: ${sanitizeHeader(to, 320)}`,
    `Subject: ${encodeHeader(sanitizeHeader(subject, 998))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageHeader}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const safeInReplyTo = sanitizeHeader(inReplyTo ?? "", 998);
  const safeReferences = sanitizeHeader(references ?? "", 4000);
  if (safeInReplyTo) headers.push(`In-Reply-To: ${safeInReplyTo}`);
  if (safeReferences) headers.push(`References: ${safeReferences}`);

  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(bytesToBase64(new TextEncoder().encode(text))),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(bytesToBase64(new TextEncoder().encode(html))),
    `--${boundary}--`,
    "",
  ];

  return {
    raw: bytesToBase64Url(new TextEncoder().encode([...headers, "", ...parts].join("\r\n"))),
    messageHeader,
  };
};

export const sendRefundGmailReply = async ({
  config,
  providerThreadId,
  operationKey,
  recipientEmail,
  subject,
  text,
  html,
  inReplyTo,
  references,
}: {
  config: RefundGmailConfig;
  providerThreadId: string;
  operationKey: string;
  recipientEmail: string;
  subject: string;
  text: string;
  html: string;
  inReplyTo?: string | null;
  references?: string | null;
}) => {
  if (!isEmail(recipientEmail.toLowerCase())) {
    throw new RefundGmailError("invalid_recipient", "Gmail reply recipient is invalid.");
  }
  if (containsPaymentCardNumber(`${subject}\n${text}`)) {
    throw new RefundGmailError("unsafe_payment_data", "Gmail reply contains a possible full card number.");
  }

  const mime = buildReplyMime({
    from: config.mailbox,
    to: recipientEmail,
    subject,
    text,
    html,
    inReplyTo,
    references,
    operationKey,
  });
  const response = await gmailRequest<{ id?: string; threadId?: string }>(
    config,
    "/messages/send",
    {
      method: "POST",
      body: JSON.stringify({ raw: mime.raw, threadId: providerThreadId }),
    },
  );
  if (!response.id || response.threadId !== providerThreadId) {
    throw new RefundGmailError("gmail_send_unconfirmed", "Gmail did not confirm the reply thread.", true);
  }
  return { providerMessageId: response.id, providerMessageHeader: mime.messageHeader };
};
