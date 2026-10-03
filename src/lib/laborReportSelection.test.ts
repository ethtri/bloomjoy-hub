/// <reference lib="deno.ns" />
import { laborReportSelectionError } from './laborReportSelection.ts';
import { readWorkspaceState } from './reportingWorkspace.ts';
const choices = [{ locationId: 'north', machineId: 'one' }, { locationId: 'south', machineId: 'two' }];
function check(query: string, expected: string | null) {
  const params = new URLSearchParams(query);
  const actual = laborReportSelectionError(params, readWorkspaceState(params), choices);
  if (actual !== expected) throw new Error(`${query}: ${actual} != ${expected}`);
}
Deno.test('labor report preserves and rejects invalid linked dates', () => {
  for (const query of ['from=2026-02-30&to=2026-03-01', 'from=2026-03-01', 'from=2026-03-02&to=2026-03-01', 'from=2024-01-01&to=2026-01-01']) check(query, 'dates');
});
Deno.test('labor report rejects unknown or cross-location machine scope', () => {
  check('location=unknown', 'scope'); check('machine=unknown', 'scope'); check('location=north&machine=two', 'scope');
});
Deno.test('labor report accepts authorized narrowed and all-machine scope', () => {
  check('from=2026-07-15&to=2026-07-21&location=north&machine=one', null); check('', null);
});
