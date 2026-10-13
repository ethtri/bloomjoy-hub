import { supabaseClient } from '@/lib/supabaseClient';
import { withRequestTimeout } from './requestTimeout';
import { parseRefundPortalQueueProjection, type RefundPortalQueueProjection } from './refundPortalQueue';

// Shared identity lets every protected refund reader redact the same access error.
export class RefundCaseAccessError extends Error {
  constructor() { super('This case is not available in your current assignments.'); }
}

// Keep the initial queue independent of the full case-review module.
export const fetchRefundPortalQueueProjection = async (parentSignal?: AbortSignal): Promise<RefundPortalQueueProjection> => {
  const result = await withRequestTimeout(async signal => await supabaseClient.rpc('get_refund_portal_queue_projection', {
    p_observed_at: new Date().toISOString(),
  }).abortSignal(signal), 10_000, parentSignal);
  if (result.error?.code === '42501') throw new RefundCaseAccessError();
  if (result.error) throw new Error(result.error.message || 'Unable to load the refund queue.');
  return parseRefundPortalQueueProjection(result.data);
};
