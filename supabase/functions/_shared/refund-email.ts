import { sendTransactionalEmail } from "./internal-email.ts";
import { resolveRefundPublicLabels } from "./refund-location.ts";
import { getRefundGmailMailboxIdentities } from "./refund-gmail.ts";
import {
  REFUND_DETERMINISTIC_FOLLOW_UP_VERSION,
  type RefundFollowUpReason,
  type RefundMissingField,
  sanitizeRefundMissingFields,
} from "./refund-deterministic-follow-up.ts";
import {
  type RefundBrandDetail,
  renderBloomjoyRefundEmail,
  renderBloomjoyRefundStoredText,
} from "./refund-email-brand.ts";

export {
  REFUND_DETERMINISTIC_FOLLOW_UP_VERSION,
  type RefundMissingField,
  sanitizeRefundMissingFields,
} from "./refund-deterministic-follow-up.ts";

export type RefundCustomerMessageType =
  | "confirmation"
  | "more_info"
  | "reminder"
  | "no_safe_match"
  | "information_received"
  | "wallet_correction"
  | "wallet_correction_reminder"
  | "status_update"
  | "approved"
  | "denied"
  | "appeal_received"
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
  missingFields?: RefundMissingField[];
  followUpReason?: RefundFollowUpReason;
  incidentLocalDateTime?: string | null;
  cardWalletUsed?: boolean;
  cardLast4?: string | null;
  managerCcEmails?: string[];
};

const refundMissingFieldRequest: Record<RefundMissingField, string> = {
  location_or_machine: "the machine or Bloomjoy location",
  incident_date: "the purchase date",
  incident_time: "the approximate purchase time, including AM or PM",
  payment_method: "whether you paid by card, Apple Pay, Google Pay, or cash",
  amount: "the exact amount charged",
  card_last4:
    "only the last four digits shown on the card charge (do not email wallet or device-card digits)",
};

const refundMissingFieldReplyLine: Record<RefundMissingField, string> = {
  location_or_machine: "Machine or location:",
  incident_date: "Purchase date (YYYY-MM-DD):",
  incident_time: "Approximate purchase time (include AM or PM):",
  payment_method: "Payment method (card, Apple Pay, Google Pay, or cash):",
  amount: "Amount (for example, $7.25):",
  card_last4: "Card last four:",
};

export const describeRefundMissingFields = (value: unknown) =>
  sanitizeRefundMissingFields(value).map((field) =>
    refundMissingFieldRequest[field]
  );

const sanitizeText = (value: unknown, maxLength = 800) =>
  typeof value === "string" || typeof value === "number" ||
    typeof value === "boolean"
    ? String(value).trim().slice(0, maxLength)
    : "";

const REFUND_MANAGER_CC_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export const requireRefundManagerCcEmailsForSend = (
  managerCcEmails: string[] | undefined,
  customerEmail: string,
) => {
  if (!Array.isArray(managerCcEmails)) {
    throw new Error(
      "Refund customer email requires at least one current mapped Machine Manager in CC.",
    );
  }

  const normalized = managerCcEmails.map((email) => email.trim().toLowerCase());
  const excluded = new Set([
    customerEmail.trim().toLowerCase(),
    ...getRefundGmailMailboxIdentities(),
  ]);
  if (
    normalized.length < 1 ||
    normalized.length > 3 ||
    new Set(normalized).size !== normalized.length ||
    normalized.some((email) =>
      email.length > 320 ||
      !REFUND_MANAGER_CC_PATTERN.test(email) ||
      excluded.has(email)
    )
  ) {
    throw new Error(
      "Refund customer email requires at least one current mapped Machine Manager in CC.",
    );
  }

  return normalized;
};

export const getRefundReplyToEmail = () =>
  sanitizeText(Deno.env.get("REFUND_REPLY_TO_EMAIL"), 320) ||
  "info@bloomjoysweets.com";

