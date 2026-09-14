/// <reference lib="deno.ns" />

import { assertEquals, assertMatch, assertStringIncludes, assertThrows } from 'jsr:@std/assert@1';
import {
  formatRefundDateTime,
  formatRefundLocalDateTime,
  parseRefundSelectedCustomerTimezone,
  refundCandidateTimeMeaning,
  refundCandidateTimeSourceDetail,
  refundCustomerTimeMeaning,
  refundProviderTimeLabel,
  type RefundCandidateTimeEvidence,
} from './refundTimePresentation.ts';

const evidence = (
  overrides: Partial<RefundCandidateTimeEvidence> = {}
): RefundCandidateTimeEvidence => ({
  schemaVersion: 'refund_candidate_time_v1',
  providerTimestampSource: 'authorization_gmt',
  providerTimeResolution: 'exact',
  machineTimeResolution: 'exact',
  machineClockTimezone: 'America/Los_Angeles',
  machineClockSource: 'native_machine_configuration',
  occurrenceComparable: true,
  occurrenceSemantics: 'online_purchase_occurrence',
  occurrenceTimezoneBasis: 'utc',
  payloadRedacted: true,
  ...overrides,
});

Deno.test('refund time renders an Eastern customer time independently from the reviewer browser zone', () => {
  assertEquals(
    formatRefundDateTime('2026-09-05T21:07:00Z', 'America/New_York'),
    'Sep 5, 2026, 5:07 PM EDT'
  );
  assertEquals(
    formatRefundDateTime('2026-09-05T21:07:00Z', 'America/Los_Angeles'),
    'Sep 5, 2026, 2:07 PM PDT'
  );
});

Deno.test('refund time renders normalized instants in the verified provider machine zone', () => {
  assertEquals(
    formatRefundDateTime('2026-09-05T19:08:00Z', 'America/Los_Angeles'),
    'Sep 5, 2026, 12:08 PM PDT'
  );
});

Deno.test('refund time labels both sides of DST changes explicitly', () => {
  assertStringIncludes(formatRefundDateTime('2026-03-08T06:30:00Z', 'America/New_York'), '1:30 AM EST');
  assertStringIncludes(formatRefundDateTime('2026-03-08T07:30:00Z', 'America/New_York'), '3:30 AM EDT');
  assertStringIncludes(formatRefundDateTime('2026-11-01T05:30:00Z', 'America/New_York'), '1:30 AM EDT');
  assertStringIncludes(formatRefundDateTime('2026-11-01T06:30:00Z', 'America/New_York'), '1:30 AM EST');
});

Deno.test('refund time preserves an original DST fold or gap wall clock without fabricating an instant', () => {
  assertEquals(formatRefundLocalDateTime('2026-03-08T02:30'), 'Mar 8, 2026, 2:30 AM');
  assertEquals(formatRefundLocalDateTime('2026-11-01T01:30:00'), 'Nov 1, 2026, 1:30 AM');
  assertEquals(formatRefundLocalDateTime('2026-02-30T01:30'), 'n/a');
});

Deno.test('refund time explains DST folds and gaps as System work, not customer homework', () => {
  assertMatch(refundCustomerTimeMeaning('ambiguous') ?? '', /occurs twice/);
  assertMatch(refundCustomerTimeMeaning('ambiguous') ?? '', /do not ask the customer/);
  assertMatch(refundCustomerTimeMeaning('nonexistent') ?? '', /DST gap/);
  assertMatch(refundCustomerTimeMeaning('nonexistent') ?? '', /Bloomjoy must resolve/);
  assertEquals(refundCustomerTimeMeaning('exact'), null);
});

Deno.test('refund time explains comparable, delayed, ambiguous, and unknown evidence without a veto', () => {
  assertEquals(refundProviderTimeLabel(evidence()), 'Nayax purchase time');
  assertMatch(refundCandidateTimeMeaning(evidence()), /Comparable purchase time/);
  assertMatch(
    refundCandidateTimeMeaning(evidence({ occurrenceComparable: false })),
    /does not prove when the purchase happened/
  );
  assertMatch(
    refundCandidateTimeMeaning(evidence({ machineTimeResolution: 'ambiguous' })),
    /Comparable purchase time.*secondary machine clock.*repeated DST hour/
  );
  assertMatch(refundCandidateTimeMeaning(null), /basis is unavailable/);
  assertMatch(
    refundCandidateTimeSourceDetail(evidence({
      providerTimestampSource: 'unverified_location_clock',
      providerTimeResolution: 'unknown',
      machineClockSource: 'unknown',
      machineTimeResolution: 'unknown',
    })),
    /Unverified venue-clock interpretation · provider resolution unknown · machine clock resolution and source unknown/
  );
  assertMatch(
    refundCandidateTimeSourceDetail(evidence({
      machineClockTimezone: null,
      machineClockSource: 'unknown',
      machineTimeResolution: 'ambiguous',
    })),
    /machine clock ambiguous; source unverified/
  );
});

Deno.test('refund time never falls back to the browser zone for invalid contract values', () => {
  assertEquals(formatRefundDateTime('2026-09-05T21:07:00Z', 'not/a-zone'), 'n/a');
  assertEquals(formatRefundDateTime('not-an-instant', 'America/New_York'), 'n/a');
});

Deno.test('selected evidence accepts an unavailable customer zone and rejects malformed values', () => {
  assertEquals(parseRefundSelectedCustomerTimezone(null), null);
  assertEquals(parseRefundSelectedCustomerTimezone(undefined), undefined);
  assertEquals(
    parseRefundSelectedCustomerTimezone('America/New_York'),
    'America/New_York'
  );
  assertThrows(() => parseRefundSelectedCustomerTimezone('not/a-zone'));
  assertThrows(() => parseRefundSelectedCustomerTimezone(42));
});
