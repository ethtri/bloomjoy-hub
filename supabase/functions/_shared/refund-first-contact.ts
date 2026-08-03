export const REFUND_FIRST_CONTACT_TEMPLATE_KEY = "refund_first_contact_v1";

export type RefundFirstContactMode =
  | "disabled"
  | "shadow"
  | "isolated_test"
  | "active"
  | "blocked";

type FirstContactEnvironment = Record<string, string | undefined>;

export type RefundFirstContactConfig = {
  mode: RefundFirstContactMode;
  shouldClaim: boolean;
  shouldSend: boolean;
  cutoverAt: string | null;
  errorCode: string | null;
  isolatedSenderEmails: string[];
  refundRequestUrl: string;
  legacyRefundUrl: string;
  supportUrl: string;
};

export type RefundFirstContactEmailInput = {
  publicReference: string;
  customerName?: string | null;
  refundRequestUrl: string;
  legacyRefundUrl: string;
  supportUrl: string;
};

const DEFAULT_REFUND_REQUEST_URL =
  "https://www.bloomjoyusa.com/refunds/request";
const DEFAULT_LEGACY_REFUND_URL = "https://forms.gle/qQDt2V7dFBFPqjyW6";
const DEFAULT_SUPPORT_URL =
  "https://www.bloomjoyusa.com/resources#support-boundaries";
const REFUND_HOSTS = new Set(["bloomjoyusa.com", "www.bloomjoyusa.com"]);
const LEGACY_FORM_HOSTS = new Set(["forms.gle", "docs.google.com"]);
const ACTIVE_DELIVERY_POLICY_INSTALLED = false;

const sanitizeText = (value: unknown, maxLength: number) =>
  typeof value === "string" || typeof value === "number" ||
    typeof value === "boolean"
    ? String(value).trim().slice(0, maxLength)
    : "";

const enabled = (value: unknown) =>
  ["1", "true", "yes", "on"].includes(sanitizeText(value, 20).toLowerCase());

const isEmail = (value: string) =>
  /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) && value.length <= 320;

const emailList = (value: unknown) => {
  const raw = sanitizeText(value, 4000);
  if (!raw) return [];
  const values = [
    ...new Set(
      raw.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean),
    ),
  ];
  return values.length <= 20 && values.every(isEmail) ? values : [];
};

const httpsUrl = (
  value: unknown,
  fallback: string,
  allowedHosts: Set<string>,
) => {
  const candidate = sanitizeText(value, 1200) || fallback;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" && parsed.username === "" &&
        parsed.password === "" &&
        allowedHosts.has(parsed.hostname.toLowerCase())
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
};

const normalizedCutoverAt = (value: unknown) => {
  const candidate = sanitizeText(value, 80);
  if (!candidate) return null;
  const timestamp = new Date(candidate);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
};

const blockedConfig = (
  errorCode: string,
  links: Pick<
    RefundFirstContactConfig,
    "refundRequestUrl" | "legacyRefundUrl" | "supportUrl"
  >,
): RefundFirstContactConfig => ({
  mode: "blocked",
  shouldClaim: false,
  shouldSend: false,
  cutoverAt: null,
  errorCode,
  isolatedSenderEmails: [],
  ...links,
});

