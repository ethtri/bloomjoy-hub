import { supabaseClient } from '@/lib/supabaseClient';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { parseRefundReceiptOverview, parseRefundMachineCorrectionOptions } from './refundAuthoritativeReceipt';

export async function fetchRefundReceiptOverview(caseId: string) {
  const { data, error } = await supabaseClient.rpc('admin_get_refund_authoritative_receipt_overview', { p_case_id: caseId });
  if (error) throw new Error('Receipt review is unavailable. Check your current machine access and reload.');
  return parseRefundReceiptOverview(data);
}

export async function saveRefundReceiptEvidence(input: Record<string, unknown>) {
  const result = await invokeEdgeFunction('refund-case-admin-update', input, { requireUserAuth: true });
  if (!result || result.customerMessageSent !== false || result.payloadRedacted !== true ||
    !['recorded', 'already_recorded', 'adopted', 'already_adopted'].includes(String(result.status))) {
    throw new Error('Reload the saved evidence before another action.');
  }
  if (input.mode === 'correct_legacy_machine_and_record_observation' && (result.status !== 'recorded' ||
    result.machineCorrected !== true || typeof result.correctionId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(result.correctionId) || typeof result.receiptId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(result.receiptId) || result.paymentConfirmed !== true ||
    result.accountingPending !== true || result.settlementTimePrecision !== 'unknown')) throw new Error('Reload the saved machine correction evidence.');
  if (input.mode === 'record_historical_owner_notice' && (!['adopted', 'already_adopted'].includes(String(result.status)) ||
    result.noticeSource !== 'historical_owner_mailbox' || result.noticeVerification !== 'operator_observed' ||
    result.supportThread !== false || result.managerCcVerified !== false)) throw new Error('Reload the historical notice provenance.');
  return result;
}

export async function fetchRefundMachineCorrectionOptions(caseId: string) {
  const { data, error } = await supabaseClient.rpc('admin_get_refund_legacy_machine_correction_options', { p_case_id: caseId });
  if (error) throw new Error('Machine review requires current Super Admin access and active manager assignments.');
  return parseRefundMachineCorrectionOptions(data);
}

export async function queueRefundReceiptCompletion(input: ReturnType<typeof import('./refundAuthoritativeReceipt').buildReceiptCompletionRequest>) {
  const { data, error } = await supabaseClient.rpc('admin_queue_refund_receipt_completion', input);
  if (error || !data || data.enqueued !== true || data.payloadRedacted !== true ||
    typeof data.messageId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(data.messageId) ||
    !['queued', 'claimed', 'sent', 'failed', 'delivery_unknown'].includes(String(data.outboxState))) {
    throw new Error('Reload the existing completion message before another action.');
  }
  return data;
}
