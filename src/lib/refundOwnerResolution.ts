import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { supabaseClient } from '@/lib/supabaseClient';

export type OwnerResolutionContext = { caseId: string; caseReference: string; caseVersion: number; factVersion: number;
  ownerReviewBinding: string; recipientEmail: string; ownerMailboxEmail: string; canAdopt: boolean };
export type OwnerResolutionFields = { intentId: string; providerMessageId: string; providerThreadId: string;
  originalSentAt: string; exactSentBody: string };
const hex64 = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9-]{27}$/i;

export const parseOwnerResolutionContext = (data: unknown): OwnerResolutionContext | null => {
  const v = data as Partial<OwnerResolutionContext> | null;
  return v && uuid.test(String(v.caseId)) && /^RF-[A-Z0-9-]+$/.test(String(v.caseReference)) &&
    Number.isSafeInteger(v.caseVersion) && Number(v.caseVersion) > 0 && Number.isSafeInteger(v.factVersion) &&
    Number(v.factVersion) > 0 && hex64.test(String(v.ownerReviewBinding)) && typeof v.recipientEmail === 'string' &&
    typeof v.ownerMailboxEmail === 'string' && typeof v.canAdopt === 'boolean' ? v as OwnerResolutionContext : null;
};
export async function fetchOwnerResolutionContext(caseId: string) {
  const { data, error } = await supabaseClient.rpc('admin_get_refund_owner_resolution_context', { p_case_id: caseId });
  if (error) throw new Error('This resolution needs current Refund Operations access.');
  const parsed = parseOwnerResolutionContext(data);
  if (!parsed) throw new Error('Reload the current case before recording this resolution.');
  return parsed;
}
export async function sha256Text(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function buildOwnerResolutionRequest(v: OwnerResolutionContext, fields: OwnerResolutionFields) {
  if (!v.canAdopt || !uuid.test(fields.intentId) || !/^[a-f0-9]{8,64}$/.test(fields.providerMessageId) ||
    !/^[a-f0-9]{8,64}$/.test(fields.providerThreadId) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(fields.originalSentAt) ||
    !fields.exactSentBody.trim()) throw new Error('Complete the exact sent-resolution review.');
  return { mode: 'adopt_owner_nonrefund_resolution', caseId: v.caseId, intentId: fields.intentId,
    expectedCaseVersion: v.caseVersion, expectedFactVersion: v.factVersion, caseReference: v.caseReference,
    providerMessageId: fields.providerMessageId, providerThreadId: fields.providerThreadId, originalSentAt: fields.originalSentAt,
    recipientEmail: v.recipientEmail, reviewedMessageDigest: await sha256Text(fields.exactSentBody),
    expectedOwnerReviewBinding: v.ownerReviewBinding, reasonCode: 'not_operated_by_bloomjoy',
    reviewedOwnedMailboxSent: true, reviewedExactCaseResolution: true };
}
export async function saveOwnerResolution(request: Record<string, unknown>) {
  const result = await invokeEdgeFunction<Record<string, unknown>>('refund-case-admin-update', request, { requireUserAuth: true });
  if (result.status !== 'adopted' || result.noticeVerification !== 'operator_observed' || result.customerMessageSent !== false ||
    result.paymentAction !== false || result.payloadRedacted !== true || !uuid.test(String(result.adoptionId))) {
    throw new Error('Reload the saved resolution before another action.');
  }
  return result;
}
