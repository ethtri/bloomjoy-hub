/// <reference lib="deno.ns" />
import { overlappingMachinePartnerships, validAssignmentDate } from './machinePartnershipAssignment.ts';
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const assignment = { machine_id: 'machine', assignment_role: 'primary_reporting', status: 'active', effective_start_date: '2026-09-01', effective_end_date: '2026-09-30' as string | null };

Deno.test('assignment windows have inclusive end dates and allow the following day', () => {
  assert(overlappingMachinePartnerships([assignment], 'machine', '2026-09-30').length === 1, 'End date must conflict');
  assert(overlappingMachinePartnerships([assignment], 'machine', '2026-10-01').length === 0, 'Next day must be allowed');
});
Deno.test('new ongoing assignments conflict with future primary windows', () => {
  assert(overlappingMachinePartnerships([{ ...assignment, effective_start_date: '2026-12-01', effective_end_date: '2026-12-31' }], 'machine', '2026-10-01').length === 1, 'Future windows must not be ignored');
});
Deno.test('ongoing assignments conflict regardless of selected partnership', () => {
  assert(overlappingMachinePartnerships([{ ...assignment, effective_end_date: null, partnership_id: 'another' }], 'machine', '2027-01-01').length === 1, 'Cross-partnership overlaps must be prevented');
});
Deno.test('historical, archived, other-role and other-machine assignments stay untouched', () => {
  const rows = [assignment, { ...assignment, status: 'archived', effective_end_date: null }, { ...assignment, assignment_role: 'secondary_reporting', effective_end_date: null }, { ...assignment, machine_id: 'other', effective_end_date: null }];
  const before = JSON.stringify(rows);
  assert(overlappingMachinePartnerships(rows, 'machine', '2026-10-01').length === 0, 'Unrelated history must not conflict');
  assert(JSON.stringify(rows) === before, 'Conflict detection must never change history');
});
Deno.test('effective dates reject impossible days rather than normalizing them', () => {
  assert(validAssignmentDate('2026-09-01') && validAssignmentDate('2028-02-29'), 'Real dates must be accepted');
  assert(!validAssignmentDate('2026-02-29') && !validAssignmentDate('2026-09-31') && !validAssignmentDate('') && !validAssignmentDate('9/1/2026'), 'Invalid dates must be rejected');
});
