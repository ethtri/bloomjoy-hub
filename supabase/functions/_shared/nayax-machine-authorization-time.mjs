// Nayax's MachineAuTime is an identity field. Preserve its original wall-clock
// value and precision; do not substitute AuthorizationTimeGMT.
const EXACT_MACHINE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(?:Z|([+-])(\d{2}):(\d{2}))?$/;

export function parseNayaxMachineAuthorizationTime(value) {
  if (typeof value !== 'string' || value !== value.trim()) throw new Error('Exact Nayax MachineAuTime required.');
  const match = EXACT_MACHINE_TIME.exec(value);
  if (!match) throw new Error('Exact Nayax MachineAuTime required.');
  const [, y, m, d, h, minute, second, , , offsetHour, offsetMinute] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
    Number(h) > 23 || Number(minute) > 59 || Number(second) > 59 ||
    (offsetHour !== undefined && (Number(offsetHour) > 14 || Number(offsetMinute) > 59 ||
      (Number(offsetHour) === 14 && Number(offsetMinute) !== 0)))) {
    throw new Error('Invalid Nayax MachineAuTime calendar value.');
  }
  return value;
}

const exactParts = (value) => {
  parseNayaxMachineAuthorizationTime(value);
  const match = EXACT_MACHINE_TIME.exec(value);
  const zone = value.endsWith('Z')
    ? 'Z'
    : match[8] ? `${match[8]}${match[9]}:${match[10]}` : '';
  return {
    calendar: `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`,
    fraction: (match[7] ?? '').padEnd(7, '0'),
    fractionDigits: (match[7] ?? '').length,
    zone,
  };
};

const instantWithoutFraction = ({ calendar, zone }) =>
  Date.parse(`${calendar}${zone}`);

const sameInstant = (left, right) => {
  const leftParts = exactParts(left);
  const rightParts = exactParts(right);
  return Boolean(leftParts.zone && rightParts.zone) &&
    leftParts.fraction === rightParts.fraction &&
    instantWithoutFraction(leftParts) === instantWithoutFraction(rightParts);
};

export function buildNayaxMachineAuthorizationTimeWireValue({
  rawValue,
  normalizedInstant,
  mode,
}) {
  const raw = parseNayaxMachineAuthorizationTime(rawValue);
  if (mode === 'exact_source') return raw;
  if (mode !== 'source_with_bound_offset') {
    throw new Error('Unsupported Nayax MachineAuTime serialization mode.');
  }

  const rawParts = exactParts(raw);
  const normalizedParts = exactParts(normalizedInstant);
  if (!normalizedParts.zone) {
    throw new Error('Bound Nayax MachineAuTime instant requires an offset.');
  }
  if (rawParts.zone) {
    if (!sameInstant(raw, normalizedInstant)) {
      throw new Error('Bound Nayax MachineAuTime instant does not match its source.');
    }
    return raw;
  }
  if (
    rawParts.fractionDigits > 3 ||
    normalizedParts.fractionDigits > 3
  ) {
    throw new Error(
      'Bound Nayax MachineAuTime offset requires millisecond-exact evidence.',
    );
  }
  if (rawParts.fraction !== normalizedParts.fraction) {
    throw new Error('Bound Nayax MachineAuTime precision changed.');
  }

  const rawAsUtc = Date.parse(`${rawParts.calendar}Z`);
  const normalized = instantWithoutFraction(normalizedParts);
  const offsetMilliseconds = rawAsUtc - normalized;
  if (
    !Number.isSafeInteger(offsetMilliseconds) ||
    offsetMilliseconds % 60_000 !== 0
  ) {
    throw new Error('Bound Nayax MachineAuTime offset must be an exact minute.');
  }
  const offsetMinutes = offsetMilliseconds / 60_000;
  if (Math.abs(offsetMinutes) > 14 * 60) {
    throw new Error('Bound Nayax MachineAuTime offset is outside the supported range.');
  }
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  const zone = `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
  const wire = `${raw}${zone}`;
  if (!sameInstant(wire, normalizedInstant)) {
    throw new Error('Bound Nayax MachineAuTime wire value changed the selected instant.');
  }
  return wire;
}
