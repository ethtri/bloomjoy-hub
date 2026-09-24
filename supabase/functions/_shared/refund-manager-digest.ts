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

export type RefundManagerDailyDigestItem = {
  caseId: string;
  publicReference: string;
  amountCents: number | null;
  currencyCode: string | null;
  machineLabel: string;
  locationName: string;
  ageMinutes: number;
  actor: "manager" | "system" | "agent" | "customer";
  actionCode: string;
  actionLabel: string;
  paymentComplete: boolean;
  payloadRedacted: true;
};
export type RefundManagerDailyDigestProjection = {
  schemaVersion: "refund_manager_daily_digest_v2";
  observedAt: string;
  actionCount: number;
  openCount: number;
  items: RefundManagerDailyDigestItem[];
  payloadRedacted: true;
};

export const parseRefundManagerDailyDigestProjection = (
  value: unknown,
): RefundManagerDailyDigestProjection => {
  const root = objectValue(value);
  exactKeys(root, ["schemaVersion", "observedAt", "actionCount", "openCount", "items", "payloadRedacted"]);
  if (root.schemaVersion !== "refund_manager_daily_digest_v2" || root.payloadRedacted !== true ||
    !Array.isArray(root.items)) throw new Error("Unsupported refund daily digest response.");
  const items = root.items.map((raw): RefundManagerDailyDigestItem => {
    const item = objectValue(raw);
    exactKeys(item, ["caseId", "publicReference", "amountCents", "currencyCode",
      "machineLabel", "locationName", "ageMinutes", "actor", "actionCode",
      "actionLabel", "paymentComplete", "payloadRedacted"]);
    if (!["manager", "system", "agent", "customer"].includes(item.actor as string) ||
      typeof item.paymentComplete !== "boolean" || item.payloadRedacted !== true ||
      (item.amountCents !== null && !Number.isSafeInteger(item.amountCents)) ||
      (item.amountCents as number | null) !== null && (item.amountCents as number) < 0) {
      throw new Error("Unsupported refund daily digest item.");
    }
    const actor = item.actor as RefundManagerDailyDigestItem["actor"];
    const actionCode = stringValue(item.actionCode);
    if (actor === "manager" && (item.paymentComplete === true ||
      !["approve_or_deny_request", "send_cash_refund_and_confirm"].includes(actionCode))) {
      throw new Error("Unsupported manager refund action.");
    }
    return {
      caseId: stringValue(item.caseId),
      publicReference: stringValue(item.publicReference),
      amountCents: item.amountCents as number | null,
      currencyCode: item.currencyCode === null ? null : stringValue(item.currencyCode),
      machineLabel: stringValue(item.machineLabel),
      locationName: stringValue(item.locationName),
      ageMinutes: countValue(item.ageMinutes),
      actor,
      actionCode,
      actionLabel: stringValue(item.actionLabel),
      paymentComplete: item.paymentComplete as boolean,
      payloadRedacted: true,
    };
  });
  const openCount = countValue(root.openCount);
  const actionCount = countValue(root.actionCount);
  if (items.length !== openCount || actionCount !== items.filter((item) => item.actor === "manager").length ||
    new Set(items.map((item) => item.caseId)).size !== items.length) {
    throw new Error("Refund daily digest counts or cases disagree.");
  }
  return { schemaVersion: "refund_manager_daily_digest_v2", observedAt: stringValue(root.observedAt),
    actionCount, openCount, items, payloadRedacted: true };
};

