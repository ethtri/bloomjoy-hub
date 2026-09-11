import { getRefundManagerNextActionCopy } from "./refund-manager-email.ts";

export const REFUND_MANAGER_WORK_SCHEMA_VERSION =
  "refund_manager_work_v1" as const;

export type RefundManagerWorkBucket =
  | "needs_action"
  | "ready_to_pay"
  | "in_progress"
  | "provider_hold"
  | "waiting_on_customer"
  | "completed";

export type RefundManagerWorkItem = {
  caseId: string;
  publicReference: string;
  amountCents: number | null;
  currencyCode: string | null;
  machineLabel: string;
  locationName: string;
  ageMinutes: number;
  queueBucket: RefundManagerWorkBucket;
  queueLabel: string;
  actionCode: string;
  actionOwner: string;
  lifecycleActor: string;
  whatChanged: string;
  noticeReason: "customer_reply" | "manager_reminder" | null;
  attentionVersion: number;
  digestEligible: boolean;
  urgentNoticeState: "none" | "immediate_sent" | "immediate_unresolved";
  payloadRedacted: true;
};

export type RefundManagerWorkProjection = {
  schemaVersion: typeof REFUND_MANAGER_WORK_SCHEMA_VERSION;
  observedAt: string;
  bucketCounts: Record<RefundManagerWorkBucket, number>;
  digestCounts: {
    needsDecision: number;
    newInformation: number;
    aging: number;
    exceptionsBeingHandled: number;
  };
  oldestActionableAgeMinutes: number | null;
  recentMaterialChangeCount: number;
  items: RefundManagerWorkItem[];
  metrics: {
    emailsSentToday: number;
    digestEligibleCount: number;
    duplicatesSuppressedToday: number;
    oldestActionableAgeMinutes: number | null;
    oldestDecisionAgeMinutes: number | null;
    payloadRedacted: true;
  };
  payloadRedacted: true;
};

const objectValue = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Unsupported refund manager work response.");
  }
  return value as Record<string, unknown>;
};
const exactKeys = (value: Record<string, unknown>, expected: string[]) => {
  if (Object.keys(value).sort().join("|") !== [...expected].sort().join("|")) {
    throw new Error("Unsupported refund manager work response.");
  }
};
const stringValue = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Unsupported refund manager work response.");
  }
  return value;
};
const countValue = (value: unknown) => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Unsupported refund manager work response.");
  }
  return value as number;
};
const nullableCount = (value: unknown) =>
  value === null ? null : countValue(value);
const bucketNames: RefundManagerWorkBucket[] = [
  "needs_action",
  "ready_to_pay",
  "in_progress",
  "provider_hold",
  "waiting_on_customer",
  "completed",
];

export const parseRefundManagerWorkProjection = (
  value: unknown,
): RefundManagerWorkProjection => {
  const root = objectValue(value);
  exactKeys(root, [
    "schemaVersion",
    "observedAt",
    "bucketCounts",
    "digestCounts",
    "oldestActionableAgeMinutes",
    "recentMaterialChangeCount",
    "items",
    "metrics",
    "payloadRedacted",
  ]);
  if (
    root.schemaVersion !== REFUND_MANAGER_WORK_SCHEMA_VERSION ||
    root.payloadRedacted !== true
  ) throw new Error("Unsupported refund manager work response.");
  const buckets = objectValue(root.bucketCounts);
  exactKeys(buckets, bucketNames);
  const bucketCounts = Object.fromEntries(
    bucketNames.map((name) => [name, countValue(buckets[name])]),
  ) as Record<RefundManagerWorkBucket, number>;
  const digest = objectValue(root.digestCounts);
  exactKeys(digest, [
    "needsDecision",
    "newInformation",
    "aging",
    "exceptionsBeingHandled",
  ]);
  const metrics = objectValue(root.metrics);
  exactKeys(metrics, [
    "emailsSentToday",
    "digestEligibleCount",
    "duplicatesSuppressedToday",
    "oldestActionableAgeMinutes",
    "oldestDecisionAgeMinutes",
    "payloadRedacted",
  ]);
  if (metrics.payloadRedacted !== true || !Array.isArray(root.items)) {
    throw new Error("Unsupported refund manager work response.");
  }
  const items = root.items.map((raw): RefundManagerWorkItem => {
    const item = objectValue(raw);
    exactKeys(item, [
      "caseId",
      "publicReference",
      "amountCents",
      "currencyCode",
      "machineLabel",
      "locationName",
      "ageMinutes",
      "queueBucket",
      "queueLabel",
      "actionCode",
      "actionOwner",
      "lifecycleActor",
      "whatChanged",
      "noticeReason",
      "attentionVersion",
      "digestEligible",
      "urgentNoticeState",
      "payloadRedacted",
    ]);
    if (
      !bucketNames.includes(item.queueBucket as RefundManagerWorkBucket) ||
      item.payloadRedacted !== true || typeof item.digestEligible !== "boolean"
    ) throw new Error("Unsupported refund manager work response.");
    if (
      ![null, "customer_reply", "manager_reminder"].includes(
        item.noticeReason as null | string,
      ) ||
      !["none", "immediate_sent", "immediate_unresolved"].includes(
        item.urgentNoticeState as string,
      )
    ) throw new Error("Unsupported refund manager work response.");
    return {
      caseId: stringValue(item.caseId),
      publicReference: stringValue(item.publicReference),
      amountCents: item.amountCents === null
        ? null
        : countValue(item.amountCents),
      currencyCode: item.currencyCode === null
        ? null
        : stringValue(item.currencyCode),
      machineLabel: stringValue(item.machineLabel),
      locationName: stringValue(item.locationName),
      ageMinutes: countValue(item.ageMinutes),
      queueBucket: item.queueBucket as RefundManagerWorkBucket,
      queueLabel: stringValue(item.queueLabel),
      actionCode: stringValue(item.actionCode),
      actionOwner: stringValue(item.actionOwner),
      lifecycleActor: stringValue(item.lifecycleActor),
      whatChanged: stringValue(item.whatChanged),
      noticeReason: item.noticeReason as RefundManagerWorkItem["noticeReason"],
      attentionVersion: countValue(item.attentionVersion),
      digestEligible: item.digestEligible,
      urgentNoticeState: item
        .urgentNoticeState as RefundManagerWorkItem["urgentNoticeState"],
      payloadRedacted: true,
    };
  });
  return {
    schemaVersion: REFUND_MANAGER_WORK_SCHEMA_VERSION,
    observedAt: stringValue(root.observedAt),
    bucketCounts,
    digestCounts: {
      needsDecision: countValue(digest.needsDecision),
      newInformation: countValue(digest.newInformation),
      aging: countValue(digest.aging),
      exceptionsBeingHandled: countValue(digest.exceptionsBeingHandled),
    },
    oldestActionableAgeMinutes: nullableCount(root.oldestActionableAgeMinutes),
    recentMaterialChangeCount: countValue(root.recentMaterialChangeCount),
    items,
    metrics: {
      emailsSentToday: countValue(metrics.emailsSentToday),
      digestEligibleCount: countValue(metrics.digestEligibleCount),
      duplicatesSuppressedToday: countValue(metrics.duplicatesSuppressedToday),
      oldestActionableAgeMinutes: nullableCount(
        metrics.oldestActionableAgeMinutes,
      ),
      oldestDecisionAgeMinutes: nullableCount(metrics.oldestDecisionAgeMinutes),
      payloadRedacted: true,
    },
    payloadRedacted: true,
  };
};

