const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const partsToRecord = (parts: Intl.DateTimeFormatPart[]) =>
  Object.fromEntries(parts.map((part) => [part.type, part.value]));

const parseLocalDateTime = (value: string): LocalDateTimeParts => {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value.trim());
  if (!match) throw new Error('Enter the date and time shown in Nayax, including seconds.');

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? '0'),
  };
  const validationDate = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ));
  if (
    parts.year < 2000 ||
    parts.year > 2100 ||
    validationDate.getUTCFullYear() !== parts.year ||
    validationDate.getUTCMonth() + 1 !== parts.month ||
    validationDate.getUTCDate() !== parts.day ||
    validationDate.getUTCHours() !== parts.hour ||
    validationDate.getUTCMinutes() !== parts.minute ||
    validationDate.getUTCSeconds() !== parts.second
  ) {
    throw new Error('Enter a valid date and time shown in Nayax.');
  }
  return parts;
};

export const canonicalizeEvidenceTimeZone = (value: string) => {
  const timeZone = value.trim();
  if (!timeZone || timeZone.length > 80) {
    throw new Error('Choose the timezone shown by Nayax.');
  }
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
  } catch {
    throw new Error('Choose a valid timezone shown by Nayax.');
  }
};

const zonedParts = (date: Date, timeZone: string): LocalDateTimeParts => {
  const record = partsToRecord(new Intl.DateTimeFormat('en-US-u-hc-h23', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date));
  return {
    year: Number(record.year),
    month: Number(record.month),
    day: Number(record.day),
    hour: Number(record.hour),
    minute: Number(record.minute),
    second: Number(record.second),
  };
};

const timeZoneOffsetMs = (date: Date, timeZone: string) => {
  const parts = zonedParts(date, timeZone);
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ) - Math.floor(date.getTime() / 1000) * 1000;
};

const sameParts = (left: LocalDateTimeParts, right: LocalDateTimeParts) =>
  left.year === right.year &&
  left.month === right.month &&
  left.day === right.day &&
  left.hour === right.hour &&
  left.minute === right.minute &&
  left.second === right.second;

export const evidenceLocalDateTimeToIso = (value: string, requestedTimeZone: string) => {
  const desired = parseLocalDateTime(value);
  const timeZone = canonicalizeEvidenceTimeZone(requestedTimeZone);
  const desiredAsUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second,
  );
  const offsetSamples = [-36, -12, 0, 12, 36].map(
    (hours) => new Date(desiredAsUtc + hours * 60 * 60 * 1000),
  );
  const offsets = [...new Set(offsetSamples.map((sample) => timeZoneOffsetMs(sample, timeZone)))];
  const matches = [...new Set(offsets
    .map((offset) => desiredAsUtc - offset)
    .filter((candidate) => sameParts(zonedParts(new Date(candidate), timeZone), desired))
  )].sort((left, right) => left - right);

  if (matches.length === 0) {
    throw new Error('That local time does not exist because the clocks changed. Check the Nayax record.');
  }
  if (matches.length > 1) {
    throw new Error('That local time happened twice because the clocks changed. Use a timezone with a fixed offset from the Nayax record.');
  }
  return {
    occurredAt: new Date(matches[0]).toISOString(),
    sourceTimeZone: timeZone,
  };
};
