/// <reference lib="deno.ns" />
import { getFormTimeEditingAuthority, getNextPacificMidnight, getNextTimeEditingWorkDate, getTimeEditingDeadline } from './timeEditingDeadline.ts';

const equal = (actual: unknown, expected: unknown) => {
  if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
};

Deno.test('next deadline selects the previous month until exactly day five in Pacific', () => {
  equal(getNextTimeEditingWorkDate(new Date('2026-10-05T06:59:59Z')), '2026-09-30');
  equal(getNextTimeEditingWorkDate(new Date('2026-10-05T07:00:00Z')), '2026-10-05');
  equal(getNextTimeEditingWorkDate(new Date('2027-01-01T16:00:00Z')), '2026-12-31');
});

Deno.test('summer and winter deadlines close exactly at Pacific midnight with 11:59 PM copy', () => {
  for (const [workDate, cutoff] of [['2026-09-01', '2026-10-05T07:00:00Z'], ['2026-12-01', '2027-01-05T08:00:00Z']]) {
    const boundary = Date.parse(cutoff);
    const before = getTimeEditingDeadline(workDate, new Date(boundary - 1000))!;
    equal(before.editable, true);
    equal(before.lastEditableAt, boundary - 60_000);
    equal(getTimeEditingDeadline(workDate, new Date(boundary))!.editable, false);
    equal(getTimeEditingDeadline(workDate, new Date(boundary + 1000))!.editable, false);
  }
});

Deno.test('server entry authority stays authoritative even before the fallback deadline', () => {
  const now = new Date('2026-09-03T19:00:00Z');
  equal(getTimeEditingDeadline('2026-09-02', now, { technicianEditable: false })!.editable, false);
  equal(getTimeEditingDeadline('2026-09-02', now, { technicianCutoffAt: '2026-09-03T18:00:00Z', technicianEditable: true })!.editable, false);
  equal(getTimeEditingDeadline('2026-09-02', now, { technicianCutoffAt: 'invalid' })!.cutoffAt, Date.parse('2026-10-05T07:00:00Z'));
});

Deno.test('cross-month notices retain each month and urgency belongs only to the nearest cutoff', () => {
  const now = new Date('2026-09-03T19:00:00Z');
  equal(getTimeEditingDeadline('2026-08-31', now)!.closingSoon, true);
  equal(getTimeEditingDeadline('2026-09-01', now)!.closingSoon, false);
  equal(getTimeEditingDeadline('', now), null);
});

Deno.test('clock scheduling follows Pacific midnight through both daylight-saving transitions', () => {
  equal(getNextPacificMidnight(new Date('2026-03-08T09:00:00Z')), Date.parse('2026-03-09T07:00:00Z'));
  equal(getNextPacificMidnight(new Date('2026-11-01T08:00:00Z')), Date.parse('2026-11-02T08:00:00Z'));
});

Deno.test('cross-month edits require both original and selected month to remain open', () => {
  const now = new Date('2026-10-13T19:00:00Z');
  const october = { workDate: '2026-10-01', technicianCutoffAt: '2026-11-05T08:00:00Z', technicianEditable: true };
  const september = { workDate: '2026-09-30', technicianCutoffAt: '2026-10-05T07:00:00Z', technicianEditable: true };
  const targetSeptember = getTimeEditingDeadline('2026-09-30', now, getFormTimeEditingAuthority('2026-09-30', now, october))!;
  equal(targetSeptember.cutoffAt, Date.parse('2026-10-05T07:00:00Z'));
  equal(targetSeptember.editable, false);
  equal(getTimeEditingDeadline('2026-10-01', now, getFormTimeEditingAuthority('2026-10-01', now, september))!.editable, false);
  equal(getTimeEditingDeadline('2026-10-02', now, getFormTimeEditingAuthority('2026-10-02', now, october))!.editable, true);
});
