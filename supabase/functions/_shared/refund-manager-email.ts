import type { RefundManagerNotificationReason } from "./refund-manager-notification.ts";

const SAFE_ACTION_PATTERN = /^[a-z0-9_]{1,80}$/;
const SAFE_ACTOR_PATTERN = /^(system|manager)$/;
const SAFE_OWNER_PATTERN = /^(Machine Manager|Refund Operations)$/;
const SAFE_PAYMENT_METHOD_PATTERN = /^(card|cash|not_recorded)$/;
const SAFE_CONTEXT_KEYS = [
  "actionCode",
  "actionOwner",
  "ageMinutes",
  "amountCents",
  "currencyCode",
  "lifecycleActor",
  "locationName",
  "machineLabel",
  "paymentMethodCategory",
  "payloadRedacted",
  "publicReference",
  "queueLabel",
  "schemaVersion",
  "whatChanged",
] as const;

export const REFUND_MANAGER_ACTION_EMAIL_SCHEMA_VERSION =
  "refund_manager_action_email_v1";
export const REFUND_MANAGER_ACTION_EMAIL_TEMPLATE_VERSION =
  "refund_manager_action_email_v1";

export type RefundManagerActionEmailContext = {
  schemaVersion: typeof REFUND_MANAGER_ACTION_EMAIL_SCHEMA_VERSION;
  publicReference: string;
  amountCents: number | null;
  currencyCode: string | null;
  machineLabel: string;
  locationName: string;
  ageMinutes: number;
  paymentMethodCategory: "card" | "cash" | "not_recorded";
  queueLabel: string;
  actionCode: string;
  actionOwner: "Machine Manager" | "Refund Operations";
  lifecycleActor: "system" | "manager";
  whatChanged: string;
  payloadRedacted: true;
};

const readSafeText = (value: unknown, field: string) => {
  if (
    typeof value !== "string" || value.length < 1 || value.length > 160 ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new Error(`Refund manager email ${field} is invalid.`);
  }
  return value;
};

export const parseRefundManagerActionEmailContext = (
  value: unknown,
): RefundManagerActionEmailContext => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Refund manager email context is invalid.");
  }
  const context = value as Record<string, unknown>;
  const keys = Object.keys(context).sort();
  if (
    keys.length !== SAFE_CONTEXT_KEYS.length ||
    keys.some((key, index) => key !== [...SAFE_CONTEXT_KEYS].sort()[index])
  ) {
    throw new Error("Refund manager email context contains unsafe fields.");
  }
  if (
    context.schemaVersion !== REFUND_MANAGER_ACTION_EMAIL_SCHEMA_VERSION ||
    context.payloadRedacted !== true
  ) {
    throw new Error("Refund manager email context version is invalid.");
  }
  const amountCents = context.amountCents;
  if (
    amountCents !== null &&
    (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) ||
      amountCents < 0)
  ) {
    throw new Error("Refund manager email amount is invalid.");
  }
  const currencyCode = context.currencyCode;
  if (
    currencyCode !== null &&
    (typeof currencyCode !== "string" || !/^[A-Z]{3}$/.test(currencyCode))
  ) {
    throw new Error("Refund manager email currency is invalid.");
  }
  if (
    typeof context.ageMinutes !== "number" ||
    !Number.isSafeInteger(context.ageMinutes) || context.ageMinutes < 0 ||
    typeof context.actionCode !== "string" ||
    !SAFE_ACTION_PATTERN.test(context.actionCode) ||
    typeof context.actionOwner !== "string" ||
    !SAFE_OWNER_PATTERN.test(context.actionOwner) ||
    typeof context.lifecycleActor !== "string" ||
    !SAFE_ACTOR_PATTERN.test(context.lifecycleActor) ||
    typeof context.paymentMethodCategory !== "string" ||
    !SAFE_PAYMENT_METHOD_PATTERN.test(context.paymentMethodCategory)
  ) {
    throw new Error("Refund manager email action context is invalid.");
  }

  return {
    schemaVersion: REFUND_MANAGER_ACTION_EMAIL_SCHEMA_VERSION,
    publicReference: readSafeText(context.publicReference, "reference"),
    amountCents: amountCents as number | null,
    currencyCode: currencyCode as string | null,
    machineLabel: readSafeText(context.machineLabel, "machine label"),
    locationName: readSafeText(context.locationName, "location name"),
    ageMinutes: context.ageMinutes,
    paymentMethodCategory: context
      .paymentMethodCategory as RefundManagerActionEmailContext[
        "paymentMethodCategory"
      ],
    queueLabel: readSafeText(context.queueLabel, "queue label"),
    actionCode: context.actionCode,
    actionOwner: context
      .actionOwner as RefundManagerActionEmailContext["actionOwner"],
    lifecycleActor: context
      .lifecycleActor as RefundManagerActionEmailContext["lifecycleActor"],
    whatChanged: readSafeText(context.whatChanged, "change summary"),
    payloadRedacted: true,
  };
};

