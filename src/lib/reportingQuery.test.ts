/// <reference lib="deno.ns" />
const assertEquals = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Values differ');
};
import { ReportingRequestError, reportingQueryRetry } from './reportingQuery.ts';

Deno.test('report errors retain SQLSTATE and deterministic failures never retry', () => {
  for (const code of ['57014', '42501', '22023']) {
    const error = new ReportingRequestError({ code, message: 'Request failed', details: 'detail' }, 'fallback');
    assertEquals(error.code, code);
    assertEquals(error.details, 'detail');
    assertEquals(reportingQueryRetry(0, error), false);
  }
  assertEquals(reportingQueryRetry(0, new Error('canceling statement due to statement timeout')), false);
});

Deno.test('transient report errors retry once and unknown values remain safe', () => {
  assertEquals(reportingQueryRetry(0, new Error('Failed to fetch')), true);
  assertEquals(reportingQueryRetry(1, new Error('Failed to fetch')), false);
  assertEquals(reportingQueryRetry(1, null), false);
});
