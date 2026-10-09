import type { RefundManagerNotificationReason } from "./refund-manager-notification.ts";

const SAFE_ACTION_PATTERN = /^[a-z0-9_]{1,80}$/;
const SAFE_ACTOR_PATTERN = /^(system|manager)$/;
const LEGACY_REFUND_OWNER = ["Refund", "Operations"].join(" ");
const SAFE_OWNER_PATTERN = /^(Machine Manager)$/;
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
  "refund_manager_action_email_v2";

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
  actionOwner: "Machine Manager";
  lifecycleActor: "system" | "manager";
  whatChanged: string;
  payloadRedacted: true;
  requestedAmountCents?: number | null;
  requestedCurrencyCode?: string | null;
  issueLabel?: string | null;
  customerCommentExcerpt?: string | null;
  paymentOutcomeUnknown?: boolean;
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
  const caseKeys = [
    "requestedAmountCents",
    "requestedCurrencyCode",
    "issueLabel",
    "customerCommentExcerpt",
  ];
  const keys = Object.keys(context);
  const caseKeyCount = caseKeys.filter((key) => key in context).length;
  if (
    SAFE_CONTEXT_KEYS.some((key) => !(key in context)) ||
    keys.some((key) =>
      ![...SAFE_CONTEXT_KEYS, ...caseKeys, "paymentOutcomeUnknown"].includes(
        key,
      )
    ) ||
    (caseKeyCount !== 0 && caseKeyCount !== caseKeys.length)
  ) {
    throw new Error("Refund manager email context contains unsafe fields.");
  }
  if (
    "paymentOutcomeUnknown" in context &&
    typeof context.paymentOutcomeUnknown !== "boolean"
  ) {
    throw new Error("Refund manager email payment outcome is invalid.");
  }
  if (caseKeyCount) {
    const amount = context.requestedAmountCents;
    const currency = context.requestedCurrencyCode;
    if (
      amount !== null &&
      (typeof amount !== "number" || !Number.isSafeInteger(amount) ||
        amount < 0)
    ) {
      throw new Error("Refund manager email requested amount is invalid.");
    }
    if (
      currency !== null &&
      (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency))
    ) {
      throw new Error("Refund manager email requested currency is invalid.");
    }
    for (
      const [key, max] of [["issueLabel", 160], [
        "customerCommentExcerpt",
        320,
      ]] as const
    ) {
      const value = context[key];
      if (
        value !== null &&
        (typeof value !== "string" || Array.from(value).length < 1 ||
          Array.from(value).length > max ||
          Array.from(value).some((character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
          ))
      ) {
        throw new Error(`Refund manager email ${key} is invalid.`);
      }
    }
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
    (!SAFE_OWNER_PATTERN.test(context.actionOwner) &&
      context.actionOwner !== LEGACY_REFUND_OWNER) ||
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
    // Older queued notices retain their immutable owner value. Normalize it at
    // the rendering boundary so a delayed notice cannot reintroduce a role that
    // does not exist in the current operating model.
    actionOwner: "Machine Manager",
    lifecycleActor: context
      .lifecycleActor as RefundManagerActionEmailContext["lifecycleActor"],
    whatChanged: readSafeText(context.whatChanged, "change summary"),
    payloadRedacted: true,
    ...("paymentOutcomeUnknown" in context
      ? { paymentOutcomeUnknown: context.paymentOutcomeUnknown as boolean }
      : {}),
    ...(caseKeyCount
      ? {
        requestedAmountCents: context.requestedAmountCents as number | null,
        requestedCurrencyCode: context.requestedCurrencyCode as string | null,
        issueLabel: context.issueLabel as string | null,
        customerCommentExcerpt: context.customerCommentExcerpt as string | null,
      }
      : {}),
  };
};