const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const amount = (cents: number | null, currency: string | null) =>
  cents === null
    ? "Amount not recorded"
    : currency
    ? `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`
    : `${(cents / 100).toFixed(2)} (currency not recorded)`;
export const formatRefundManagerAge = (minutes: number) =>
  minutes < 60
    ? `${minutes}m`
    : minutes < 2880
    ? `${Math.floor(minutes / 60)}h`
    : `${Math.floor(minutes / 1440)}d`;

export const buildRefundManagerDigestEmail = (
  { projection, caseUrl, queueUrl, localDate }: {
    projection: RefundManagerWorkProjection;
    caseUrl: (caseId: string) => string;
    queueUrl: string;
    localDate: string;
  },
) => {
  const selected = projection.items.filter((item) => item.digestEligible);
  if (!selected.length) throw new Error("A manager digest cannot be empty.");
  const counts = projection.digestCounts;
  const countCopy =
    `Needs decision ${counts.needsDecision} · New information ${counts.newInformation} · Aging ${counts.aging} · Exceptions being handled ${counts.exceptionsBeingHandled}`;
  const lines = selected.map((item) =>
    `${item.publicReference} — ${
      amount(item.amountCents, item.currencyCode)
    } — ${item.machineLabel}, ${item.locationName} — ${
      formatRefundManagerAge(item.ageMinutes)
    }\n${
      getRefundManagerNextActionCopy(item.actionCode)
    }\n${item.whatChanged}\n${caseUrl(item.caseId)}`
  );
  const rows = selected.map((item) =>
    `<li style="margin:0 0 20px"><strong>${
      escapeHtml(item.publicReference)
    }</strong> · ${
      escapeHtml(amount(item.amountCents, item.currencyCode))
    }<br>${escapeHtml(item.machineLabel)} · ${
      escapeHtml(item.locationName)
    } · ${
      escapeHtml(formatRefundManagerAge(item.ageMinutes))
    }<br><strong>Next:</strong> ${
      escapeHtml(getRefundManagerNextActionCopy(item.actionCode))
    }<br>${escapeHtml(item.whatChanged)}<br><a href="${
      escapeHtml(caseUrl(item.caseId))
    }">Open this refund case</a></li>`
  ).join("");
  const navigation =
    "Opening these links is navigation only. It does not approve, decline, complete, send, or retry a refund.";
  return {
    subject: `[Daily summary] ${selected.length} refund item${
      selected.length === 1 ? "" : "s"
    } · ${localDate}`,
    text: `My refund work\n${countCopy}\n\n${
      lines.join("\n\n")
    }\n\nOpen my refund work: ${queueUrl}\n\n${navigation}`,
    html:
      `<div style="font-family:Arial,sans-serif;line-height:1.5;max-width:680px"><h1 style="font-size:22px">My refund work</h1><p>${
        escapeHtml(countCopy)
      }</p><ul style="padding-left:20px">${rows}</ul><p><a href="${
        escapeHtml(queueUrl)
      }">Open my refund work</a></p><p style="color:#52606d;font-size:13px">${
        escapeHtml(navigation)
      }</p></div>`,
    itemCount: selected.length,
  };
};
