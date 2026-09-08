export const TIMEKEEPING_TIME_ZONE = 'America/Los_Angeles';

export type TechnicianTimeDraft = {
  workDate: string;
  machineId: string;
  startTime: string;
  endTime: string;
};

type ComparableTimeEntry = {
  workDate: string;
  machineId: string;
  startTime: string;
  endTime: string;
};

const plainDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEKEEPING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const zonedDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEKEEPING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const partsToRecord = (parts: Intl.DateTimeFormatPart[]) =>
  Object.fromEntries(parts.map((part) => [part.type, part.value]));

const parsePlainDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) throw new Error('Choose a valid work date.');
  return { year, month, day };
};

const parseTime = (value: string) => {
  const [hour, minute] = value.split(':').map(Number);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error('Choose a valid time.');
  }
  return { hour, minute };
};

const formatPlainDateParts = (date: Date) => {
  const parts = partsToRecord(plainDateFormatter.formatToParts(date));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const zonedParts = (date: Date) => {
  const parts = partsToRecord(zonedDateTimeFormatter.formatToParts(date));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
};

const timeZoneOffsetMs = (date: Date) => {
  const parts = zonedParts(date);
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
    Math.floor(date.getTime() / 1000) * 1000
  );
};

export const getTodayInTimekeepingZone = (now = new Date()) => formatPlainDateParts(now);

export const getTechnicianCutoffDate = (workDate: string) => {
  const { year, month } = parsePlainDate(workDate);
  const cutoff = new Date(Date.UTC(year, month, 5, 12));
  return `${cutoff.getUTCFullYear()}-${String(cutoff.getUTCMonth() + 1).padStart(2, '0')}-${String(
    cutoff.getUTCDate()
  ).padStart(2, '0')}`;
};

export const isTechnicianWorkDateEditable = (workDate: string, now = new Date()) =>
  getTodayInTimekeepingZone(now) < getTechnicianCutoffDate(workDate);

export const addPlainDateDays = (value: string, amount: number) => {
  const { year, month, day } = parsePlainDate(value);
  const date = new Date(Date.UTC(year, month - 1, day + amount, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate()
  ).padStart(2, '0')}`;
};

export const getWeekStart = (value: string) => {
  const { year, month, day } = parsePlainDate(value);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return addPlainDateDays(value, -mondayOffset);
};

export const getWeekDates = (weekStart: string) =>
  Array.from({ length: 7 }, (_, index) => addPlainDateDays(weekStart, index));

export const getWeekMonthAnchors = (weekStart: string) =>
  [...new Set(getWeekDates(weekStart).map((date) => `${date.slice(0, 7)}-01`))];

export const combineDateAndTimeInTimekeepingZone = (dateValue: string, timeValue: string) => {
  const date = parsePlainDate(dateValue);
  const time = parseTime(timeValue);
  const desiredUtc = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);

  let candidate = desiredUtc - timeZoneOffsetMs(new Date(desiredUtc));
  candidate = desiredUtc - timeZoneOffsetMs(new Date(candidate));

  const actual = zonedParts(new Date(candidate));
  if (
    actual.year !== date.year ||
    actual.month !== date.month ||
    actual.day !== date.day ||
    actual.hour !== time.hour ||
    actual.minute !== time.minute
  ) {
    throw new Error('That local time does not exist because of the daylight-saving change.');
  }

  return new Date(candidate).toISOString();
};

export const getActualDurationMinutes = (
  workDate: string,
  startTime: string,
  endTime: string
) => {
  if (!startTime || !endTime) return 0;
  const startAt = Date.parse(combineDateAndTimeInTimekeepingZone(workDate, startTime));
  const endAt = Date.parse(combineDateAndTimeInTimekeepingZone(workDate, endTime));
  return Math.max(0, Math.round((endAt - startAt) / 60_000));
};

export const timeDraftOverlapsEntry = (
  draft: TechnicianTimeDraft,
  entry: ComparableTimeEntry
) => {
  if (draft.workDate !== entry.workDate) return false;
  try {
    const draftStart = Date.parse(
      combineDateAndTimeInTimekeepingZone(draft.workDate, draft.startTime)
    );
    const draftEnd = Date.parse(
      combineDateAndTimeInTimekeepingZone(draft.workDate, draft.endTime)
    );
    const entryStart = Date.parse(
      combineDateAndTimeInTimekeepingZone(entry.workDate, entry.startTime)
    );
    const entryEnd = Date.parse(
      combineDateAndTimeInTimekeepingZone(entry.workDate, entry.endTime)
    );
    return draftStart < entryEnd && entryStart < draftEnd;
  } catch {
    return false;
  }
};

export const timeDraftMatchesEntry = (
  draft: TechnicianTimeDraft,
  entry: ComparableTimeEntry
) =>
  draft.workDate === entry.workDate &&
  draft.machineId === entry.machineId &&
  draft.startTime === entry.startTime &&
  draft.endTime === entry.endTime;

export const isCompletedTimeInFuture = (
  workDate: string,
  endTime: string,
  now = new Date()
) => Date.parse(combineDateAndTimeInTimekeepingZone(workDate, endTime)) > now.getTime();

export const describeTimekeepingError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = message.toLowerCase();

  if (normalized.includes('overlap') || normalized.includes('duplicate')) {
    return 'This time overlaps another entry. Change the start or end time, then try again.';
  }
  if (normalized.includes('closed') || normalized.includes('cutoff') || normalized.includes('locked')) {
    return 'Technician editing has closed for this month. Your manager can still correct the entry.';
  }
  if (normalized.includes('assigned machine') || normalized.includes('assignment')) {
    return 'That machine was not assigned to you on the selected date. Choose an available machine.';
  }
  if (normalized.includes('completed') || normalized.includes('future')) {
    return 'Enter time only after the work has ended.';
  }
  if (normalized.includes('after start')) {
    return 'End time must be later than start time.';
  }

  return message || 'We could not save that change. Your information is still here so you can try again.';
};
