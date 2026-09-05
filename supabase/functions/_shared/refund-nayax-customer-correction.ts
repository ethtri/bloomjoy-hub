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
  paymentInteraction,
  cardLast4Source,
  cardNetwork,
  walletProvider,
  walletDeviceKind,
  incidentTimeSource,
  candidates,
}: {
  recommendationState: string | null | undefined;
  cardWalletUsed?: boolean | null;
  paymentInteraction?: string | null;
  cardLast4Source?: string | null;
  cardNetwork?: string | null;
  walletProvider?: string | null;
  walletDeviceKind?: string | null;
  incidentTimeSource?: string | null;
  candidates: NayaxCustomerCorrectionCandidateEvidence[];
}): RefundMissingField[] => {
  // A targeted conflict may have been normalized to no_safe_match by a prior
  // sweep. The candidate evidence, not that status alone, must name a fact.
  if (
    !["manual_exception", "no_safe_match"].includes(recommendationState ?? "")
  ) return [];

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

  const fields: RefundMissingField[] = [];
  if (reasons.has("card_last4_mismatch")) {
    fields.push("card_last4");
    const interaction = (paymentInteraction ?? (cardWalletUsed ? "phone_watch_wallet" : "")).trim().toLowerCase();
    const source = (cardLast4Source ?? "").trim().toLowerCase();
    const wallet = interaction === "phone_watch_wallet";
    if (!interaction || interaction === "unsure" || interaction === "insert_or_swipe") fields.push("payment_interaction");
    if (!source || source === "unknown") fields.push("card_last4_source");
    if (!cardNetwork || cardNetwork === "other_unknown") fields.push("card_network");
    if (wallet) {
      if (!walletProvider || walletProvider === "unsure") fields.push("wallet_provider");
      if (!walletDeviceKind || walletDeviceKind === "unknown") fields.push("wallet_device_kind");
    }
    if (candidates.length > 1) fields.push("nearby_attempt_count");
  }
  if (reasons.has("amount_mismatch") || reasons.has("amount_uncertain")) {
    fields.push("amount");
    if (candidates.length > 1) fields.push("nearby_attempt_count");
  }
  if (
    reasons.has("incident_time_too_far") ||
    reasons.has("customer_time_rough")
  ) {
    fields.push("incident_time");
    if (!incidentTimeSource || incidentTimeSource === "unknown") fields.push("incident_time_source");
    if (candidates.length > 1) fields.push("nearby_attempt_count");
  }
  return sanitizeRefundMissingFields(fields);
};

const fieldRequest: Record<RefundMissingField, string> = {
  location_or_machine: "the machine or Bloomjoy location",
  incident_date: "the purchase date",
  incident_time: "the approximate purchase time, including AM or PM",
  payment_method: "whether you paid by card, Apple Pay, Google Pay, or cash",
  payment_interaction: "how you used the card or wallet",
  card_last4_source: "where you found the last four digits",
  wallet_provider: "the wallet provider, if you used a phone or watch wallet",
  wallet_device_kind: "whether you used a phone or watch",
  incident_time_source: "whether the time came from an alert or receipt, memory, or is unknown",
  nearby_attempt_count: "whether there was one nearby attempt or charge, more than one, or you are not sure",
  amount: "the exact amount charged",
  card_last4:
    "only the last four digits printed on the physical card you tapped",
  card_network: "the card type shown on the card or inside the wallet",
  zelle_payment_contact: "the Zelle email address or phone number",
};

const fieldReplyLine: Record<RefundMissingField, string> = {
  location_or_machine: "Machine or location:",
  incident_date: "Purchase date (YYYY-MM-DD):",
  incident_time: "Approximate purchase time (include AM or PM):",
  payment_method: "Payment method (card, Apple Pay, Google Pay, or cash):",
  payment_interaction:
    "Payment interaction (tap, insert, swipe, phone or watch wallet, or not sure):",
  card_last4_source:
    "Last-four source (physical card, wallet/device, bank record or alert, or not sure):",
  wallet_provider:
    "Wallet provider (Apple Pay, Google Wallet, other, or not sure):",
  wallet_device_kind: "Wallet device (phone, watch, or not sure):",
  incident_time_source: "Time source (alert or receipt, memory, or not sure):",
  nearby_attempt_count: "Nearby attempts or charges (one, more than one, or not sure):",
  amount: "Amount (for example, $7.25):",
  card_last4: "Card last four:",
  card_network:
    "Card type (Visa, Mastercard, Discover, American Express, or not sure):",
  zelle_payment_contact: "Zelle email or phone number:",
};

export const buildNayaxCustomerCorrectionEmail = (
  input: RefundCustomerEmailInput,
) => {
  if (input.correctionUrl) return buildRefundCustomerEmail(input);
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
    ...(fields.includes("card_last4") && !fields.includes("card_last4_source")
      ? ["Card last four source (physical card, wallet/device, bank record or alert, or not sure):"]
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
    "Do not send a full card number, security code, expiration date, PIN, password, or screenshot. You do not need to submit another request; we will keep working on this same one after your reply.",
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
  const delivery = await sendRefundTransactionalEmail({
    to: [input.customerEmail],
    cc: managerCcEmails,
    subject: email.subject,
    text: email.text,
    html: email.html,
    idempotencyKey: input.idempotencyKey,
  });
  return { ...email, delivery };
};
