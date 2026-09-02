export type ReceiptNoticeChoice = { id: string; sentAt: string; subject: string; plainBody: string };
export const hasConfirmedRefundReceipt = (value: { lifecycle?: { reasonCode?: string; paymentState?: string; stage?: string } | null }) =>
  value.lifecycle?.reasonCode === 'settlement_time_unknown' && value.lifecycle.paymentState === 'confirmed' &&
  ['refund_confirmed', 'customer_notified'].includes(value.lifecycle.stage ?? '');
const bindingKinds = ['modern_authorized_manual', 'legacy_manual_portal_observation', 'no_attempt_integrity_hold', 'unverified_attempt'] as const;
export const refundReceiptRefreshQueryKeys = [
  ['admin-refund-operations-overview'],
  ['nayax-card-refund-availability'],
  ['refund-authoritative-receipt'],
  ['refund-nayax-resolution-readiness'],
  ['refund-gmail-case-context'],
  ['refund-case-reconciliation'],
  ['refund-legacy-machine-correction-options'],
] as const;

export async function refreshRefundReceiptViews(
  invalidate: (queryKey: readonly string[]) => Promise<unknown>,
) {
  await Promise.all(refundReceiptRefreshQueryKeys.map((queryKey) => invalidate(queryKey)));
}

export type RefundReceiptOverview = {
  schemaVersion: 'refund_receipt_overview_v1'; visible: boolean;
  caseId: string; caseReference: string; expectedCaseVersion: number; canRecord: boolean;
  attemptId: string | null; accountScope: string; providerMachineId: string;
  attemptBindingKind: typeof bindingKinds[number];
  originalTransactionId: string; originalAmountCents: number; currencyCode: string;
  receipt: null | { id: string; observedAt: string; settlementTimePrecision: 'unknown';
    noticeAdopted: boolean; noticeSentAt: string | null; managerCcVerified: boolean | null };
  noticeChoices: ReceiptNoticeChoice[];
};

// Review is bound to the exact rendered evidence, including current case version
// and actual notice content. A same-case background refresh cannot rebase it.
export const refundReceiptReviewSnapshot = (value: RefundReceiptOverview | null | undefined) => value ? JSON.stringify(value) : '';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const bounded = (value: unknown, max: number) => typeof value === 'string' && value.length > 0 && value.length <= max;

export function parseRefundReceiptOverview(value: unknown): RefundReceiptOverview | null {
  const v = record(value);
  if (v.schemaVersion !== 'refund_receipt_overview_v1' || typeof v.visible !== 'boolean') throw new Error('Receipt evidence is unavailable.');
  if (!v.visible) return null;
  if (!uuid(v.caseId) || !bounded(v.caseReference, 120) || !Number.isSafeInteger(v.expectedCaseVersion) || Number(v.expectedCaseVersion) < 1 ||
    typeof v.canRecord !== 'boolean' || !bindingKinds.some((kind) => kind === v.attemptBindingKind) || (v.attemptId !== null && !uuid(v.attemptId)) || !bounded(v.accountScope, 100) ||
    !bounded(v.providerMachineId, 120) || !bounded(v.originalTransactionId, 120) || !Number.isSafeInteger(v.originalAmountCents) ||
    Number(v.originalAmountCents) <= 0 || typeof v.currencyCode !== 'string' || !/^[A-Z]{3}$/.test(v.currencyCode) ||
    !Array.isArray(v.noticeChoices) || v.noticeChoices.length > 20) throw new Error('Reload the selected transaction evidence.');
  const receipt = record(v.receipt);
  if (v.receipt !== null && (!uuid(receipt.id) || !date(receipt.observedAt) || receipt.settlementTimePrecision !== 'unknown' ||
    typeof receipt.noticeAdopted !== 'boolean' || (receipt.noticeSentAt !== null && !date(receipt.noticeSentAt)) ||
    (receipt.managerCcVerified !== null && typeof receipt.managerCcVerified !== 'boolean'))) throw new Error('Reload the saved receipt evidence.');
  const choices = v.noticeChoices.map((item) => {
    const n = record(item);
    if (!uuid(n.id) || !date(n.sentAt) || typeof n.subject !== 'string' || !bounded(n.plainBody, 100000)) throw new Error('Reload the original thread evidence.');
    return { id: n.id as string, sentAt: n.sentAt as string, subject: n.subject, plainBody: n.plainBody as string };
  });
  return {
    schemaVersion: 'refund_receipt_overview_v1', visible: true, caseId: v.caseId as string,
    caseReference: v.caseReference as string, expectedCaseVersion: v.expectedCaseVersion as number,
    canRecord: v.canRecord, attemptId: v.attemptId as string | null, accountScope: v.accountScope as string,
    attemptBindingKind: v.attemptBindingKind as RefundReceiptOverview['attemptBindingKind'],
    providerMachineId: v.providerMachineId as string, originalTransactionId: v.originalTransactionId as string,
    originalAmountCents: v.originalAmountCents as number, currencyCode: v.currencyCode,
    receipt: v.receipt === null ? null : { id: receipt.id as string, observedAt: receipt.observedAt as string,
      settlementTimePrecision: 'unknown', noticeAdopted: receipt.noticeAdopted as boolean,
      noticeSentAt: receipt.noticeSentAt as string | null, managerCcVerified: receipt.managerCcVerified as boolean | null },
    noticeChoices: choices,
  };
}