export const sanitizeRefundMessageType = (
  value: unknown,
): RefundCustomerMessageType | null => {
  const normalized = sanitizeText(value, 80).toLowerCase();
  if (
    normalized === "confirmation" ||
    normalized === "more_info" ||
    normalized === "reminder" ||
    normalized === "no_safe_match" ||
    normalized === "information_received" ||
    normalized === "wallet_correction" ||
    normalized === "wallet_correction_reminder" ||
    normalized === "status_update" ||
    normalized === "approved" ||
    normalized === "denied" ||
    normalized === "appeal_received" ||
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

const getSubject = (
  messageType: RefundCustomerMessageType,
  publicReference: string,
) => {
  switch (messageType) {
    case "more_info":
      return `A quick detail check for your Bloomjoy refund request ${publicReference}`;
    case "reminder":
      return `Still here to help with your Bloomjoy refund request ${publicReference}`;
    case "no_safe_match":
      return `A careful check of your Bloomjoy refund request ${publicReference}`;
    case "information_received":
      return `We added your information to Bloomjoy refund request ${publicReference}`;
    case "wallet_correction":
      return `Please check your mobile-wallet card details for refund request ${publicReference}`;
    case "wallet_correction_reminder":
      return `Reminder: check your mobile-wallet card details for ${publicReference}`;
    case "approved":
      return `Your Bloomjoy refund request ${publicReference} was approved`;
    case "denied":
      return `Update on your Bloomjoy refund request ${publicReference}`;
    case "appeal_received":
      return `We are reviewing your reply about ${publicReference}`;
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
    case "no_safe_match":
      return "We checked carefully";
    case "information_received":
      return "Thank you for the added details";
    case "wallet_correction":
    case "wallet_correction_reminder":
      return "One quick wallet detail check";
    case "approved":
      return "Your request was approved";
    case "denied":
      return "An update from our team";
    case "appeal_received":
      return "We received your reply";
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
  missingFields,
  followUpReason,
  cardWalletUsed,
  cardLast4,
  decisionReason,
}: RefundCustomerEmailInput) => {
  const refundAmount = formatCurrency(refundAmountCents);
  const amountPhrase = refundAmount ? ` for ${refundAmount}` : "";
  const isCash = paymentMethod === "cash";
  const missingFieldRequests = describeRefundMissingFields(missingFields);
  const requestedDetails = missingFieldRequests.join("; ");
  const replyLines = sanitizeRefundMissingFields(missingFields)
    .map((field) => refundMissingFieldReplyLine[field])
    .join("\n");

  if (
    cardWalletUsed &&
    sanitizeRefundMissingFields(missingFields).includes("card_last4")
  ) {
    throw new Error(
      "Mobile-wallet last-four corrections must use the secure correction flow, not email.",
    );
  }

  switch (messageType) {
    case "more_info":
      if (missingFieldRequests.length === 0) {
        throw new Error(
          "A deterministic missing-field list is required for a more-information message.",
        );
      }
      return [
        "Thank you again for reaching out. We are sorry this needs another step, and we want to make sure we review the right transaction.",
        `Please reply with ${requestedDetails}.`,
        `For the fastest automatic update, copy these lines into your reply and fill in only the blanks:\n${replyLines}`,
        "Please do not send a full card number, security code, expiration date, PIN, password, or payment-screen screenshot. Once we receive the requested details, we will continue the review and keep ownership of the next step.",
      ];
    case "reminder":
      if (followUpReason === "no_safe_match") {
        if (missingFieldRequests.length > 0) {
          return [
            "We are checking in once because we still want to help with your refund request. There is no need to resend the information you already shared.",
            `Please reply with ${requestedDetails} so we can safely identify the purchase.`,
            `For the fastest automatic update, copy these lines into your reply and correct or confirm each one:\n${replyLines}`,
            "For your safety, please never send a full card number, security code, expiration date, PIN, password, wallet digits, or screenshot.",
          ];
        }
        return [
          "We are checking in once because we still want to help with your refund request. There is no need to resend the information you already shared.",
          "Please reply only if any detail shown below needs a correction, such as the machine or location, purchase date or approximate time, amount, or payment method. If everything is correct, no action is needed from you and a person will continue the review.",
          "For your safety, please never send a full card number, security code, expiration date, PIN, password, wallet digits, or screenshot.",
        ];
      }
      if (missingFieldRequests.length === 0) {
        throw new Error(
          "A deterministic missing-field list is required for a reminder message.",
        );
      }
      return [
        "We are checking in once because we still need the specific details below to continue the review. There is no need to resend anything else.",
        `When you have a moment, please reply with ${requestedDetails}.`,
        "For your safety, please never send a full card number, security code, expiration date, PIN, password, or payment-screen screenshot.",
      ];
    case "no_safe_match":
      if (missingFieldRequests.length > 0) {
        return [
          "Thank you for the details you shared. We found nearby machine transactions, but the information did not identify one purchase safely. This does not mean you did anything wrong.",
          `Please reply with ${requestedDetails}. If you used a physical card, also tell us whether it was Visa, Mastercard, Discover, American Express, or another card type.`,
          `Copy these lines into your reply and correct or confirm each one:\n${replyLines}`,
          "Please use the last four digits printed on the exact physical card you tapped. Do not send a full card number, security code, expiration date, PIN, password, wallet digits, or screenshot. You do not need to submit another form; we will recheck this same request after your reply.",
        ];
      }
      return [
        "Thank you for the details you shared. We checked the available machine transaction records carefully, but we could not identify one transaction that we can safely match to your request yet. This does not mean you did anything wrong.",
        "Please reply only if any of the details shown below need a correction, such as the machine or location, purchase date or approximate time, amount, or payment method.",
        "Please do not send a full card number, security code, expiration date, PIN, password, or screenshot. We will take another careful look after any correction, and a person will review the case if there still is not one clear match.",
      ];
    case "information_received":
      return [
        "Thank you for sending the additional information. We added it to your refund request, so you do not need to resend it.",
        "Our team will check the updated details against the available transaction records. This message confirms receipt only. It is not yet a refund decision and is not a promise that a payment has been completed.",
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
      if (!sanitizeRefundCustomerSafeDenialReason(decisionReason)) {
        throw new Error(
          "A customer-safe denial reason is required for a denial message.",
        );
      }
      return [
        "Thank you for giving us the chance to review this. We were not able to approve the refund.",
        `Here is the reason we can share: ${
          sanitizeRefundCustomerSafeDenialReason(decisionReason)
        }`,
        "If we missed or misunderstood something, please reply in this same conversation. We will reopen this request for another review, and your reply will never issue a payment automatically.",
        "We are sorry this visit was frustrating, and we appreciate you reaching out.",
      ];
    case "appeal_received":
      return [
        "Thank you for replying. We reopened this same refund request so a manager can review what you shared.",
        "You do not need to submit another form. This message confirms that your appeal was received; it is not a refund approval and cannot issue a payment automatically.",
        "We will keep the original request and conversation together and follow up after the review.",
      ];
    case "completed": {
      const maskedCard = sanitizeText(cardLast4, 4);
      return [
        "Good news—your refund request was approved, and your refund is on its way.",
        `We issued your refund${amountPhrase}${
          !isCash && /^\d{4}$/.test(maskedCard)
            ? ` to the card ending in ${maskedCard}`
            : ""
        }.`,
        isCash
          ? "The Zelle payment has been sent. Please allow normal bank processing time for it to appear."
          : "Your bank or card issuer may take up to 4 business days to show the credit. If it is not visible after that, reply to this email and include your reference below.",
        "Thank you for letting us help make this right.",
      ];
    }
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

const refundDenialProhibitedPatterns = [
  /\b(?:internal|risk score|fraud score|nayax|provider error|api|token|secret|database|sql|stack trace)\b/iu,
  /(?:https?:\/\/|\/refunds\?case=)/iu,
  /\b(?:\d[ -]*?){12,19}\b/u,
];

export const sanitizeRefundCustomerSafeDenialReason = (value: unknown) => {
  const normalized = sanitizeText(value, 360).replace(/\s+/gu, " ");
  if (
    normalized.length < 8 ||
    refundDenialProhibitedPatterns.some((pattern) => pattern.test(normalized))
  ) {
    return "";
  }
  return /[.!?]$/u.test(normalized) ? normalized : `${normalized}.`;
};

export const buildRefundCustomerEmail = (input: RefundCustomerEmailInput) => {
  const publicReference = sanitizeText(input.publicReference, 80);
  const customerName = sanitizeText(input.customerName, 160);
  const { machineLabel, locationName } = resolveRefundPublicLabels({
    machineLabel: input.machineLabel,
    locationName: input.locationName,
  });
  const subject = getSubject(input.messageType, publicReference);
  const greeting = customerName ? `Hi ${customerName},` : "Hi there,";
  const paragraphs = getBodyParagraphs(input);
  const details = [`Reference: ${publicReference}`];
  if (machineLabel) details.push(`Machine: ${machineLabel}`);
  if (locationName) details.push(`Location: ${locationName}`);
  const refundAmount = formatCurrency(input.refundAmountCents);
  if (refundAmount) {
    const amountLabel =
      input.messageType === "approved" || input.messageType === "completed"
        ? "Refund amount"
        : "Reported amount";
    details.push(`${amountLabel}: ${refundAmount}`);
  }
  const incidentLocalDateTime = sanitizeText(input.incidentLocalDateTime, 40);
  if (incidentLocalDateTime) {
    details.push(`Reported purchase time: ${incidentLocalDateTime}`);
  }
  if (input.paymentMethod === "card") {
    details.push("Payment method: Card or mobile wallet");
  }
  if (input.paymentMethod === "cash") details.push("Payment method: Cash");

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
  const brandDetails: RefundBrandDetail[] = details.map((detail) => {
    const [label, ...valueParts] = detail.split(": ");
    return { label, value: valueParts.join(": ") };
  });
  const html = renderBloomjoyRefundEmail({
    preheader: subject,
    eyebrow: "Bloomjoy refund request",
    headline: getHeadline(input.messageType),
    greeting,
    paragraphs,
    details: brandDetails,
    replyLine: input.messageType === "denied"
      ? "Reply in this same conversation if we missed or misunderstood something."
      : "You can reply directly to this email if anything looks off.",
  });

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
  const safeSubjectBase = sanitizeText(subject, 180) ||
    getSubject(input.messageType, publicReference);
  const finalSubject =
    safeSubjectBase.toLowerCase().includes(publicReference.toLowerCase())
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
    const amountLabel = ["approved", "completed"].includes(input.messageType)
      ? "Refund amount"
      : "Reported amount";
    details.push(`${amountLabel}: ${refundAmount}`);
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

  const brandDetails: RefundBrandDetail[] = details.map((detail) => {
    const [label, ...valueParts] = detail.split(": ");
    return { label, value: valueParts.join(": ") };
  });
  const html = renderBloomjoyRefundEmail({
    preheader: finalSubject,
    eyebrow: "Bloomjoy refund request",
    headline: getHeadline(input.messageType),
    greeting,
    paragraphs,
    details: brandDetails,
    replyLine:
      "Please reply to this email if anything looks off. Replies go to our Bloomjoy support inbox.",
  });

  return { subject: finalSubject, text, html };
};

export const sendRefundCustomerEmail = async (
  input: RefundCustomerEmailInput,
) => {
  const email = buildRefundCustomerEmail(input);
  const managerCcEmails = requireRefundManagerCcEmailsForSend(
    input.managerCcEmails,
    input.customerEmail,
  );
  await sendTransactionalEmail({
    to: [input.customerEmail],
    cc: managerCcEmails,
    subject: email.subject,
    text: email.text,
    html: email.html,
    replyTo: getRefundReplyToEmail(),
  });

  return email;
};

export const buildBrandedRefundHtmlFromStoredText =
  renderBloomjoyRefundStoredText;

export type RefundWalletCorrectionEmailInput = {
  publicReference: string;
  customerName?: string | null;
  customerEmail: string;
  machineLabel?: string | null;
  locationName?: string | null;
  correctionUrl: string;
  reminder?: boolean;
  managerCcEmails?: string[];
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

  const brandDetails: RefundBrandDetail[] = details.map((detail) => {
    const [label, ...valueParts] = detail.split(": ");
    return { label, value: valueParts.join(": ") };
  });
  const html = renderBloomjoyRefundEmail({
    preheader: subject,
    eyebrow: "Bloomjoy refund request",
    headline: "One quick wallet detail check",
    greeting,
    paragraphs: [
      intro,
      "Enter only the virtual card's last four digits, your approximate purchase time, and confirmation of the amount.",
      "After you submit it, our system will automatically check the corrected details against the machine transactions.",
    ],
    details: brandDetails,
    primaryLink: { label: "Check my wallet details", url: correctionUrl },
    safetyLine:
      "Do not send a full card number, security code, expiration date, wallet password, or screenshot. This link expires in 48 hours and can be used once.",
  });

  return { subject, text, html };
};

export const sendRefundWalletCorrectionEmail = async (
  input: RefundWalletCorrectionEmailInput,
) => {
  const email = buildRefundWalletCorrectionEmail(input);
  const managerCcEmails = requireRefundManagerCcEmailsForSend(
    input.managerCcEmails,
    input.customerEmail,
  );
  await sendTransactionalEmail({
    to: [input.customerEmail],
    cc: managerCcEmails,
    subject: email.subject,
    text: email.text,
    html: email.html,
    replyTo: getRefundReplyToEmail(),
  });

  return email;
};
