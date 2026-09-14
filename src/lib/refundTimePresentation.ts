export type RefundCandidateTimeEvidence = {
  schemaVersion: 'refund_candidate_time_v1';
  providerTimestampSource: string;
  providerTimeResolution: string;
  machineTimeResolution: string;
  machineClockTimezone: string | null;
  machineClockSource: string;
  occurrenceComparable: boolean;
  occurrenceSemantics: string;
  occurrenceTimezoneBasis: string | null;
  payloadRedacted: true;
};

export const isRefundTimeZone = (value: string | null | undefined): value is string => {
  if (!value?.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
};

export const formatRefundDateTime = (
  value: string | null | undefined,
  timeZone: string | null | undefined,
  locale = 'en-US'
) => {
  if (!value || !isRefundTimeZone(timeZone)) return 'n/a';
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return 'n/a';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(instant);
};

export const refundCandidateTimeMeaning = (
  evidence: RefundCandidateTimeEvidence | null | undefined
) => {
  if (!evidence) {
    return 'Supporting Nayax time only; its purchase-time basis is unavailable.';
  }
  if (evidence.machineTimeResolution === 'ambiguous') {
    return 'The provider clock falls in a repeated DST hour. Compare the machine, amount, and card evidence.';
  }
  if (evidence.occurrenceComparable) {
    return 'Comparable purchase time, normalized by Bloomjoy.';
  }
  return 'Supporting Nayax time only; it does not prove when the purchase happened.';
};

export const refundProviderTimeLabel = (
  evidence: RefundCandidateTimeEvidence | null | undefined
) => {
  if (evidence?.occurrenceComparable) return 'Nayax purchase time';
  if (evidence?.providerTimestampSource === 'authorization_gmt') return 'Nayax authorization time';
  return 'Nayax record time';
};