export const resolveRefundFirstContactConfig = (
  env: FirstContactEnvironment,
): RefundFirstContactConfig => {
  const refundRequestUrl = httpsUrl(
    env.REFUND_GMAIL_FIRST_CONTACT_REFUND_URL,
    DEFAULT_REFUND_REQUEST_URL,
    REFUND_HOSTS,
  );
  const legacyRefundUrl = httpsUrl(
    env.REFUND_GMAIL_FIRST_CONTACT_LEGACY_URL,
    DEFAULT_LEGACY_REFUND_URL,
    LEGACY_FORM_HOSTS,
  );
  const supportUrl = httpsUrl(
    env.REFUND_GMAIL_FIRST_CONTACT_SUPPORT_URL,
    DEFAULT_SUPPORT_URL,
    REFUND_HOSTS,
  );
  const links = { refundRequestUrl, legacyRefundUrl, supportUrl };
  if (!refundRequestUrl || !legacyRefundUrl || !supportUrl) {
    return blockedConfig("first_contact_public_url_invalid", links);
  }

  const rawMode = sanitizeText(env.REFUND_GMAIL_FIRST_CONTACT_MODE, 40)
    .toLowerCase();
  const mode = rawMode === "" || rawMode === "off" ? "disabled" : rawMode;
  if (mode === "disabled") {
    return {
      mode,
      shouldClaim: false,
      shouldSend: false,
      cutoverAt: null,
      errorCode: null,
      isolatedSenderEmails: [],
      ...links,
    };
  }
  if (mode === "shadow") {
    return {
      mode,
      shouldClaim: true,
      shouldSend: false,
      cutoverAt: null,
      errorCode: null,
      isolatedSenderEmails: [],
      ...links,
    };
  }
  if (mode !== "isolated_test" && mode !== "active") {
    return blockedConfig("first_contact_mode_invalid", links);
  }

  const cutoverAt = normalizedCutoverAt(
    env.REFUND_GMAIL_FIRST_CONTACT_CUTOVER_AT,
  );
  if (!cutoverAt) {
    return blockedConfig("first_contact_cutover_time_missing", links);
  }

  if (mode === "isolated_test") {
    if (!enabled(env.REFUND_GMAIL_FIRST_CONTACT_ISOLATED_CONFIRMED)) {
      return blockedConfig("first_contact_isolation_unconfirmed", links);
    }
    const currentLabelId = sanitizeText(env.GMAIL_REFUND_LABEL_ID, 255);
    const isolatedLabelId = sanitizeText(
      env.REFUND_GMAIL_FIRST_CONTACT_ISOLATED_LABEL_ID,
      255,
    );
    const productionLabelId = sanitizeText(
      env.REFUND_GMAIL_FIRST_CONTACT_PRODUCTION_LABEL_ID,
      255,
    );
    if (
      !currentLabelId || !isolatedLabelId || !productionLabelId ||
      currentLabelId !== isolatedLabelId ||
      isolatedLabelId === productionLabelId
    ) {
      return blockedConfig("first_contact_isolated_label_invalid", links);
    }
    const isolatedSenderEmails = emailList(
      env.REFUND_GMAIL_FIRST_CONTACT_ISOLATED_SENDERS,
    );
    if (isolatedSenderEmails.length === 0) {
      return blockedConfig("first_contact_isolated_senders_invalid", links);
    }
    return {
      mode,
      shouldClaim: true,
      shouldSend: true,
      cutoverAt,
      errorCode: null,
      isolatedSenderEmails,
      ...links,
    };
  }

  const currentLabelId = sanitizeText(env.GMAIL_REFUND_LABEL_ID, 255);
  const productionLabelId = sanitizeText(
    env.REFUND_GMAIL_FIRST_CONTACT_PRODUCTION_LABEL_ID,
    255,
  );
  if (
    !currentLabelId || !productionLabelId ||
    currentLabelId !== productionLabelId
  ) {
    return blockedConfig("first_contact_production_label_invalid", links);
  }

  if (!enabled(env.REFUND_GMAIL_LEGACY_RESPONDER_DISABLED)) {
    return blockedConfig("first_contact_legacy_responder_not_disabled", links);
  }
  if (!enabled(env.REFUND_GMAIL_FIRST_CONTACT_CUTOVER_APPROVED)) {
    return blockedConfig("first_contact_cutover_not_approved", links);
  }
  if (!ACTIVE_DELIVERY_POLICY_INSTALLED) {
    return blockedConfig("first_contact_active_dependencies_pending", links);
  }

  return {
    mode,
    shouldClaim: true,
    shouldSend: true,
    cutoverAt,
    errorCode: null,
    isolatedSenderEmails: [],
    ...links,
  };
};

