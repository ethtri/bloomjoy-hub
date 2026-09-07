import type { RefundCaseRecord } from './refundOperations';

export type CorrectionNoticeState = { initialized: boolean; seen: Set<string> };

/** Only actionable responses consume their key; a running recheck can finish later. */
export function collectCorrectionResponseNotices(state: CorrectionNoticeState, cases: RefundCaseRecord[]) {
  const ready = cases.filter((item) => {
    const correction = item.customerCorrection;
    return correction?.state === 'submitted' && correction.requestId && correction.respondedAt &&
      item.canPerformOfficialAction !== false && !item.lifecycle?.terminal &&
      !['completed', 'denied', 'cancelled'].includes(item.status) &&
      (correction.nextAction !== 'recheck' || ['completed', 'failed', 'not_ready', 'stale'].includes(correction.recheckState ?? ''));
  });
  const notices: RefundCaseRecord[] = [];
  for (const item of ready) {
    const key = `${item.id}:${item.customerCorrection!.requestId}:${item.customerCorrection!.respondedAt}`;
    if (!state.seen.has(key)) {
      state.seen.add(key);
      if (state.initialized) notices.push(item);
    }
  }
  state.initialized = true;
  return notices;
}