// Presentation copy never substitutes for the current case's payment state.
const reasonCopy: Record<RefundManagerNotificationReason, {
  variant:
    | "new_decision"
    | "changed_action"
    | "urgent_exception"
    | "escalation"
    | "digest_item";
  heading: string;
  summary: string;
}> = {
  intake_created: {
    variant: "changed_action",
    heading: "New refund request",
    summary: "",
  },
  wallet_match_ready: {
    variant: "new_decision",
    heading: "Refund ready for review",
    summary: "",
  },
  customer_reply: {
    variant: "digest_item",
    heading: "Customer replied",
    summary: "A new reply is available in this case.",
  },
  hard_bounce: {
    variant: "urgent_exception",
    heading: "Customer email not delivered",
    summary:
      "The customer's email could not be delivered. Delivery needs review before another message is sent.",
  },
  provider_setup: {
    variant: "urgent_exception",
    heading: "Purchase lookup unavailable",
    summary:
      "A payment connection issue is blocking purchase lookup. No refund decision is needed yet.",
  },
  provider_outage: {
    variant: "urgent_exception",
    heading: "Transaction lookup unavailable",
    summary:
      "The payment service is unavailable. No refund decision is requested while the lookup is unavailable.",
  },
  provider_rejection: {
    variant: "urgent_exception",
    heading: "Transaction lookup failed",
    summary:
      "The payment service did not accept the lookup. This needs system review; no refund decision is requested.",
  },
  provider_timeout: {
    variant: "urgent_exception",
    heading: "Transaction lookup delayed",
    summary:
      "The transaction lookup did not finish. No refund decision is requested while the lookup is unresolved.",
  },
  provider_unknown: {
    variant: "urgent_exception",
    heading: "Transaction lookup inconclusive",
    summary:
      "The transaction lookup did not return a clear result. This needs system review; no refund decision is requested.",
  },
  follow_up_manual_review: {
    variant: "changed_action",
    heading: "Refund needs review",
    summary: "",
  },
  manager_reminder: {
    variant: "digest_item",
    heading: "Refund awaiting review",
    summary: "",
  },
  manager_escalation: {
    variant: "escalation",
    heading: "Refund still awaiting review",
    summary: "",
  },
  routine_customer_message: {
    variant: "changed_action",
    heading: "Customer conversation updated",
    summary: "The latest message is available in this case.",
  },
  manager_authored_conversation: {
    variant: "changed_action",
    heading: "Case conversation updated",
    summary: "The latest message is available in this case.",
  },
  customer_completion_copy: {
    variant: "changed_action",
    heading: "Customer notification updated",
    summary: "View the case for the recorded customer notification.",
  },
};

const nextActionCopy: Record<string, string> = {
  refund: "Review the selected purchase and approve or decline the refund.",
  mark_external_refund:
    "Confirm the refund only after you have sent it through Zelle.",
  select_transaction:
    "The purchase still needs to be identified before a refund decision.",
  retry_read_only_lookup:
    "The transaction lookup needs system review. No refund decision is requested.",
  review_inbound_case_link:
    "The customer's reply needs to be linked to the correct case.",
  review_delivery_no_resend:
    "Customer email delivery needs review before another message is sent.",
  recover_customer_delivery:
    "Customer email delivery needs review before another message is sent.",
  refund_operations:
    "The case needs system review. No refund decision is requested.",
  reconcile_lifecycle_integrity:
    "The case record needs system review. No refund decision is requested.",
  request_payout_destination:
    "The case is waiting for the customer's payout details.",
  resolve_manager_access:
    "A machine manager assignment is needed before a refund decision.",
  wait_for_customer_reply:
    "Waiting for the customer to reply. No decision is needed now.",
  wait_for_customer_notification:
    "The customer notification is pending. No payment action is needed.",
  wait: "The case is in progress. No decision is needed now.",
  none: "No refund decision is needed now.",
};

const currentActionHeading: Record<string, string> = {
  refund: "Refund ready for review",
  mark_external_refund: "Cash refund needs confirmation",
  select_transaction: "Purchase needs review",
  retry_read_only_lookup: "Transaction lookup needs review",
  review_inbound_case_link: "Customer reply needs review",
  review_delivery_no_resend: "Customer email needs review",
  recover_customer_delivery: "Customer email needs review",
  refund_operations: "Refund needs system review",
  reconcile_lifecycle_integrity: "Refund needs system review",
  request_payout_destination: "Waiting for payout details",
  resolve_manager_access: "Machine manager assignment needed",
  wait_for_customer_reply: "Waiting for customer reply",
  wait_for_customer_notification: "Customer notification pending",
  wait: "Refund request in progress",
  none: "Refund request update",
};

export const getRefundManagerNextActionCopy = (actionCode: string) =>
  nextActionCopy[actionCode] ??
    "View the case for its current status and available actions.";

