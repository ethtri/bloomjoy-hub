export type RefundManagerReadyNotice = {
  schemaVersion: "refund_manager_ready_notice_v1";
  caseId: string;
  managerUserId: string;
  decisionFingerprint: string;
  proofId: string | null;
  officialActionVersion: number;
  deterministicFactVersion: number;
  actionCode: "approve_or_deny_request" | "send_cash_refund_and_confirm";
  evidenceBasis: "card_exact_selected" | "card_reviewed_candidate_set" | "cash_sale_found" |
    "cash_multiple_reviewed" | "cash_researched_unmatched" |
    "cash_coverage_unavailable_researched" | "cash_approved_payout";
  preparationSummary: string;
  publicReference: string;
  amountCents: number;
  currencyCode: string | null;
  machineLabel: string;
  locationName: string;
  payloadRedacted: true;
};

const keys = ["schemaVersion", "caseId", "managerUserId", "decisionFingerprint",
  "proofId", "officialActionVersion", "deterministicFactVersion",
  "actionCode", "evidenceBasis", "preparationSummary", "publicReference", "amountCents", "currencyCode",
  "machineLabel", "locationName", "payloadRedacted"].sort();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const postgresUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeText = (value: unknown, label: string) => {
  if (typeof value !== "string" || value.length < 1 || value.length > 160 ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })) {
    throw new Error(`Ready notice ${label} is invalid.`);
  }
  return value;
};

export const parseRefundManagerReadyNotice = (value: unknown): RefundManagerReadyNotice => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Ready notice projection is invalid.");
  }
  const data = value as Record<string, unknown>;
  const actual = Object.keys(data).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index]) ||
    data.schemaVersion !== "refund_manager_ready_notice_v1" || data.payloadRedacted !== true ||
    typeof data.caseId !== "string" || !uuid.test(data.caseId) ||
    typeof data.managerUserId !== "string" || !uuid.test(data.managerUserId) ||
    typeof data.decisionFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(data.decisionFingerprint) ||
    (data.proofId !== null && (typeof data.proofId !== "string" || !postgresUuid.test(data.proofId))) ||
    !Number.isSafeInteger(data.officialActionVersion) || (data.officialActionVersion as number) < 1 ||
    !Number.isSafeInteger(data.deterministicFactVersion) || (data.deterministicFactVersion as number) < 1 ||
    !Number.isSafeInteger(data.amountCents) || (data.amountCents as number) <= 0 ||
    (data.currencyCode !== null && (typeof data.currencyCode !== "string" ||
      !/^[A-Z]{3}$/.test(data.currencyCode)))) {
    throw new Error("Ready notice projection is unsafe or incomplete.");
  }
  const actionCode = data.actionCode;
  const evidenceBasis = data.evidenceBasis;
  if (actionCode !== "approve_or_deny_request" && actionCode !== "send_cash_refund_and_confirm") {
    throw new Error("Ready notice action is not a final manager decision.");
  }
  if (!["card_exact_selected", "card_reviewed_candidate_set", "cash_sale_found", "cash_multiple_reviewed",
    "cash_researched_unmatched", "cash_coverage_unavailable_researched",
    "cash_approved_payout"].includes(evidenceBasis as string)) {
    throw new Error("Ready notice evidence basis is unsupported.");
  }
  if (actionCode === "approve_or_deny_request"
    ? !["card_exact_selected", "card_reviewed_candidate_set"].includes(evidenceBasis as string)
    : !["cash_sale_found", "cash_multiple_reviewed", "cash_researched_unmatched",
      "cash_coverage_unavailable_researched", "cash_approved_payout"].includes(evidenceBasis as string)) {
    throw new Error("Ready notice preparation does not match the decision type.");
  }
  if ((evidenceBasis === "cash_approved_payout") !== (data.proofId === null)) {
    throw new Error("Saved cash approval must not imply a new preparation proof.");
  }
  return {
    schemaVersion: "refund_manager_ready_notice_v1",
    caseId: data.caseId, managerUserId: data.managerUserId,
    decisionFingerprint: data.decisionFingerprint,
    proofId: data.proofId as string | null,
    officialActionVersion: data.officialActionVersion as number,
    deterministicFactVersion: data.deterministicFactVersion as number,
    actionCode, evidenceBasis: evidenceBasis as RefundManagerReadyNotice["evidenceBasis"],
    preparationSummary: safeText(data.preparationSummary, "prepared summary"),
    publicReference: safeText(data.publicReference, "reference"),
    amountCents: data.amountCents as number,
    currencyCode: data.currencyCode as string | null,
    machineLabel: safeText(data.machineLabel, "machine"),
    locationName: safeText(data.locationName, "location"),
    payloadRedacted: true,
  };
};

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export const buildRefundManagerReadyEmail = ({ notice, caseUrl }: {
  notice: RefundManagerReadyNotice;
  caseUrl: string;
}) => {
  const amount = notice.currencyCode === "USD"
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
      .format(notice.amountCents / 100)
    : `${(notice.amountCents / 100).toFixed(2)}${notice.currencyCode ? ` ${notice.currencyCode}` : " (currency not recorded)"}`;
  const action = notice.actionCode === "approve_or_deny_request"
    ? "Review the prepared refund and approve or deny it in the portal."
    : "Review the saved cash evidence and payout destination. Send Zelle, then confirm it was sent in the portal.";
  const reason = notice.evidenceBasis === "cash_approved_payout"
    ? `Saved approval: ${notice.preparationSummary}`
    : `Prepared case summary: ${notice.preparationSummary}`;
  const navigation = "Opening the case does not approve, deny, send, or repeat a refund.";
  const subject = `Refund decision ready: ${notice.publicReference} · ${amount}`;
  const text = `${action}\n${reason}\n\n${notice.publicReference} · ${amount}\n${notice.machineLabel}, ${notice.locationName}\nOpen case: ${caseUrl}\n\n${navigation}`;
  const html = `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#f1f5f9;color:#172535;font-family:Arial,sans-serif"><main style="box-sizing:border-box;max-width:640px;margin:0 auto;padding:24px;background:#fff;line-height:1.5;overflow-wrap:anywhere"><h1 style="font-size:22px;line-height:1.25;margin:0 0 16px">Refund decision ready</h1><p><strong>${escapeHtml(action)}</strong></p><p>${escapeHtml(reason)}</p><p><strong>${escapeHtml(notice.publicReference)}</strong> · ${escapeHtml(amount)}<br>${escapeHtml(notice.machineLabel)} · ${escapeHtml(notice.locationName)}</p><p><a href="${escapeHtml(caseUrl)}" style="color:#174a77">Open refund case ${escapeHtml(notice.publicReference)}</a></p><p style="font-size:13px;color:#435466">${escapeHtml(navigation)}</p></main></body></html>`;
  return { subject, text, html };
};
