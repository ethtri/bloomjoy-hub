export type ExternalRecoveryTarget = { machineId: string; machineLabel: string; inventoryId: string;
  inventoryDigest: string; accountScope: string; providerMachineId: string; machineNumber: string };
export type ExternalRecoveryOptions = { schemaVersion: 'refund_external_recovery_v1'; available: boolean; recorded: boolean;
  caseId?: string; caseReference?: string; expectedCaseVersion?: number; oldMachineId?: string;
  customerEmail?: string; reportedAmountCents?: number; cardLast4?: string; incidentAt?: string;
  reviewBinding?: string; targets?: ExternalRecoveryTarget[]; receiptId?: string; noticeSentAt?: string };
export type ExternalRecoveryForm = { targetMachineId: string; transactionId: string; siteId: string; machineTime: string;
  amount: string; providerMessageId: string; providerThreadId: string; rfcMessageId: string; sentAt: string;
  ccEmails: string; subject: string; plainBody: string };
export const emptyExternalRecoveryForm: ExternalRecoveryForm = { targetMachineId: '', transactionId: '', siteId: '',
  machineTime: '', amount: '', providerMessageId: '', providerThreadId: '', rfcMessageId: '', sentAt: '',
  ccEmails: '', subject: '', plainBody: '' };
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value: unknown, max = 320) => typeof value === 'string' && value.length > 0 && value.length <= max;
export function parseExternalRecoveryOptions(value: unknown): ExternalRecoveryOptions {
  const v = value as ExternalRecoveryOptions;
  if (!v || v.schemaVersion !== 'refund_external_recovery_v1' || typeof v.available !== 'boolean' || typeof v.recorded !== 'boolean')
    throw new Error('Recovery review is unavailable.');
  if (v.recorded && (!uuid(v.caseId) || !uuid(v.receiptId) || !v.noticeSentAt || !Number.isFinite(Date.parse(v.noticeSentAt)) || v.available))
    throw new Error('Reload the recorded refund evidence.');
  if (v.available && (!uuid(v.caseId) || !uuid(v.oldMachineId) || !Number.isSafeInteger(v.expectedCaseVersion) || v.expectedCaseVersion! < 1 ||
    !text(v.caseReference) || !text(v.customerEmail) || !digest(v.reviewBinding) || !Array.isArray(v.targets) || !v.targets.length ||
    v.targets.length > 100 || v.targets.some(t => !uuid(t.machineId) || !uuid(t.inventoryId) || !digest(t.inventoryDigest) ||
      !text(t.machineLabel) || !text(t.accountScope, 100) || !text(t.providerMachineId, 120) || !text(t.machineNumber, 120))))
    throw new Error('Reload the current case and verified machine choices.');
  return v;
}
export function buildExternalRecoveryEvidence(v: ExternalRecoveryOptions, f: ExternalRecoveryForm, reviewed: boolean) {
  const target = v.targets?.find(t => t.machineId === f.targetMachineId);
  const amountCents = Math.round(Number(f.amount) * 100);
  if (!v.available || v.recorded || !target || !reviewed || !/^\d{1,30}$/.test(f.transactionId) ||
    !/^\d{1,9}$/.test(f.siteId) || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,9})?$/.test(f.machineTime) ||
    !/^\d+(\.\d{1,2})?$/.test(f.amount) || !Number.isSafeInteger(amountCents) || amountCents <= 0 ||
    !/^[a-f0-9]{8,64}$/.test(f.providerMessageId) || !/^[a-f0-9]{8,64}$/.test(f.providerThreadId) ||
    !/^<[^<>\s]{3,996}>$/.test(f.rfcMessageId) || !Number.isFinite(Date.parse(f.sentAt)) || !/(Z|[+-]\d{2}:\d{2})$/.test(f.sentAt) ||
    !text(f.subject, 998) || !text(f.plainBody, 60000) || !f.plainBody.includes(v.caseReference!) ||
    !f.plainBody.includes(`$${(amountCents / 100).toFixed(2)}`)) throw new Error('Complete and review the original refund and sent-email details.');
  const ccEmails = [...new Set(f.ccEmails.split(/[,;\n]/).map(s => s.trim().toLowerCase()).filter(Boolean))].sort();
  if (!ccEmails.length || ccEmails.length > 20 || ccEmails.some(s => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s)))
    throw new Error('Enter the CC addresses shown on the sent email.');
  return { expectedCaseVersion: v.expectedCaseVersion, oldMachineId: v.oldMachineId, reviewBinding: v.reviewBinding,
    targetMachineId: target.machineId, inventoryId: target.inventoryId, inventoryDigest: target.inventoryDigest,
    accountScope: target.accountScope, providerMachineId: target.providerMachineId, machineNumber: target.machineNumber,
    originalTransactionId: f.transactionId, siteId: Number(f.siteId), machineAuthorizationTime: f.machineTime,
    originalAmountCents: amountCents, refundedAmountCents: amountCents, currencyCode: 'USD', providerStatus: 62,
    evidenceReference: `DTM:NAYAX-${f.transactionId}`, cardLast4: v.cardLast4,
    reviewedRefund: true, reviewedMatch: true, reviewedSentNotice: true,
    notice: { senderEmail: 'info@bloomjoysweets.com', replyToEmail: 'info@bloomjoysweets.com', recipientEmail: v.customerEmail,
      ccEmails, providerMessageId: f.providerMessageId, providerThreadId: f.providerThreadId, rfcMessageId: f.rfcMessageId,
      sentAt: new Date(f.sentAt).toISOString(), subject: f.subject, plainBody: f.plainBody } };
}
