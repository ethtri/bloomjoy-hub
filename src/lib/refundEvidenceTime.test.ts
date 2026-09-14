/// <reference lib="deno.ns" />

import {
  canonicalizeEvidenceTimeZone,
  evidenceLocalDateTimeToIso,
} from './refundEvidenceTime.ts';

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
};

Deno.test('refund evidence time uses the stated machine timezone', () => {
  assertEquals(
    evidenceLocalDateTimeToIso('2026-09-14T08:15:10', 'America/Los_Angeles'),
    {
      occurredAt: '2026-09-14T15:15:10.000Z',
      sourceTimeZone: 'America/Los_Angeles',
    },
    'Pacific evidence time',
  );
  assertEquals(
    evidenceLocalDateTimeToIso('2026-09-14T08:15:10', 'America/New_York'),
    {
      occurredAt: '2026-09-14T12:15:10.000Z',
      sourceTimeZone: 'America/New_York',
    },
    'Eastern evidence time',
  );
});

Deno.test('refund evidence time rejects skipped and repeated daylight-saving times', () => {
  for (const value of ['2026-03-08T02:30:00', '2026-11-01T01:30:00']) {
    let rejected = false;
    try {
      evidenceLocalDateTimeToIso(value, 'America/Los_Angeles');
    } catch {
      rejected = true;
    }
    assertEquals(rejected, true, `${value} rejected`);
  }
});

Deno.test('refund evidence timezone must be explicit and valid', () => {
  assertEquals(canonicalizeEvidenceTimeZone('US/Pacific'), 'America/Los_Angeles', 'canonical zone');
  for (const value of ['', 'Not/A-Timezone']) {
    let rejected = false;
    try {
      canonicalizeEvidenceTimeZone(value);
    } catch {
      rejected = true;
    }
    assertEquals(rejected, true, `${value || 'blank'} rejected`);
  }
});
