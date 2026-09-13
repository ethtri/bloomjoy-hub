import type {
  RefundCustomerOutreachContract,
  RefundCustomerOutreachState,
} from './refundLifecycle.ts';

export type RefundCustomerOutreachTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export type RefundCustomerOutreachPresentation = {
  label: string;
  explanation: string;
  nextStep: string;
  tone: RefundCustomerOutreachTone;
  operationsDetail: string | null;
};

const copy: Record<RefundCustomerOutreachState, Omit<RefundCustomerOutreachPresentation, 'operationsDetail'>> = {
  none: {
    label: 'Customer follow-up not needed',
    explanation: 'Bloomjoy does not currently need another detail from the customer.',
    nextStep: 'Continue with the case state shown here.',
    tone: 'neutral',
  },
  preparing: {
    label: 'Preparing the request',
    explanation: 'Bloomjoy is preparing one request for the specific purchase details still needed.',
    nextStep: 'No manager action is needed while the system prepares the request.',
    tone: 'info',
  },
  queued: {
    label: 'Request queued',
    explanation: 'The customer request is queued but has not been confirmed as delivered.',
    nextStep: 'Wait for delivery confirmation. Do not send another request.',
    tone: 'info',
  },
  sent_unconfirmed: {
    label: 'Confirming delivery',
    explanation: 'The saved request was sent to the delivery provider, but customer delivery is not confirmed.',
    nextStep: 'Wait for delivery evidence. Do not tell the customer they were contacted yet.',
    tone: 'info',
  },
  waiting_for_customer: {
    label: 'Waiting for customer',
    explanation: 'The request was delivered and Bloomjoy is waiting for the customer to reply.',
    nextStep: 'Wait for the reply in the existing customer conversation. Do not send another request.',
    tone: 'warning',
  },
  delivery_failed: {
    label: 'Customer request not delivered',
    explanation: 'The saved request has a confirmed delivery failure. The customer is not treated as contacted.',
    nextStep: 'Check the original customer email thread and the saved delivery record before sending anything again.',
    tone: 'warning',
  },
  delivery_unknown: {
    label: 'Customer request delivery unknown',
    explanation: 'Bloomjoy cannot confirm whether the saved request reached the customer.',
    nextStep: 'Check the original customer email thread and confirm what happened before sending a new request.',
    tone: 'warning',
  },
  customer_replied: {
    label: 'New information received',
    explanation: 'The customer replied on the same case with updated purchase information.',
    nextStep: 'Bloomjoy will recheck the updated details automatically.',
    tone: 'success',
  },
  rechecking: {
    label: 'Rechecking the purchase',
    explanation: 'Bloomjoy is comparing the customer’s updated details with current transaction evidence.',
    nextStep: 'No manager action is needed while the recheck runs.',
    tone: 'info',
  },
  clarification_exhausted: {
    label: 'Customer follow-up needs a decision',
    explanation: 'The existing customer requests did not resolve the case.',
    nextStep: 'Review the original conversation. If the last necessary request was delivered 30 days ago and there is no reply, recommend rejection. Otherwise ask only for a still-missing fact.',
    tone: 'warning',
  },
  policy_suppressed: {
    label: 'Customer request suppressed',
    explanation: 'Bloomjoy did not contact the customer because the automatic request was blocked by policy.',
    nextStep: 'Follow the assigned owner and action shown for this case.',
    tone: 'warning',
  },
  manual_fallback: {
    label: 'Customer details needed',
    explanation: 'The automatic message was not sent. A manager may request only the purchase details still needed.',
    nextStep: 'Select Request details once to continue in the existing customer conversation.',
    tone: 'warning',
  },
};

const safeCodeLabel = (value: string) => value.replaceAll('_', ' ');

export const getRefundCustomerOutreachPresentation = (
  outreach: RefundCustomerOutreachContract,
  options: { canViewOperationsDetail?: boolean } = {},
): RefundCustomerOutreachPresentation => {
  const presentation = copy[outreach.state];
  const detailCode = outreach.failureCode ?? outreach.reasonCode;
  return {
    ...presentation,
    operationsDetail: options.canViewOperationsDetail && detailCode
      ? `Internal category: ${safeCodeLabel(detailCode)}`
      : null,
  };
};

export const isRefundCustomerOutreachSystemOwned = (
  outreach: RefundCustomerOutreachContract | null | undefined,
) => outreach?.owner === 'System';

export const canRequestRefundCustomerDetailsManually = (
  outreach: RefundCustomerOutreachContract | null | undefined,
) => outreach?.state === 'manual_fallback' &&
  outreach.owner === 'Machine Manager' &&
  outreach.nextAction === 'request_details' &&
  outreach.manualFallbackEligible === true &&
  outreach.requestedFields.length > 0;
