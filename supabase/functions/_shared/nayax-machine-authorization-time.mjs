// Nayax's MachineAuTime is an identity field. Preserve its original wall-clock
// value and precision; do not substitute AuthorizationTimeGMT or append a zone.
export function parseNayaxMachineAuthorizationTime(value) {
  if (typeof value !== 'string' || value !== value.trim()) throw new Error('Exact Nayax MachineAuTime required.');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,7})?(?:Z|([+-])(\d{2}):(\d{2}))?$/.exec(value);
  if (!match) throw new Error('Exact Nayax MachineAuTime required.');
  const [, y, m, d, h, minute, second, , offsetHour, offsetMinute] = match;
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
