import { sendTransactionalEmail } from "./internal-email.ts";
import { resolveRefundPublicLabels } from "./refund-location.ts";

export type RefundCustomerMessageType =
  | "confirmation"
  | "more_info"
  | "reminder"
  | "wallet_correction"
  | "wallet_correction_reminder"
  | "status_update"
  | "approved"
  | "denied"
  | "completed";

export type RefundCustomerEmailInput = {
  messageType: RefundCustomerMessageType;
  publicReference: string;
  customerName?: string | null;
  customerEmail: string;
  machineLabel?: string | null;
  locationName?: string | null;
  refundAmountCents?: number | null;
  paymentMethod?: string | null;
  decisionReason?: string | null;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const sanitizeText = (value: unknown, maxLength = 800) =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value).trim().slice(0, maxLength)
    : "";

export const getRefundReplyToEmail = () =>
  sanitizeText(Deno.env.get("REFUND_REPLY_TO_EMAIL"), 320) || "info@bloomjoysweets.com";

export const sanitizeRefundMessageType = (value: unknown): RefundCustomerMessageType | null => {
  const normalized = sanitizeText(value, 80).toLowerCase();
  if (
    normalized === "confirmation" ||
    normalized === "more_info" ||
    normalized === "reminder" ||
    normalized === "wallet_correction" ||
    normalized === "wallet_correction_reminder" ||
    normalized === "status_update" ||
    normalized === "approved" ||
    normalized === "denied" ||
    normalized === "completed"
  ) {
    return normalized;
  }

  return null;
};

const formatCurrency = (cents?: number | null) => {
  if (typeof cents !== "number") return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
};

const getSubject = (messageType: RefundCustomerMessageType, publicReference: string) => {
  switch (messageType) {
    case "more_info":
      return `A quick detail check for your Bloomjoy refund request ${publicReference}`;
    case "reminder":
      return `Still here to help with your Bloomjoy refund request ${publicReference}`;
    case "wallet_correction":
      return `Please check your mobile-wallet card details for refund request ${publicReference}`;
    case "wallet_correction_reminder":
      return `Reminder: check your mobile-wallet card details for ${publicReference}`;
    case "approved":
      return `Your Bloomjoy refund request ${publicReference} was approved`;
    case "denied":
      return `Update on your Bloomjoy refund request ${publicReference}`;
    case "completed":
      return `Your Bloomjoy refund request ${publicReference} is complete`;
    case "status_update":
      return `We are still reviewing your Bloomjoy refund request ${publicReference}`;
    case "confirmation":
    default:
      return `We received your Bloomjoy refund request ${publicReference}`;
  }
};

const getHeadline = (messageType: RefundCustomerMessageType) => {
  switch (messageType) {
    case "more_info":
      return "A tiny bit more information";
    case "reminder":
      return "We are still here to help";
    case "wallet_correction":
    case "wallet_correction_reminder":
      return "One quick wallet detail check";
    case "approved":
      return "Your request was approved";
    case "denied":
      return "An update from our team";
    case "completed":
      return "Your refund step is complete";
    case "status_update":
      return "Your review is still moving";
    case "confirmation":
    default:
      return "We received your request";
  }
};

