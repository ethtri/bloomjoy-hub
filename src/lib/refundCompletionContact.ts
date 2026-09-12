export const refundCompletionContactStates = [
  'none', 'pending', 'sent', 'delivered', 'failed',
  'delivery_unconfirmed', 'bounced', 'complained',
] as const;

export type RefundCompletionContactState = typeof refundCompletionContactStates[number];

export type RefundCompletionContactPresentation = {
  state: RefundCompletionContactState;
  label: string;
  detail: string;
  nextAction: string;
  progressLabel: string;
  tone: 'neutral' | 'info' | 'success' | 'warning';
};

export type RefundCompletionHistoryPresentation = {
  badgeLabel: 'Completion update record';
  timeLabel: 'recorded';
  recordedAt: string;
};

/** Historical rows stay tied to their own record; case-level contact proof has no message identity. */
export const getRefundCompletionHistoryPresentation = (
  message: { messageType: string; createdAt: string },
): RefundCompletionHistoryPresentation | null => message.messageType === 'completed'
  ? { badgeLabel: 'Completion update record', timeLabel: 'recorded', recordedAt: message.createdAt }
  : null;

export const getRefundCompletionContactState = (
  lifecycle: { messageState?: ({ state: string } & Record<string, unknown>) | null },
): RefundCompletionContactState => {
  const state = lifecycle.messageState?.state;
  if (state === 'queued' || state === 'claimed') return 'pending';
  return refundCompletionContactStates.includes(state as RefundCompletionContactState)
    ? state as RefundCompletionContactState
    : 'delivery_unconfirmed';
};

/** One vocabulary for queue, detail, progress, history and customer status. */
export const getRefundCompletionContactPresentation = (
  lifecycle: { messageState?: ({ state: string } & Record<string, unknown>) | null },
): RefundCompletionContactPresentation => {
  const state = getRefundCompletionContactState(lifecycle);
  switch (state) {
    case 'none': return {
      state, label: 'Refund confirmed · update needs preparation',
      detail: 'The refund is confirmed, but no customer completion update is recorded.',
      nextAction: 'Do not retry payment. Prepare the existing customer update once and confirm its delivery.',
      progressLabel: 'Update needs preparation', tone: 'warning',
    };
    case 'pending': return {
      state, label: 'Refund confirmed · update queued',
      detail: 'The refund is confirmed and its saved customer update is queued or sending.',
      nextAction: 'Do not retry payment. Wait for the existing delivery attempt and do not resend.',
      progressLabel: 'Update queued', tone: 'info',
    };
    case 'sent': return {
      state, label: 'Refund confirmed · update sent',
      detail: 'The email provider accepted the saved customer update. Inbox delivery is not confirmed.',
      nextAction: 'Do not retry payment or resend. No customer-contact action is needed.',
      progressLabel: 'Update sent', tone: 'success',
    };
    case 'delivered': return {
      state, label: 'Refund confirmed · update delivered',
      detail: 'A provider callback confirms delivery of the saved customer update.',
      nextAction: 'Do not retry payment or resend. No customer-contact action is needed.',
      progressLabel: 'Update delivered', tone: 'success',
    };
    case 'failed': return {
      state, label: 'Refund confirmed · update could not be sent',
      detail: 'The saved customer update has a definite send failure.',
      nextAction: 'Do not retry payment. Use the existing supported delivery-repair action.',
      progressLabel: 'Update needs repair', tone: 'warning',
    };
    case 'delivery_unconfirmed': return {
      state, label: 'Refund confirmed · update outcome unconfirmed',
      detail: 'The saved customer update may have reached the provider, but its send outcome is not confirmed.',
      nextAction: 'Do not retry payment. Inspect the existing delivery evidence and do not resend blindly.',
      progressLabel: 'Update needs review', tone: 'warning',
    };
    case 'bounced': return {
      state, label: 'Refund confirmed · contact needs review',
      detail: 'The email provider reported that the saved customer update bounced.',
      nextAction: 'Do not retry payment. Review the same-case contact details under existing authority.',
      progressLabel: 'Contact needs review', tone: 'warning',
    };
    case 'complained': return {
      state, label: 'Refund confirmed · contact needs review',
      detail: 'The email provider reported a complaint for the saved customer update.',
      nextAction: 'Do not retry payment or resend. Review the existing customer conversation and saved delivery record.',
      progressLabel: 'Contact needs review', tone: 'warning',
    };
  }
};
