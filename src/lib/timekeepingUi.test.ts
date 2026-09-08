/// <reference lib="deno.ns" />

import {
  addPlainDateDays,
  combineDateAndTimeInTimekeepingZone,
  getActualDurationMinutes,
  getTechnicianCutoffDate,
  getTodayInTimekeepingZone,
  getWeekMonthAnchors,
  getWeekStart,
  isCompletedTimeInFuture,
  isTechnicianWorkDateEditable,
} from './timekeepingUi.ts';

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
};

Deno.test('weekly helpers use a Monday start and include both months at a boundary', () => {
  assertEquals(getWeekStart('2026-09-03'), '2026-08-31', 'week start');
  assertEquals(getWeekMonthAnchors('2026-08-31'), ['2026-08-01', '2026-09-01'], 'month anchors');
  assertEquals(addPlainDateDays('2026-12-31', 1), '2027-01-01', 'year boundary');
});

Deno.test('Pacific local timestamps preserve winter and summer offsets', () => {
  assertEquals(
    combineDateAndTimeInTimekeepingZone('2026-01-15', '09:30'),
    '2026-01-15T17:30:00.000Z',
    'winter offset'
  );
  assertEquals(
    combineDateAndTimeInTimekeepingZone('2026-07-15', '09:30'),
    '2026-07-15T16:30:00.000Z',
    'summer offset'
  );
});

Deno.test('Pacific helpers reject skipped daylight-saving time', () => {
  let rejected = false;
  try {
    combineDateAndTimeInTimekeepingZone('2026-03-08', '02:30');
  } catch {
    rejected = true;
  }
  assertEquals(rejected, true, 'spring-forward gap');
});

Deno.test('duration and future checks support visible paid-shift previews', () => {
  assertEquals(getActualDurationMinutes('2026-07-15', '09:00', '10:01'), 61, '61-minute duration');
  assertEquals(
    isCompletedTimeInFuture('2026-07-15', '10:00', new Date('2026-07-15T16:30:00.000Z')),
    true,
    'future end'
  );
  assertEquals(getTodayInTimekeepingZone(new Date('2026-01-01T07:30:00.000Z')), '2025-12-31', 'Pacific date');
});

Deno.test('duration previews use the same Pacific instants as canonical saves across DST', () => {
  assertEquals(
    getActualDurationMinutes('2026-03-08', '01:30', '03:30'),
    60,
    'spring-forward duration'
  );
  assertEquals(
    getActualDurationMinutes('2026-11-01', '01:30', '02:30'),
    120,
    'fall-back duration'
  );
});

Deno.test('Technician editing closes exactly at Pacific midnight on day five', () => {
  assertEquals(getTechnicianCutoffDate('2026-12-15'), '2027-01-05', 'December cutoff date');
  assertEquals(
    isTechnicianWorkDateEditable('2026-12-15', new Date('2027-01-05T07:59:59.000Z')),
    true,
    'one second before Pacific cutoff'
  );
  assertEquals(
    isTechnicianWorkDateEditable('2026-12-15', new Date('2027-01-05T08:00:00.000Z')),
    false,
    'at Pacific cutoff'
  );
});