const getBodyParagraphs = ({
  messageType,
  refundAmountCents,
  paymentMethod,
  decisionReason,
}: RefundCustomerEmailInput) => {
  const refundAmount = formatCurrency(refundAmountCents);
  const amountPhrase = refundAmount ? ` for ${refundAmount}` : "";
  const isCash = paymentMethod === "cash";

  switch (messageType) {
    case "more_info":
      return [
        "Thank you again for reaching out. We want to review this carefully, and we need one more detail before we can confidently match the request to a machine transaction.",
        "Please reply with anything that may help, such as the exact purchase time, amount paid, card last 4 shown on the charge, or a photo of the machine/payment screen.",
        "Once we have that, our team will continue the review. Our target is to complete refund reviews within 5 business days.",
      ];
    case "reminder":
      return [
        "We are checking in because we still need one more detail to finish reviewing your request.",
        "If you have the exact purchase time, amount paid, card last 4 shown on the charge, or a photo of the machine/payment screen, please reply here and we will continue the review.",
      ];
    case "wallet_correction":
    case "wallet_correction_reminder":
      return [
        "A mobile wallet such as Apple Pay or Google Pay can show different last four digits than the physical card. That may be why we could not confidently match your purchase yet.",
        "Use the secure link in this email to enter only the last four digits shown for the card inside your mobile wallet and your approximate purchase time.",
        "Please do not send a full card number, security code, expiration date, wallet password, or screenshot. We will automatically check the corrected details against the machine transactions.",
      ];
    case "approved":
      return [
        `Good news: our team approved your refund request${amountPhrase}.`,
        isCash
          ? "The next step is a Zelle refund from our team. We will use the Zelle contact shared with the request."
          : "The next step is refund completion through our payment provider. We will send another update once that action is complete.",
        "Thanks for giving us the chance to make this right.",
      ];
    case "denied":
      return [
        "Thank you for giving us the chance to review this. We were not able to approve the refund based on the transaction and machine information available.",
        decisionReason
          ? `Our review note: ${decisionReason}`
          : "If any of the details were submitted incorrectly, please reply and we will take another careful look.",
        "We are sorry this visit was frustrating, and we appreciate you reaching out.",
      ];
    case "completed":
      return [
        `Your approved refund request${amountPhrase} has been marked complete by our team.`,
        isCash
          ? "For Zelle, please allow normal bank processing time after the payment is sent."
          : "For card refunds, your bank or card issuer may take a little additional time to show the credit.",
        "Thank you for letting us help make this right.",
      ];
    case "status_update":
      return [
        "We are still reviewing your request and have not forgotten about you.",
        "Our team is checking the transaction and machine details with care. Our target is to complete refund reviews within 5 business days.",
      ];
    case "confirmation":
    default:
      return [
        "Thank you for reaching out. We are sorry the Bloomjoy experience did not go the way it should have, and we have opened a refund request for you.",
        "Our team will review the transaction details and follow up as soon as we have the next step.",
        "Our target is to complete refund reviews within 5 business days.",
      ];
  }
};

export const buildRefundCustomerEmail = (input: RefundCustomerEmailInput) => {
  const publicReference = sanitizeText(input.publicReference, 80);
  const customerName = sanitizeText(input.customerName, 160);
  const { machineLabel, locationName } = resolveRefundPublicLabels({
    machineLabel: input.machineLabel,
    locationName: input.locationName,
  });
  const decisionReason = sanitizeText(input.decisionReason, 500);
  const subject = getSubject(input.messageType, publicReference);
  const greeting = customerName ? `Hi ${customerName},` : "Hi there,";
  const paragraphs = getBodyParagraphs({
    ...input,
    decisionReason,
  });
  const details = [`Reference: ${publicReference}`];
  if (machineLabel) details.push(`Machine: ${machineLabel}`);
  if (locationName) details.push(`Location: ${locationName}`);
  const refundAmount = formatCurrency(input.refundAmountCents);
  if (refundAmount) {
    details.push(`Refund amount: ${refundAmount}`);
  }

  const text = [
    greeting,
    "",
    ...paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...details,
    "",
    "You can reply directly to this email if anything looks off.",
    "",
    "Warmly,",
    "The Bloomjoy Sweets Team",
  ].join("\n");

  const htmlParagraphs = paragraphs
    .map((paragraph) =>
      `<p style="font-size:15px;line-height:24px;margin:0 0 16px;">${escapeHtml(paragraph)}</p>`
    )
    .join("");
  const detailRows = details
    .map((detail) => {
      const [label, ...valueParts] = detail.split(": ");
      return `<tr><td style="font-size:13px;color:#756877;padding:4px 0;">${escapeHtml(label)}</td><td style="font-size:14px;font-weight:700;text-align:right;padding:4px 0;">${escapeHtml(valueParts.join(": "))}</td></tr>`;
    })
    .join("");

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
                    <div style="font-size:12px;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;">Bloomjoy refund request</div>
                    <div style="font-size:28px;line-height:34px;font-weight:800;margin-top:8px;">${escapeHtml(getHeadline(input.messageType))}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px;">
                    <p style="font-size:15px;line-height:24px;margin:0 0 16px;">${escapeHtml(greeting)}</p>
                    ${htmlParagraphs}
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #f1d6de;border-radius:16px;background:#fff3f7;padding:16px;margin:0 0 18px;">
                      ${detailRows}
                    </table>
                    <p style="font-size:14px;line-height:22px;margin:0;color:#756877;">You can reply directly to this email if anything looks off.</p>
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

  return { subject, text, html };
};

