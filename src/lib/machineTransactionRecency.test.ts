/// <reference lib="deno.ns" />
import { importFreshnessLabel, transactionAge, transactionAgeLabel } from './machineTransactionRecency.ts';
const now = Date.parse('2026-10-03T12:00:00Z');
Deno.test('Recorded recency distinguishes unknown, old, and current dates', () => {
  if (transactionAge(null, now) !== null || transactionAge('bad-date', now) !== null) throw new Error('Unknown must stay unknown');
  if (transactionAge('2026-09-01', now) !== 32) throw new Error('Old recorded date lost');
  if (transactionAgeLabel(null, now) !== 'No transactions recorded') throw new Error('Absence label');
  if (transactionAgeLabel('2026-10-03', now) !== 'Today') throw new Error('Today label');
});
Deno.test('Import freshness is independent of transaction recency', () => {
  if (importFreshnessLabel(null, now) !== 'Import freshness unknown') throw new Error('Absent import not fresh');
  if (importFreshnessLabel('2026-09-01', now) !== 'Import data is stale') throw new Error('Old import not fresh');
  if (importFreshnessLabel('2026-10-03T01:00:00Z', now) !== 'Recent import') throw new Error('Recent successful import label');
});
