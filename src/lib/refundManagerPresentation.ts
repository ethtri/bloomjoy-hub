import type {
  RefundDecisionRecommendation,
  RefundLifecycleContract,
} from './refundLifecycle.ts';
import { isRefundCaseOpen } from './refundQueue.ts';

export type RefundManagerPresentationCase = {
  lifecycle?: RefundLifecycleContract | null;
  status: string;
  paymentMethod: 'card' | 'cash' | 'unknown';
  paymentAmountCents?: number | null;
  zellePaymentContact?: string | null;
  decision?: 'approved' | 'denied' | null;
  workflowProjectionUnavailable?: boolean;
  canPerformOfficialAction?: boolean;
  officialActionVersion?: number;
  customerFactEvidence?: { factVersion: number } | null;
};

const recommendationMatchesCase = (
  item: RefundManagerPresentationCase,
  recommendation: RefundDecisionRecommendation,
) => {
  const nextWork = item.lifecycle?.nextWork;
  if (item.paymentMethod !== 'card' && item.paymentMethod !== 'cash') return false;
  const expectedAction = recommendation.kind === 'refund'
    ? 'approve_or_deny_request'
    : 'reject_request';
  const expectedSources = item.paymentMethod === 'card' ? ['nayax'] : ['sunze', 'snapcase'];

  return recommendation.decisionReady === true &&
    item.decision == null &&
    item.canPerformOfficialAction === true &&
    Number.isSafeInteger(item.officialActionVersion) &&
    recommendation.officialActionVersion === item.officialActionVersion &&
    Number.isSafeInteger(item.customerFactEvidence?.factVersion) &&
    recommendation.deterministicFactVersion === item.customerFactEvidence?.factVersion &&
    nextWork?.isOpen === true &&
    nextWork.actor === 'manager' &&
    nextWork.actionCode === expectedAction &&
    (recommendation.kind === 'reject' || expectedSources.includes(recommendation.purchase?.source ?? ''));
};

/** A decision is a fresh server recommendation, never a locally ranked candidate. */
export const refundDecisionRecommendation = (
  item: RefundManagerPresentationCase,
): RefundDecisionRecommendation | null => {
  const recommendation = item.lifecycle?.decisionRecommendation;
  return recommendation && recommendationMatchesCase(item, recommendation)
    ? recommendation
    : null;
};

export const refundNeedsDecision = (item: RefundManagerPresentationCase) =>
  Boolean(refundDecisionRecommendation(item));

/** Canonical Agent/System work can retain provider evidence without exposing Manager inventory. */
export const refundCanShowCandidateInventory = (item: RefundManagerPresentationCase) => {
  const work = item.lifecycle?.nextWork;
  return !work || work.isOpen !== true || work.actor === 'manager';
};

/** Customer wait requires proof that one real question was sent and is still unanswered. */
export const refundIsWaitingOnCustomer = (item: RefundManagerPresentationCase) => {
  const work = item.lifecycle?.nextWork;
  const outreach = item.lifecycle?.customerOutreach;
  return isRefundCaseOpen(item) &&
    work?.isOpen === true &&
    work.actor === 'customer' &&
    work.actionCode === 'answer_question' &&
    outreach?.state === 'waiting_for_customer' &&
    outreach.owner === 'Customer' &&
    outreach.nextAction === 'wait_for_customer' &&
    typeof outreach.requestMessageId === 'string' && outreach.requestMessageId.length > 0 &&
    typeof outreach.requestSentAt === 'string' && !Number.isNaN(Date.parse(outreach.requestSentAt)) &&
    outreach.replyReceivedAt === null;
};

export const refundManagerView = (item: RefundManagerPresentationCase) =>
  !isRefundCaseOpen(item) ? 'completed' as const
  : refundNeedsDecision(item) ? 'decisions' as const
  : refundIsWaitingOnCustomer(item) ? 'waiting_on_customer' as const
  : 'all_open' as const;

export const refundPlainStatus = (item: RefundManagerPresentationCase): string => {
  const work = item.lifecycle?.nextWork;
  const recommendation = refundDecisionRecommendation(item);
  if (recommendation) return recommendation.kind === 'reject' ? 'Review rejection' : 'Decision needed';
  if (!isRefundCaseOpen(item) || work?.isOpen === false) return 'Closed';
  if (work?.actionCode === 'send_cash_refund_and_confirm') return 'Send cash refund';
  if (refundIsWaitingOnCustomer(item)) return 'Waiting on customer';
  if (item.decision === 'approved') return 'Refund being completed';
  if (item.decision === 'denied') return 'Notifying customer';

  switch (work?.actionCode) {
    case 'deliver_customer_question':
    case 'obtain_payout_destination':
      return 'Sending customer question';
    case 'review_customer_reply':
      return 'Reviewing customer reply';
    case 'recover_customer_delivery':
      return 'Fixing customer delivery';
    case 'reconcile_provider_outcome':
      return 'Checking refund result';
    case 'reconcile_integrity':
      return 'Checking payment record';
    case 'continue_refund':
      return 'Completing refund';
    case 'resolve_manager_assignment':
      return 'Assigning manager';
    case 'repair_provider_setup':
      return 'Fixing purchase search';
    case 'research_purchase':
    case 'prepare_manager_decision':
    case 'run_lookup':
    case 'none':
    case undefined:
      return 'Finding the purchase';
    default:
      return work?.actor === 'manager' ? 'Manager action needed' : 'Bloomjoy is working';
  }
};
