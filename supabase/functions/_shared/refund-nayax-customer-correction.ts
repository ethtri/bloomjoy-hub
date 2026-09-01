import {
  buildEditableRefundCustomerEmail,
  buildRefundCustomerEmail,
  type RefundCustomerEmailInput,
  requireRefundManagerCcEmailsForSend,
  sendRefundTransactionalEmail,
} from "./refund-email.ts";
import {
  type RefundMissingField,
  sanitizeRefundMissingFields,
} from "./refund-deterministic-follow-up.ts";

export type NayaxCustomerCorrectionCandidateEvidence = {
  isTopRanked?: boolean | null;
  reasonCodes?: string[] | null;
  manualReviewReasons?: string[] | null;
  hardExclusions?: string[] | null;
};

const nayaxProviderOrSafetyReasons = new Set([
  "already_refunded",
  "currency_not_usd",
  "duplicate_provider_record",
  "duplicate_transaction",
  "missing_amount_evidence",
  "missing_canonical_machine_mapping",
  "missing_currency_evidence",
  "missing_provider_card_last4",
  "missing_provider_machine_id",
  "missing_provider_site_id",
  "payment_not_approved",
  "provider_machine_mismatch",
  "provider_status_unconfirmed",
]);

const asReasonSet = (values: Array<string[] | null | undefined>) =>
  new Set(
    values.flatMap((value) => Array.isArray(value) ? value : [])
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

export const deriveNayaxCustomerCorrectionFields = ({
  recommendationState,
  cardWalletUsed,
  candidates,
}: {
  recommendationState: string | null | undefined;
  cardWalletUsed: boolean | null | undefined;
  candidates: NayaxCustomerCorrectionCandidateEvidence[];
}): RefundMissingField[] => {
  if (recommendationState !== "manual_exception" || cardWalletUsed) return [];

  const topCandidate = candidates.find((candidate) => candidate.isTopRanked) ??
    candidates[0];
  if (!topCandidate) return [];

  const reasons = asReasonSet([
    topCandidate.reasonCodes,
    topCandidate.manualReviewReasons,
    topCandidate.hardExclusions,
  ]);
  if ([...reasons].some((reason) => nayaxProviderOrSafetyReasons.has(reason))) {
    return [];
  }

  const nonCustomerHardExclusions = (topCandidate.hardExclusions ?? [])
    .map((reason) => reason.trim().toLowerCase())
    .filter((reason) => reason && reason !== "card_last4_mismatch");
  if (nonCustomerHardExclusions.length > 0) return [];

  if (reasons.has("card_last4_mismatch")) {
    return ["card_last4"];
  }
  if (reasons.has("amount_mismatch") || reasons.has("amount_uncertain")) {
    return ["amount"];
  }
  if (
    reasons.has("incident_time_too_far") ||
    reasons.has("customer_time_within_1_hour") ||
    reasons.has("customer_time_rough")
  ) {
    return ["incident_time"];
  }

  return [];
};

const fieldRequest: Record<RefundMissingField, string> = {
  location_or_machine: "the machine or Bloomjoy location",
  incident_date: "the purchase date",
  incident_time: "the approximate purchase time, including AM or PM",
  payment_method: "whether you paid by card, Apple Pay, Google Pay, or cash",
  payment_interaction: "how you used the card or wallet",
  wallet_provider: "the wallet provider, if you used a phone or watch wallet",
  amount: "the exact amount charged",
  card_last4:
    "only the last four digits printed on the physical card you tapped",
  card_network: "the card type shown on the card or inside the wallet",
};

const fieldReplyLine: Record<RefundMissingField, string> = {
  location_or_machine: "Machine or location:",
  incident_date: "Purchase date (YYYY-MM-DD):",
  incident_time: "Approximate purchase time (include AM or PM):",
  payment_method: "Payment method (card, Apple Pay, Google Pay, or cash):",
  payment_interaction:
    "Payment interaction (tap card, insert or swipe, phone or watch wallet, or not sure):",
  wallet_provider:
    "Wallet provider (Apple Pay, Google Wallet, other, or not sure):",
  amount: "Amount (for example, $7.25):",
  card_last4: "Card last four:",
  card_network:
    "Card type (Visa, Mastercard, Discover, American Express, or not sure):",
};

export const buildNayaxCustomerCorrectionEmail = (
  input: RefundCustomerEmailInput,
) => {
  const fields = sanitizeRefundMissingFields(input.missingFields);
  if (fields.length === 0) return buildRefundCustomerEmail(input);
  if (input.cardWalletUsed && fields.includes("card_last4")) {
    throw new Error(
      "Mobile-wallet last-four corrections must use the secure correction flow, not email.",
    );
  }

  const requestedDetails = fields.map((field) => fieldRequest[field]).join(
    "; ",
  );
  const replyLines = [
    ...fields.map((field) => fieldReplyLine[field]),
    ...(fields.includes("card_last4")
      ? ["Card last four source (physical card only): physical card"]
      : []),
  ].join("\n");
  const reminder = input.messageType === "reminder";
  const replyLineInstruction = fields.length === 1
    ? "copy this line into your reply and add only the requested detail"
    : "copy these lines into your reply and add only the requested details";
  const subject = reminder
    ? `Still here to help with your Bloomjoy refund request ${input.publicReference}`
    : `One quick detail check for your Bloomjoy refund request ${input.publicReference}`;
  const body = [
    reminder
      ? "We are checking in once because we still want to help with your refund request. There is no need to resend the information you already shared."
      : "Thank you for the details you shared. We found nearby machine transactions, but the information did not identify one purchase safely. This does not mean you did anything wrong.",
    `Please reply with ${requestedDetails}. If you are not sure, say "not sure".`,
    `For the fastest automatic update, ${replyLineInstruction}:\n${replyLines}`,
    "If you used a physical card, use only the last four digits printed on the exact physical card you tapped. If you used a phone or watch wallet, do not send wallet or device-token digits by email; we will provide a secure correction step if those digits are needed. Do not send a full card number, security code, expiration date, PIN, password, or screenshot. You do not need to submit another form; we will recheck this same request after your reply.",
  ].join("\n\n");

  return buildEditableRefundCustomerEmail({ input, subject, body });
};

export const sendNayaxCustomerCorrectionEmail = async (
  input: RefundCustomerEmailInput,
) => {
  const email = buildNayaxCustomerCorrectionEmail(input);
  const managerCcEmails = requireRefundManagerCcEmailsForSend(
    input.managerCcEmails,
    input.customerEmail,
    input.managerRecipientOverlap,
    input.managerRecipientCount,
  );
  await sendRefundTransactionalEmail({
    to: [input.customerEmail],
    cc: managerCcEmails,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
  return email;
};