const reasonCopy: Record<RefundManagerNotificationReason, {
  variant:
    | "new_decision"
    | "changed_action"
    | "urgent_exception"
    | "escalation"
    | "digest_item";
  subjectLead: string;
  whyNow: string;
}> = {
  intake_created: {
    variant: "changed_action",
    subjectLead: "Action changed",
    whyNow: "A refund request was added to the manager portal.",
  },
  wallet_match_ready: {
    variant: "new_decision",
    subjectLead: "Decision required",
    whyNow:
      "A corrected wallet report now has one high-confidence transaction match.",
  },
  customer_reply: {
    variant: "digest_item",
    subjectLead: "Digest item",
    whyNow: "A verified customer reply is ready for review in the linked case.",
  },
  hard_bounce: {
    variant: "urgent_exception",
    subjectLead: "Exception",
    whyNow:
      "Customer email delivery failed and automatic contact is paused for review.",
  },
  provider_setup: {
    variant: "urgent_exception",
    subjectLead: "Exception",
    whyNow:
      "The payment-provider mapping is not ready for an automatic lookup.",
  },
  provider_outage: {
    variant: "urgent_exception",
    subjectLead: "Exception",
    whyNow: "The payment-provider lookup is temporarily unavailable.",
  },
  provider_rejection: {
    variant: "urgent_exception",
    subjectLead: "Exception",
    whyNow: "The payment provider rejected the lookup request.",
  },
  provider_timeout: {
    variant: "urgent_exception",
    subjectLead: "Exception",
    whyNow: "The payment-provider lookup timed out.",
  },
  provider_unknown: {
    variant: "urgent_exception",
    subjectLead: "Exception",
    whyNow: "The payment-provider result is not conclusive and needs review.",
  },
  follow_up_manual_review: {
    variant: "changed_action",
    subjectLead: "Action changed",
    whyNow:
      "Automatic follow-up reached a safe stopping point and needs a person to continue.",
  },
  manager_reminder: {
    variant: "digest_item",
    subjectLead: "Digest item",
    whyNow: "The case remains eligible for manager attention.",
  },
  manager_escalation: {
    variant: "escalation",
    subjectLead: "Escalation",
    whyNow:
      "The case has remained ready for manager attention through the escalation milestone.",
  },
  routine_customer_message: {
    variant: "changed_action",
    subjectLead: "Action changed",
    whyNow: "The customer conversation changed.",
  },
  manager_authored_conversation: {
    variant: "changed_action",
    subjectLead: "Action changed",
    whyNow: "A manager-authored conversation update was recorded.",
  },
  customer_completion_copy: {
    variant: "changed_action",
    subjectLead: "Action changed",
    whyNow: "The customer completion copy was recorded.",
  },
};

const nextActionCopy: Record<string, string> = {
  refund:
    "Review the confirmed transaction and choose the official refund action in the portal.",
  mark_external_refund:
    "Complete the approved external payment workflow, then record completion in the portal.",
  select_transaction:
    "Review the current candidates and select the supported transaction in the portal.",
  retry_read_only_lookup:
    "Review the case, then use the portal's read-only lookup retry if it is still offered.",
  review_inbound_case_link:
    "Review the proposed inbound-message case link in the portal.",
  review_delivery_no_resend:
    "Review delivery evidence in the portal. Do not resend or repeat payment from this email.",
  recover_customer_delivery:
    "Review customer delivery evidence in the portal before choosing a recovery step.",
  refund_operations:
    "Refund Operations should review the provider evidence in the portal. Do not retry payment.",
  reconcile_lifecycle_integrity:
    "Refund Operations should reconcile the durable case evidence. Do not retry payment.",
  request_payout_destination:
    "Review the case and request the missing payout destination through the approved portal flow.",
  resolve_manager_access:
    "Resolve the current Machine Manager assignment before any official refund action.",
  wait_for_customer_reply:
    "No manager action is due now; review the current waiting state in the portal.",
  wait_for_customer_notification:
    "No payment action is due; review the pending customer notification state in the portal.",
  wait:
    "Review the current state in the portal; do not repeat an in-progress action.",
  none:
    "Review the current case record in the portal; no official refund action is due.",
};

export const getRefundManagerNextActionCopy = (actionCode: string) =>
  nextActionCopy[actionCode] ??
    "Open the case and follow the current server-owned action shown in the portal.";

const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatAmount = (
  amountCents: number | null,
  currencyCode: string | null,
) => {
  if (amountCents === null) return "Amount not recorded";
  if (!currencyCode) {
    return `${(amountCents / 100).toFixed(2)} (currency not recorded)`;
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
    }).format(amountCents / 100);
  } catch {
    return `${currencyCode} ${(amountCents / 100).toFixed(2)}`;
  }
};

