import {
  addPlainDateDays,
  combineDateAndTimeInTimekeepingZone,
  getTechnicianCutoffDate,
  getTodayInTimekeepingZone,
} from './timekeepingUi.ts';

export type TimeEditingAuthority = {
  technicianCutoffAt?: string;
  technicianEditable?: boolean;
};

export function getTimeEditingDeadline(workDate: string, now = new Date(), authority?: TimeEditingAuthority) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return null;
  const serverCutoff = Date.parse(authority?.technicianCutoffAt ?? '');
  const cutoffAt = Number.isFinite(serverCutoff)
    ? serverCutoff
    : Date.parse(combineDateAndTimeInTimekeepingZone(getTechnicianCutoffDate(workDate), '00:00'));
  const editable = now.getTime() < cutoffAt && authority?.technicianEditable !== false;
  return {
    month: `${workDate.slice(0, 7)}-01`,
    cutoffAt,
    lastEditableAt: cutoffAt - 60_000,
    editable,
    closingSoon: editable && cutoffAt - now.getTime() <= 72 * 60 * 60 * 1000,
  };
}

// During days 1–4, the previous month is the next one to close.
export function getNextTimeEditingWorkDate(now = new Date()) {
  const today = getTodayInTimekeepingZone(now);
  return Number(today.slice(8)) < 5 ? addPlainDateDays(`${today.slice(0, 7)}-01`, -1) : today;
}

export function getNextPacificMidnight(now: Date) {
  return Date.parse(combineDateAndTimeInTimekeepingZone(
    addPlainDateDays(getTodayInTimekeepingZone(now), 1), '00:00',
  ));
}

// Moving an edit across a month boundary must satisfy both deadlines. The
// original entry's cutoff describes that entry, never the newly chosen month.
export function getFormTimeEditingAuthority(
  workDate: string,
  now: Date,
  entry?: TimeEditingAuthority & { workDate: string },
): TimeEditingAuthority | undefined {
  if (!entry) return undefined;
  return {
    technicianEditable: getTimeEditingDeadline(entry.workDate, now, entry)?.editable ?? false,
    technicianCutoffAt: entry.workDate.slice(0, 7) === workDate.slice(0, 7)
      ? entry.technicianCutoffAt : undefined,
  };
}