const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const formatAmount = (
  amountCents: number | null | undefined,
  currencyCode: string | null | undefined,
) => {
  if (amountCents == null) return "Not available";
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

export const buildRefundManagerActionEmail = (
  { context, noticeReason, caseUrl, audience = "manager" }: {
    context: RefundManagerActionEmailContext;
    noticeReason: RefundManagerNotificationReason;
    caseUrl: string;
    // Kept for callers with immutable v1 jobs. Neither creates a second email link.
    queueUrl: string;
    routingNote: string;
    audience?: "manager" | "operations";
  },
) => {
  const reason = reasonCopy[noticeReason];
  const operations = audience === "operations";
  const heading = operations
    ? "Refund notice routing needs review"
    : context.paymentOutcomeUnknown
    ? "Refund status needs verification"
    : [
        "wallet_match_ready",
        "follow_up_manual_review",
        "manager_reminder",
        "manager_escalation",
      ].includes(noticeReason)
    ? currentActionHeading[context.actionCode] ?? "Refund request update"
    : reason.heading;
  const summary = operations
    ? "This notice could not be routed to a current machine manager. Review the assignment in Bloomjoy Hub."
    : context.paymentOutcomeUnknown
    ? "Do not issue another refund until its status is confirmed."
    : reason.summary || getRefundManagerNextActionCopy(context.actionCode);
  // The original requested amount is deliberately never inferred from a selected
  // transaction, approved payment, or the ambiguous amount in historical v1 jobs.
  const requested = formatAmount(
    context.requestedAmountCents,
    context.requestedCurrencyCode,
  );
  const subject = operations
    ? `Refund notice routing: ${context.publicReference}`
    : `${heading}: ${context.machineLabel} · ${context.publicReference}`;
  const preheader = operations
    ? "Review the machine manager assignment."
    : Array.from(
      `Requested: ${requested}${
        context.issueLabel ? ` · ${context.issueLabel}` : ""
      }`,
    ).slice(0, 89).join("");
  const text = [
    "Bloomjoy Hub",
    heading,
    ...(!operations
      ? [
        context.machineLabel,
        `Requested amount: ${requested}`,
        ...(context.issueLabel
          ? [`Reported issue: ${context.issueLabel}`]
          : []),
        ...(context.customerCommentExcerpt
          ? [`Customer comment: ${context.customerCommentExcerpt}`]
          : []),
      ]
      : []),
    "",
    summary,
    "",
    `View case: ${caseUrl}`,
    `Reference: ${context.publicReference}`,
  ].join("\n");
  const details = operations
    ? ""
    : `<h2 style="margin:18px 0 14px;font-size:20px;line-height:1.35;font-weight:600;overflow-wrap:anywhere">${
      escapeHtml(context.machineLabel)
    }</h2>
<p style="margin:0 0 12px;line-height:1.5"><span class="muted" style="color:#65616a">Requested amount</span><br><strong style="font-size:20px">${
      escapeHtml(requested)
    }</strong></p>
${
      context.issueLabel
        ? `<p style="margin:0 0 8px;line-height:1.5"><span class="muted" style="color:#65616a">Reported issue</span><br><strong>${
          escapeHtml(context.issueLabel)
        }</strong></p>`
        : ""
    }
${
      context.customerCommentExcerpt
        ? `<p class="comment" lang="und" dir="auto" style="margin:0 0 16px;line-height:1.5;overflow-wrap:anywhere">${
          escapeHtml(context.customerCommentExcerpt)
        }</p>`
        : ""
    }`;
  const html = `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${
    escapeHtml(subject)
  }</title>
<style>@media only screen and (max-width:480px){.outer{padding:0!important}.content{padding:24px 20px!important}.case-link{display:block!important;text-align:center!important}}@media(prefers-color-scheme:dark){.email-bg{background:#201c20!important}.surface{background:#2c252c!important;color:#faf5f7!important}.muted{color:#c5bfc7!important}.brand{color:#f0b6cb!important}.divider{border-color:#51444b!important}.case-link{background:#f0b6cb!important;color:#35202a!important}}</style></head>
<body class="email-bg" style="margin:0;padding:0;background:#faf7f8;color:#292b34;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;-webkit-text-size-adjust:100%">
<div lang="en" dir="ltr" style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0">${
    escapeHtml(preheader)
  }</div>
<table lang="en" dir="ltr" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td class="outer" style="padding:24px 12px">
<table class="surface" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;margin:0 auto;background:#fffdfd;color:#292b34;table-layout:fixed"><tr><td class="content" style="padding:28px 32px;overflow-wrap:anywhere">
<p class="brand" style="margin:0 0 20px;color:#923c58;font-size:16px;font-weight:700;letter-spacing:-.3px">Bloomjoy <span style="font-weight:400">Hub</span></p>
<h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:700">${
    escapeHtml(heading)
  }</h1>${details}
<p class="divider" style="margin:18px 0 20px;padding-top:16px;border-top:1px solid #eadfe3;font-size:16px;line-height:1.5">${
    escapeHtml(summary)
  }</p>
<a class="case-link" href="${
    escapeHtml(caseUrl)
  }" style="display:inline-block;background:#923c58;color:#fffafa;text-decoration:none;font-size:16px;font-weight:600;line-height:24px;padding:12px 24px;border-radius:6px;mso-padding-alt:12px 24px">View case</a>
<p class="muted" style="margin:18px 0 0;color:#65616a;font-size:13px;line-height:1.5">${
    escapeHtml(context.publicReference)
  }</p>
</td></tr></table></td></tr></table></body></html>`;
  return {
    subject,
    text,
    html,
    variant: reason.variant,
    templateVersion: REFUND_MANAGER_ACTION_EMAIL_TEMPLATE_VERSION,
  };
};