export const buildEditableRefundCustomerEmail = ({
  input,
  subject,
  body,
}: {
  input: RefundCustomerEmailInput;
  subject: string;
  body: string;
}) => {
  const publicReference = sanitizeText(input.publicReference, 80);
  const customerName = sanitizeText(input.customerName, 160);
  const { machineLabel, locationName } = resolveRefundPublicLabels({
    machineLabel: input.machineLabel,
    locationName: input.locationName,
  });
  const greeting = customerName ? `Hi ${customerName},` : "Hi there,";
  const safeSubjectBase = sanitizeText(subject, 180) || getSubject(input.messageType, publicReference);
  const finalSubject = safeSubjectBase.toLowerCase().includes(publicReference.toLowerCase())
    ? safeSubjectBase
    : `${safeSubjectBase} - ${publicReference}`;
  const sanitizedBody = sanitizeText(body, 4000);
  const paragraphs = sanitizedBody
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const details = [`Reference: ${publicReference}`];
  if (machineLabel) details.push(`Machine: ${machineLabel}`);
  if (locationName) details.push(`Location: ${locationName}`);
  const refundAmount = formatCurrency(input.refundAmountCents);
  if (refundAmount) {
    details.push(`Refund amount: ${refundAmount}`);
  }

  const text = [
    greeting,
    "",
    ...paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...details,
    "",
    "Please reply to this email if anything looks off. Replies go to our Bloomjoy support inbox.",
    "",
    "Warmly,",
    "The Bloomjoy Sweets Team",
  ].join("\n");

  const htmlParagraphs = paragraphs
    .map((paragraph) =>
      `<p style="font-size:15px;line-height:24px;margin:0 0 16px;">${escapeHtml(paragraph)}</p>`
    )
    .join("");
  const detailRows = details
    .map((detail) => {
      const [label, ...valueParts] = detail.split(": ");
      return `<tr><td style="font-size:13px;color:#756877;padding:4px 0;">${escapeHtml(label)}</td><td style="font-size:14px;font-weight:700;text-align:right;padding:4px 0;">${escapeHtml(valueParts.join(": "))}</td></tr>`;
    })
    .join("");

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
                    <div style="font-size:12px;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;">Bloomjoy refund request</div>
                    <div style="font-size:28px;line-height:34px;font-weight:800;margin-top:8px;">${escapeHtml(getHeadline(input.messageType))}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px;">
                    <p style="font-size:15px;line-height:24px;margin:0 0 16px;">${escapeHtml(greeting)}</p>
                    ${htmlParagraphs}
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #f1d6de;border-radius:16px;background:#fff3f7;padding:16px;margin:0 0 18px;">
                      ${detailRows}
                    </table>
                    <p style="font-size:14px;line-height:22px;margin:0;color:#756877;">Please reply to this email if anything looks off. Replies go to our Bloomjoy support inbox.</p>
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

  return { subject: finalSubject, text, html };
};