export function buildReceiptRecordRequest(v: RefundReceiptOverview, evidenceReference: string, reviewed: boolean) {
  if (!v.canRecord || v.receipt || !reviewed || evidenceReference !== `DTM:NAYAX-${v.originalTransactionId}`) throw new Error('Verify the exact full refund before recording it.');
  return { mode: 'record_authoritative_receipt', caseId: v.caseId, attemptId: v.attemptId,
    expectedCaseVersion: v.expectedCaseVersion, accountScope: v.accountScope, providerMachineId: v.providerMachineId,
    originalTransactionId: v.originalTransactionId, originalAmountCents: v.originalAmountCents,
    refundedAmountCents: v.originalAmountCents, currencyCode: v.currencyCode, providerStatus: 62, evidenceReference,
    reviewedCurrentProviderObservation: true };
}

export function buildReceiptAdoptionRequest(v: RefundReceiptOverview, messageId: string, reviewed: boolean) {
  if (!v.receipt || v.receipt.noticeAdopted || !reviewed || !v.noticeChoices.some((n) => n.id === messageId)) throw new Error('Review this exact case’s existing sent notice first.');
  return { mode: 'adopt_completion_notice', caseId: v.caseId, receiptId: v.receipt.id, gmailMessageId: messageId,
    expectedCaseVersion: v.expectedCaseVersion, completionCaseReference: v.caseReference,
    completionOriginalTransactionId: v.originalTransactionId, completionAmountCents: v.originalAmountCents,
    reviewedFullRefundNotice: true };
}

export type RefundMachineCorrectionTarget = {
  inventoryId: string; inventoryEvidenceDigest: string; reportingMachineId: string;
  machineLabel: string; accountScope: string; providerMachineId: string; machineNumber: string;
};
export type RefundMachineCorrectionOptions = {
  schemaVersion: 'refund_legacy_machine_correction_options_v1'; caseId: string;
  expectedCaseVersion: number; oldMachineId: string; targets: RefundMachineCorrectionTarget[];
  payloadRedacted: true;
};
export type RefundMachineCorrectionEvidence = {
  schemaVersion: 'refund_legacy_machine_correction_v1'; correctionId: string; receiptId: string;
  recordedAt: string; historicalEvidencePreserved: true; payloadRedacted: true;
};