const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const amount = (cents: number | null, currency: string | null) =>
  cents === null
    ? "Amount not yet confirmed"
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
    projection: RefundManagerDailyDigestProjection;
    caseUrl: (caseId: string) => string;
    queueUrl: string;
    localDate: string;
  },
) => {
  if (!projection.items.length || projection.openCount !== projection.items.length) {
    throw new Error("A manager digest cannot be empty or incomplete.");
  }
  const sorted = [...projection.items].sort((a, b) => {
    const rank = (item: RefundManagerDailyDigestItem) => item.actor === "manager" ? 0
      : item.actor === "customer" ? 2 : 1;
    return rank(a) - rank(b) || b.ageMinutes - a.ageMinutes ||
      a.publicReference.localeCompare(b.publicReference);
  });
  const action = sorted.filter((item) => item.actor === "manager");
  const working = sorted.filter((item) => item.actor === "system" || item.actor === "agent");
  const waiting = sorted.filter((item) => item.actor === "customer");
  const actionText = (item: RefundManagerDailyDigestItem) => item.actionCode === "send_cash_refund_and_confirm"
    ? "Review the saved cash evidence and verified destination. Send the prepared refund by Zelle, then confirm it in the portal."
    : "Bloomjoy has prepared the case for your final decision. Review the saved purchase evidence and approve or deny it in the portal.";
  const otherText = (item: RefundManagerDailyDigestItem) => item.paymentComplete
    ? "The refund was already sent. Bloomjoy is resolving the required customer notice. No further payment or manager action is needed."
    : item.actor === "customer"
    ? `Waiting for the customer. ${item.actionLabel} No action needed from you.`
    : `Waiting for Bloomjoy follow-up. Next step: ${item.actionLabel} No action needed from you.`;
  const summary = `${projection.actionCount} need your decision or payment; ${projection.openCount} open in total.`;
  const section = (heading: string, entries: RefundManagerDailyDigestItem[]) => {
    if (!entries.length) return { text: "", html: "" };
    const lines = entries.map((item) => `${item.publicReference} — ${amount(item.amountCents, item.currencyCode)} — ${item.machineLabel}, ${item.locationName} — open ${formatRefundManagerAge(item.ageMinutes)}\n${item.actor === "manager" ? actionText(item) : otherText(item)}\nOpen case: ${caseUrl(item.caseId)}`);
    const rows = entries.map((item) => `<li style="margin:0 0 18px;padding:0;overflow-wrap:anywhere"><strong>${escapeHtml(item.publicReference)}</strong> · ${escapeHtml(amount(item.amountCents, item.currencyCode))}<br>${escapeHtml(item.machineLabel)} · ${escapeHtml(item.locationName)} · open ${escapeHtml(formatRefundManagerAge(item.ageMinutes))}<br>${escapeHtml(item.actor === "manager" ? actionText(item) : otherText(item))}<br><a href="${escapeHtml(caseUrl(item.caseId))}" style="color:#174a77">Open refund case ${escapeHtml(item.publicReference)}</a></li>`).join("");
    return { text: `${heading}\n\n${lines.join("\n\n")}`, html: `<h2 style="font-size:18px;line-height:1.3;margin:26px 0 12px">${heading}</h2><ol style="padding-left:24px;margin:0">${rows}</ol>` };
  };
  const sections = [section("Your decision or payment", action), section("Awaiting Bloomjoy follow-up", working), section("Waiting for the customer", waiting)];
  const navigation =
    "Opening these links is navigation only. It does not approve, decline, complete, send, or retry a refund.";
  const subject = `Bloomjoy refunds: ${projection.actionCount} need your action, ${projection.openCount} open`;
  return {
    subject,
    text: `Bloomjoy refunds · ${localDate}\n${summary}\n\n${sections.map((part) => part.text).filter(Boolean).join("\n\n")}\n\nOpen your refund queue: ${queueUrl}\n\n${navigation}`,
    html: `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#f1f5f9;color:#172535;font-family:Arial,sans-serif"><main lang="en" dir="ltr" style="box-sizing:border-box;max-width:680px;margin:0 auto;padding:20px;background:#fff;line-height:1.5;overflow-wrap:anywhere"><h1 style="font-size:22px;line-height:1.25;margin:0 0 12px">Bloomjoy refunds</h1><p>${escapeHtml(summary)}</p>${sections.map((part) => part.html).join("")}<p><a href="${escapeHtml(queueUrl)}" style="color:#174a77">Open your refund queue</a></p><p style="font-size:13px;color:#435466">${escapeHtml(navigation)}</p></main></body></html>`,
    itemCount: projection.openCount,
  };
};