export const sendRefundCustomerEmail = async (input: RefundCustomerEmailInput) => {
  const email = buildRefundCustomerEmail(input);
  await sendTransactionalEmail({
    to: [input.customerEmail],
    subject: email.subject,
    text: email.text,
    html: email.html,
    replyTo: getRefundReplyToEmail(),
  });

  return email;
};

export type RefundWalletCorrectionEmailInput = {
  publicReference: string;
  customerName?: string | null;
  customerEmail: string;
  machineLabel?: string | null;
  locationName?: string | null;
  correctionUrl: string;
  reminder?: boolean;
};

export const buildRefundWalletCorrectionEmail = (
  input: RefundWalletCorrectionEmailInput,
) => {
  const publicReference = sanitizeText(input.publicReference, 80);
  const customerName = sanitizeText(input.customerName, 160);
  const correctionUrl = sanitizeText(input.correctionUrl, 1200);
  const { machineLabel, locationName } = resolveRefundPublicLabels({
    machineLabel: input.machineLabel,
    locationName: input.locationName,
  });
  const greeting = customerName ? `Hi ${customerName},` : "Hi there,";
  const subject = input.reminder
    ? `Reminder: check your mobile-wallet card details for ${publicReference}`
    : `Please check your mobile-wallet card details for ${publicReference}`;
  const intro = input.reminder
    ? "This is the one reminder for the secure wallet-detail check on your refund request."
    : "A mobile wallet such as Apple Pay or Google Pay can show different last four digits than the physical card. That may be why we could not confidently match your purchase yet.";
  const details = [`Reference: ${publicReference}`];
  if (machineLabel) details.push(`Machine: ${machineLabel}`);
  if (locationName) details.push(`Location: ${locationName}`);

  const text = [
    greeting,
    "",
    intro,
    "",
    "Open the secure form below and enter only the last four digits shown for the card inside your mobile wallet, your approximate purchase time, and confirmation of the amount.",
    "",
    correctionUrl,
    "",
    "Please do not send a full card number, security code, expiration date, wallet password, or screenshot. The link expires in 48 hours and can be used once.",
    "",
    ...details,
    "",
    "After you submit it, our system will automatically check the corrected details against the machine transactions.",
    "",
    "Warmly,",
    "The Bloomjoy Sweets Team",
  ].join("\n");

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
                    <div style="font-size:12px;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;">Bloomjoy refund request</div>
                    <div style="font-size:28px;line-height:34px;font-weight:800;margin-top:8px;">One quick wallet detail check</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px;">
                    <p style="font-size:15px;line-height:24px;margin:0 0 16px;">${escapeHtml(greeting)}</p>
                    <p style="font-size:15px;line-height:24px;margin:0 0 16px;">${escapeHtml(intro)}</p>
                    <p style="font-size:15px;line-height:24px;margin:0 0 22px;">Enter only the virtual card's last four digits, your approximate purchase time, and confirmation of the amount.</p>
                    <p style="margin:0 0 22px;">
                      <a href="${escapeHtml(correctionUrl)}" style="display:inline-block;background:#d94f79;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;padding:14px 22px;border-radius:999px;">Check my wallet details</a>
                    </p>
                    <p style="font-size:13px;line-height:21px;margin:0 0 18px;color:#756877;">Do not send a full card number, security code, expiration date, wallet password, or screenshot. This link expires in 48 hours and can be used once.</p>
                    <p style="font-size:14px;line-height:22px;margin:0;color:#756877;">After you submit it, our system will automatically check the corrected details against the machine transactions.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return { subject, text, html };
};

export const sendRefundWalletCorrectionEmail = async (
  input: RefundWalletCorrectionEmailInput,
) => {
  const email = buildRefundWalletCorrectionEmail(input);
  await sendTransactionalEmail({
    to: [input.customerEmail],
    subject: email.subject,
    text: email.text,
    html: email.html,
    replyTo: getRefundReplyToEmail(),
  });

  return email;
};