const formatAge = (ageMinutes: number) => {
  if (ageMinutes < 60) {
    return `${ageMinutes} minute${ageMinutes === 1 ? "" : "s"}`;
  }
  const hours = Math.floor(ageMinutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
};

export const buildRefundManagerActionEmail = ({
  context,
  noticeReason,
  caseUrl,
  queueUrl,
  routingNote,
}: {
  context: RefundManagerActionEmailContext;
  noticeReason: RefundManagerNotificationReason;
  caseUrl: string;
  queueUrl: string;
  routingNote: string;
}) => {
  const reason = reasonCopy[noticeReason];
  const amount = formatAmount(context.amountCents, context.currencyCode);
  const nextStep = getRefundManagerNextActionCopy(context.actionCode);
  const subject =
    `[${reason.subjectLead}] Refund ${amount} · ${context.locationName} · ${context.publicReference}`;
  const details = [
    ["Reference", context.publicReference],
    ["Amount", amount],
    ["Machine", context.machineLabel],
    ["Location", context.locationName],
    ["Case age", formatAge(context.ageMinutes)],
    [
      "Payment type",
      context.paymentMethodCategory === "not_recorded"
        ? "Not recorded"
        : context.paymentMethodCategory,
    ],
    ["Portal state", context.queueLabel],
    ["Action owner", context.actionOwner],
    ["Current action", context.actionCode.replaceAll("_", " ")],
    [
      "Last changed by",
      context.lifecycleActor === "manager" ? "Manager" : "System",
    ],
  ] as const;
  const navigationSafety =
    "Opening these links is navigation only. It does not approve, decline, complete, send, or retry a refund.";
  const privacyNote =
    "Customer contact details, complaint text, payment identifiers, provider payloads, and diagnostics are intentionally omitted.";
  const text = [
    `Action needed: ${nextStep}`,
    `Why now: ${reason.whyNow}`,
    `What changed: ${context.whatChanged}`,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
    `Open this case: ${caseUrl}`,
    `Open the refund queue: ${queueUrl}`,
    "",
    navigationSafety,
    routingNote,
    privacyNote,
  ].join("\n");
  const detailRows = details.map(([label, value]) =>
    `<tr><th scope="row" style="padding:6px 12px 6px 0;text-align:left;vertical-align:top;color:#475569;font-weight:600">${
      escapeHtml(label)
    }</th><td style="padding:6px 0;color:#0f172a">${
      escapeHtml(String(value))
    }</td></tr>`
  ).join("");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><style>@media (prefers-color-scheme:dark){body,.email-bg{background:#111827!important}.card{background:#1f2937!important}h1,p,td{color:#f8fafc!important}th{color:#cbd5e1!important}a{color:#f8fafc!important}}</style></head>
<body class="email-bg" style="margin:0;background:#f1f5f9;color:#0f172a;font-family:Arial,sans-serif"><main style="padding:24px"><div class="card" style="max-width:640px;margin:0 auto;background:#fff;border-radius:16px;padding:28px"><p style="margin:0 0 8px;color:#475569;font-size:14px">Bloomjoy refund manager notice</p><h1 style="margin:0 0 18px;font-size:24px;line-height:1.25">${
    escapeHtml(reason.subjectLead)
  }</h1><p style="line-height:1.55"><strong>Action needed:</strong> ${
    escapeHtml(nextStep)
  }</p><p style="line-height:1.55"><strong>Why now:</strong> ${
    escapeHtml(reason.whyNow)
  }</p><p style="line-height:1.55"><strong>What changed:</strong> ${
    escapeHtml(context.whatChanged)
  }</p><table style="width:100%;border-collapse:collapse;margin:18px 0">${detailRows}</table><p><a href="${
    escapeHtml(caseUrl)
  }" style="display:inline-block;background:#0f172a;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Open refund case ${
    escapeHtml(context.publicReference)
  }</a></p><p><a href="${
    escapeHtml(queueUrl)
  }" style="color:#0f172a;font-weight:600">Open the refund manager queue</a></p><p style="line-height:1.55;font-size:13px;color:#475569">${
    escapeHtml(navigationSafety)
  }</p><p style="line-height:1.55;font-size:13px;color:#475569">${
    escapeHtml(routingNote)
  }</p><p style="line-height:1.55;font-size:13px;color:#475569">${
    escapeHtml(privacyNote)
  }</p></div></main></body></html>`;
  return {
    subject,
    text,
    html,
    variant: reason.variant,
    templateVersion: REFUND_MANAGER_ACTION_EMAIL_TEMPLATE_VERSION,
  };
};
