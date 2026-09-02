import { supabaseClient } from '@/lib/supabaseClient';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { parseRefundReceiptOverview } from './refundAuthoritativeReceipt';

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
  return result;
}
