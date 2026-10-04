/// <reference lib="deno.ns" />

import { getRefundPurchaseTimePresentation } from './refundPurchaseTimePresentation.ts';
import { formatRefundDateTime, type RefundCandidateTimeEvidence } from './refundTimePresentation.ts';

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const unknown: RefundCandidateTimeEvidence = {
  schemaVersion: 'refund_candidate_time_v1', providerTimestampSource: 'unknown',
  providerTimeResolution: 'unknown', machineTimeResolution: 'unknown', machineClockTimezone: null,
  machineClockSource: 'unknown', occurrenceComparable: false, occurrenceSemantics: 'unknown',
  occurrenceTimezoneBasis: null, payloadRedacted: true,
};

Deno.test('saved machine time remains visible when provider GMT time and verified clock evidence are unavailable', () => {
  for (const timeEvidence of [undefined, unknown]) {
    const time = getRefundPurchaseTimePresentation({
      selected: { providerTimestampAt: null, providerAuthorizedAt: '2026-09-05T21:02:00Z',
        machineTimezone: 'America/New_York', timeEvidence },
      venueTimezone: 'America/New_York',
    });
    assert(time.usingSavedMachineTime, 'saved machine time is the fallback');
    assert(!time.machineTimezoneVerified, 'saved default zone is not native clock proof');
    assert(time.label === 'Saved machine time; supporting context', 'no GMT or occurrence claim');
    assert(formatRefundDateTime(time.displayAt, time.displayTimezone).includes('5:02 PM'), 'saved time is readable');
  }
});

Deno.test('provider timestamp stays primary and machine clock retains its saved timezone separately', () => {
  const time = getRefundPurchaseTimePresentation({ selected: {
    providerTimestampAt: '2026-09-05T21:02:00Z', providerAuthorizedAt: '2026-09-05T18:02:00Z',
    machineTimezone: 'America/Los_Angeles', timeEvidence: unknown,
  }, venueTimezone: 'America/New_York' });
  assert(!time.usingSavedMachineTime, 'provider timestamp takes precedence');
  assert(time.displayTimezone === 'America/New_York', 'provider time uses venue display zone');
  assert(time.machineTimezone === 'America/Los_Angeles', 'saved clock zone remains secondary');
  assert(!time.machineTimezoneVerified, 'saved clock does not imply a verified timezone');
});
