export type RefundCandidateTimeEvidence = {
  schemaVersion: 'refund_candidate_time_v1';
  providerTimestampSource:
    | 'authorization_gmt'
    | 'machine_authorization_offset'
    | 'verified_machine_clock'
    | 'unverified_location_clock'
    | 'unknown';
  providerTimeResolution: 'exact' | 'ambiguous' | 'unknown';
  machineTimeResolution: 'exact' | 'ambiguous' | 'unknown';
  machineClockTimezone: string | null;
  machineClockSource: 'native_machine_configuration' | 'unknown';
  occurrenceComparable: boolean;
  occurrenceSemantics: 'online_purchase_occurrence' | 'unknown';
  occurrenceTimezoneBasis: 'utc' | 'embedded_offset' | 'verified_machine_timezone' | null;
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

export const parseRefundSelectedCustomerTimezone = (
  value: unknown
): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' && isRefundTimeZone(value)) return value;
  throw new Error('Unsupported selected Nayax customer timezone.');
};

export const formatRefundLocalDateTime = (
  value: string | null | undefined,
  locale = 'en-US'
) => {
  const match = value?.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?$/
  );
  if (!match) return 'n/a';
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0'] = match;
  const parts = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const [year, month, day, hour, minute, second] = parts;
  const localFieldsAsUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    localFieldsAsUtc.getUTCFullYear() !== year ||
    localFieldsAsUtc.getUTCMonth() !== month - 1 ||
    localFieldsAsUtc.getUTCDate() !== day ||
    localFieldsAsUtc.getUTCHours() !== hour ||
    localFieldsAsUtc.getUTCMinutes() !== minute ||
    localFieldsAsUtc.getUTCSeconds() !== second
  ) {
    return 'n/a';
  }
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(localFieldsAsUtc);
};

export const refundCandidateTimeMeaning = (
  evidence: RefundCandidateTimeEvidence | null | undefined
) => {
  if (!evidence) {
    return 'Supporting Nayax time only; its purchase-time basis is unavailable.';
  }
  if (evidence.occurrenceComparable) {
    return evidence.machineTimeResolution === 'ambiguous'
      ? 'Comparable purchase time, normalized by Bloomjoy. The secondary machine clock falls in a repeated DST hour.'
      : 'Comparable purchase time, normalized by Bloomjoy.';
  }
  if (evidence.machineTimeResolution === 'ambiguous') {
    return 'The provider clock falls in a repeated DST hour. Compare the machine, amount, and card evidence.';
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

export const refundCandidateTimeSourceDetail = (
  evidence: RefundCandidateTimeEvidence | null | undefined
) => {
  if (!evidence) return 'Source unavailable · provider resolution unknown';
  const source = {
    authorization_gmt: 'Nayax GMT authorization',
    machine_authorization_offset: 'Nayax timestamp with offset',
    verified_machine_clock: 'Verified Nayax machine clock',
    unverified_location_clock: 'Unverified venue-clock interpretation',
    unknown: 'Source unavailable',
  }[evidence.providerTimestampSource];
  const providerResolution = evidence.providerTimeResolution === 'exact'
    ? 'provider time exact'
    : evidence.providerTimeResolution === 'ambiguous'
      ? 'provider time ambiguous'
      : 'provider resolution unknown';
  const machineResolution = evidence.machineClockSource === 'native_machine_configuration'
    ? evidence.machineTimeResolution === 'exact'
      ? 'verified machine clock exact'
      : evidence.machineTimeResolution === 'ambiguous'
        ? 'verified machine clock ambiguous'
        : 'verified machine clock resolution unknown'
    : evidence.machineTimeResolution === 'ambiguous'
      ? 'machine clock ambiguous; source unverified'
      : evidence.machineTimeResolution === 'exact'
        ? 'machine clock exact; source unverified'
        : 'machine clock resolution and source unknown';
  return `${source} · ${providerResolution} · ${machineResolution}`;
};

export const refundCustomerTimeMeaning = (resolution: string | null | undefined) => {
  if (resolution === 'ambiguous') {
    return 'This local time occurs twice during the DST change. Review both possible instants; do not ask the customer to repeat it.';
  }
  if (resolution === 'nonexistent') {
    return 'This local time falls in a DST gap. Treat it as approximate context; Bloomjoy must resolve the clock difference.';
  }
  if (resolution && !['exact', 'legacy_absolute'].includes(resolution)) {
    return 'Bloomjoy could not fully normalize this time. Treat it as context rather than asking the customer to repeat it.';
  }
  return null;
};
