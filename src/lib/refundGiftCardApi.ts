import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { supabaseClient } from '@/lib/supabaseClient';
import { requireRefundGiftCardOffer, requireRefundGiftCardStatus, type RefundGiftCardStatus } from './refundGiftCard';

export const fetchRefundGiftCardOffer = async (input: {
  machineId?: string; selectionKey?: string; amount: string; paymentMethod: 'card' | 'cash'; issueCategory?: 'partial_items' | 'expected_cash_change' | string;
}) => {
  const data = await invokeEdgeFunction<{ error?: string; offer?: unknown; gift_card_enabled?: unknown }>('refund-case-intake', {
    action: 'giftCardOffer', ...input,
  });
  if (typeof data.gift_card_enabled !== 'boolean') throw new Error('We could not load the gift card availability. Please try again.');
  return { giftCardEnabled: data.gift_card_enabled, offer: data.offer == null ? null : requireRefundGiftCardOffer(data.offer) };
};

export type RefundGiftCardManagerContext = RefundGiftCardStatus & {
  affected_amount: number;
  purchase_amount: number;
  cash_inserted_amount: number | null;
  expected_change_amount: number | null;
  review_reasons: string[];
  can_decide: boolean;
  can_resend: boolean;
  customer_email: string;
  prior_issued_count: number;
  latest_issued_at: string | null;
  previous_issuance?: { value: number; currency: string; issued_at: string; public_reference: string; eligible_locations: string[] } | null;
};

export const fetchRefundGiftCardManagerContext = async (caseId: string) => {
  const { data, error } = await supabaseClient.rpc('get_refund_gift_card_case', { p_case_id: caseId });
  if (error) throw new Error(error.message);
  const status = requireRefundGiftCardStatus(data);
  if (!status || typeof data.can_decide !== 'boolean' || !Number.isSafeInteger(data.prior_issued_count)) {
    throw new Error('Gift card review is temporarily unavailable.');
  }
  return { ...status, can_decide: data.can_decide, can_resend: data.can_resend === true, customer_email: typeof data.customer_email === 'string' ? data.customer_email : '', prior_issued_count: data.prior_issued_count,
    affected_amount: data.affected_amount ?? data.purchase_amount ?? data.value,
    purchase_amount: data.purchase_amount ?? data.value,
    cash_inserted_amount: data.cash_inserted_amount ?? null,
    expected_change_amount: data.expected_change_amount ?? null,
    review_reasons: Array.isArray(data.review_reasons) ? data.review_reasons : [],
    latest_issued_at: data.latest_issued_at, previous_issuance: data.previous_issuance } as RefundGiftCardManagerContext;
};

export const decideRefundGiftCard = (caseId: string, approve: boolean, notes: string, affectedAmountCents?: number) =>
  invokeEdgeFunction<{ ok?: boolean; error?: string }>('refund-case-admin-update', {
    action: approve ? 'approveGiftCard' : 'denyGiftCard', caseId, notes, affectedAmountCents,
  }, { requireUserAuth: true });

export const resendRefundGiftCard = (caseId: string, intentId: string, customerEmail: string) =>
  invokeEdgeFunction<{ gift_card?: unknown; error?: string }>('refund-case-admin-update', {
    action: 'resendGiftCard', caseId, intentId, customerEmail,
  }, { requireUserAuth: true });
