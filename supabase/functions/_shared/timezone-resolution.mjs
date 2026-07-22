const localDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const localTimePattern = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

const partsForInstant = (instant, timeZone) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
};

const sameLocalParts = (left, right) =>
  left.year === right.year &&
  left.month === right.month &&
  left.day === right.day &&
  left.hour === right.hour &&
  left.minute === right.minute &&
  left.second === right.second;

const offsetMillisecondsAt = (instant, timeZone) => {
  const parts = partsForInstant(instant, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return representedAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
};

export const resolveLocalDateTimeInZone = ({ localDate, localTime, timeZone }) => {
  const dateMatch = String(localDate ?? "").trim().match(localDatePattern);
  const timeMatch = String(localTime ?? "").trim().match(localTimePattern);
  if (!dateMatch || !timeMatch) {
    return { instant: null, resolution: "invalid_local_time", possibleInstantCount: 0 };
  }

  const localParts = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: Number(timeMatch[3] ?? 0),
  };
  const naiveUtcMs = Date.UTC(
    localParts.year,
    localParts.month - 1,
    localParts.day,
    localParts.hour,
    localParts.minute,
    localParts.second,
  );
  const roundTrip = new Date(naiveUtcMs);
  if (
    roundTrip.getUTCFullYear() !== localParts.year ||
    roundTrip.getUTCMonth() + 1 !== localParts.month ||
    roundTrip.getUTCDate() !== localParts.day ||
    localParts.hour > 23 ||
    localParts.minute > 59 ||
    localParts.second > 59
  ) {
    return { instant: null, resolution: "invalid_local_time", possibleInstantCount: 0 };
  }

  try {
    // Sample both sides of the target day. This captures all ordinary IANA UTC
    // offsets and both offsets around DST folds/gaps without trusting the host TZ.
    const offsets = new Set();
    for (let hour = -36; hour <= 36; hour += 6) {
      offsets.add(offsetMillisecondsAt(new Date(naiveUtcMs + hour * 60 * 60 * 1000), timeZone));
    }

    const possibleInstants = [...offsets]
      .map((offset) => new Date(naiveUtcMs - offset))
      .filter((candidate) => sameLocalParts(partsForInstant(candidate, timeZone), localParts))
      .sort((left, right) => left.getTime() - right.getTime());

    if (possibleInstants.length === 1) {
      return {
        instant: possibleInstants[0].toISOString(),
        resolution: "exact",
        possibleInstantCount: 1,
      };
    }

    if (possibleInstants.length > 1) {
      return {
        // The earlier fold is used only to center a broad lookup window. The
        // resolution flag keeps the recommendation/manual-execution path closed.
        instant: possibleInstants[0].toISOString(),
        resolution: "ambiguous",
        possibleInstantCount: possibleInstants.length,
      };
    }

    const approximateOffset = offsetMillisecondsAt(new Date(naiveUtcMs), timeZone);
    return {
      // A nonexistent spring-forward time remains review-only. The approximation
      // lets managers inspect nearby records without claiming an exact instant.
      instant: new Date(naiveUtcMs - approximateOffset).toISOString(),
      resolution: "nonexistent",
      possibleInstantCount: 0,
    };
  } catch {
    return {
      instant: new Date(naiveUtcMs).toISOString(),
      resolution: "invalid_timezone",
      possibleInstantCount: 0,
    };
  }
};