export function parseRefundMachineCorrectionEvidence(value: unknown): RefundMachineCorrectionEvidence | null {
  if (value == null) return null;
  const v = record(value);
  if (v.schemaVersion !== 'refund_legacy_machine_correction_v1' || !uuid(v.correctionId) || !uuid(v.receiptId) ||
    !date(v.recordedAt) || v.historicalEvidencePreserved !== true || v.payloadRedacted !== true) {
    throw new Error('Reload the saved machine correction evidence.');
  }
  return { schemaVersion: 'refund_legacy_machine_correction_v1', correctionId: v.correctionId as string,
    receiptId: v.receiptId as string, recordedAt: v.recordedAt as string, historicalEvidencePreserved: true, payloadRedacted: true };
}

export function parseRefundMachineCorrectionOptions(value: unknown): RefundMachineCorrectionOptions {
  const v = record(value);
  if (v.schemaVersion !== 'refund_legacy_machine_correction_options_v1' || !uuid(v.caseId) || !uuid(v.oldMachineId) ||
    !Number.isSafeInteger(v.expectedCaseVersion) || Number(v.expectedCaseVersion) < 1 || v.payloadRedacted !== true ||
    !Array.isArray(v.targets)) throw new Error('Current machine review is unavailable.');
  const targets = v.targets.map((item) => {
    const t = record(item);
    if (!uuid(t.inventoryId) || !uuid(t.reportingMachineId) || t.reportingMachineId === v.oldMachineId ||
      typeof t.inventoryEvidenceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(t.inventoryEvidenceDigest) ||
      !bounded(t.machineLabel, 240) || !bounded(t.accountScope, 100) || !bounded(t.providerMachineId, 120) ||
      typeof t.machineNumber !== 'string' || !/^[0-9]{1,120}$/.test(t.machineNumber)) throw new Error('Reload current inventory evidence.');
    return { inventoryId: t.inventoryId as string, inventoryEvidenceDigest: t.inventoryEvidenceDigest,
      reportingMachineId: t.reportingMachineId as string, machineLabel: t.machineLabel as string,
      accountScope: t.accountScope as string, providerMachineId: t.providerMachineId as string, machineNumber: t.machineNumber };
  });
  if (new Set(targets.map((t) => t.inventoryId)).size !== targets.length) throw new Error('Ambiguous inventory evidence.');
  return { schemaVersion: 'refund_legacy_machine_correction_options_v1', caseId: v.caseId as string,
    expectedCaseVersion: v.expectedCaseVersion as number, oldMachineId: v.oldMachineId as string, targets, payloadRedacted: true };
}

// Bind review to the whole currently rendered case AND all current inventory evidence.
export const refundMachineCorrectionReviewSnapshot = (v: RefundReceiptOverview, options: RefundMachineCorrectionOptions,
  inventoryId: string, context: { machineLabel: string; locationName: string; expectedCaseVersion?: number },
  evidenceReference: string, machineNumber: string) => JSON.stringify({ v, options, inventoryId, context, evidenceReference, machineNumber });

export function buildRefundMachineCorrectionRequest(v: RefundReceiptOverview, options: RefundMachineCorrectionOptions,
  inventoryId: string, machineNumber: string, evidenceReference: string, reviewed: boolean, currentCaseVersion?: number) {
  const t = options.targets.find((target) => target.inventoryId === inventoryId);
  if (!reviewed || !v.canRecord || v.receipt || v.attemptBindingKind !== 'legacy_manual_portal_observation' || !uuid(v.attemptId) ||
    v.caseId !== options.caseId || v.expectedCaseVersion !== options.expectedCaseVersion || currentCaseVersion !== v.expectedCaseVersion ||
    !t || t.accountScope !== v.accountScope || t.machineNumber !== machineNumber ||
    evidenceReference !== `DTM:NAYAX-${v.originalTransactionId}`) throw new Error('Review the current case and exact provider machine again.');
  return { ...buildReceiptRecordRequest(v, evidenceReference, true), mode: 'correct_legacy_machine_and_record_observation',
    expectedOldMachineId: options.oldMachineId, targetMachineId: t.reportingMachineId, inventoryId: t.inventoryId,
    inventoryEvidenceDigest: t.inventoryEvidenceDigest, accountScope: t.accountScope,
    providerMachineId: t.providerMachineId, machineNumber: t.machineNumber };
}