export const isRefundFirstContactSenderAllowed = (
  config: RefundFirstContactConfig,
  senderEmail: string,
) =>
  config.mode !== "isolated_test" ||
  config.isolatedSenderEmails.includes(
    sanitizeText(senderEmail, 320).toLowerCase(),
  );

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const buildRefundFirstContactEmail = (
  input: RefundFirstContactEmailInput,
) => {
  const publicReference = sanitizeText(input.publicReference, 80);
  const safePublicReference = /^RF-[A-Z0-9]{6,20}$/i.test(publicReference)
    ? publicReference.toUpperCase()
    : "";
  const customerName = sanitizeText(input.customerName, 160);
  const refundRequestUrl = httpsUrl(input.refundRequestUrl, "", REFUND_HOSTS);
  const legacyRefundUrl = httpsUrl(
    input.legacyRefundUrl,
    "",
    LEGACY_FORM_HOSTS,
  );
  const supportUrl = httpsUrl(input.supportUrl, "", REFUND_HOSTS);
  if (!refundRequestUrl || !legacyRefundUrl || !supportUrl) {
    throw new Error("Valid public first-contact links are required.");
  }

  const greeting = customerName ? `Hi ${customerName},` : "Hi there,";
  const subject = safePublicReference
    ? `We received your Bloomjoy message - ${safePublicReference}`
    : "We received your Bloomjoy message";
  const textParts = [
    greeting,
    "",
    "Thank you for reaching out. We are sorry something went wrong with your Bloomjoy experience, and we want to make the next step as easy as possible.",
    "",
    "For a refund review, please use our short request form:",
    refundRequestUrl,
    "",
    "While we finish this transition, the current backup refund form is still available here:",
    legacyRefundUrl,
    "",
    "For troubleshooting or other support information, you can also visit:",
    supportUrl,
    "",
    "If you already submitted a form, there is no need to submit it again. Reply in this same conversation and we will keep your information together.",
    "",
    ...(safePublicReference ? [`Reference: ${safePublicReference}`, ""] : []),
    "For your safety, never email complete payment-card details, security codes, passwords, or wallet screenshots.",
    "",
    "Warmly,",
    "The Bloomjoy Sweets Team",
  ];
  const text = textParts.join("\n");

  const html = `
    <!doctype html>
    <html lang="en">
      <body style="margin:0;padding:0;background:#fff7f9;font-family:Arial,Helvetica,sans-serif;color:#2f2430;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff7f9;padding:28px 0;">
          <tr>
            <td align="center" style="padding:0 16px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #f1d6de;border-radius:22px;overflow:hidden;">
                <tr>
                  <td style="background:#e96b8f;color:#ffffff;padding:26px 28px;">
                    <div style="font-size:12px;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;">Bloomjoy customer care</div>
                    <div style="font-size:28px;line-height:34px;font-weight:800;margin-top:8px;">We received your message</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px;">
                    <p style="font-size:15px;line-height:24px;margin:0 0 16px;">${
    escapeHtml(greeting)
  }</p>
                    <p style="font-size:15px;line-height:24px;margin:0 0 18px;">Thank you for reaching out. We are sorry something went wrong with your Bloomjoy experience, and we want to make the next step as easy as possible.</p>
                    <p style="font-size:15px;line-height:24px;margin:0 0 10px;">For a refund review, please use our short request form:</p>
                    <p style="margin:0 0 18px;"><a href="${
    escapeHtml(refundRequestUrl)
  }" style="color:#b83262;font-weight:800;">Open the refund request form</a></p>
                    <p style="font-size:14px;line-height:22px;margin:0 0 10px;color:#756877;">While we finish this transition, the current backup refund form remains available:</p>
                    <p style="margin:0 0 18px;"><a href="${
    escapeHtml(legacyRefundUrl)
  }" style="color:#b83262;font-weight:700;">Open the backup refund form</a></p>
                    <p style="font-size:14px;line-height:22px;margin:0 0 18px;color:#756877;">For troubleshooting or other support information, <a href="${
    escapeHtml(supportUrl)
  }" style="color:#b83262;font-weight:700;">visit Bloomjoy support resources</a>.</p>
                    <p style="font-size:15px;line-height:24px;margin:0 0 18px;">If you already submitted a form, there is no need to submit it again. Reply in this same conversation and we will keep your information together.</p>
                    ${
    safePublicReference
      ? `<p style="font-size:14px;line-height:22px;margin:0 0 18px;"><strong>Reference:</strong> ${
        escapeHtml(safePublicReference)
      }</p>`
      : ""
  }
                    <p style="font-size:13px;line-height:21px;margin:0;color:#756877;">For your safety, never email complete payment-card details, security codes, passwords, or wallet screenshots.</p>
                    <p style="font-size:14px;line-height:22px;margin:20px 0 0;color:#756877;">Warmly,<br />The Bloomjoy Sweets Team</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return {
    templateKey: REFUND_FIRST_CONTACT_TEMPLATE_KEY,
    subject,
    text,
    html,
  };
};
