// Shared saved-payload guard. Never reads live rates, assignments or time.
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const whole = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const positive = (v: unknown): v is number => whole(v) && v > 0;
const duration = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const close = (a: number, b: number) => Math.abs(a - b) < 0.000001;
const components = ['shiftEarningsCents', 'monthlyBaseEarningsCents', 'extraTimeEarningsCents', 'commissionEarningsCents', 'bonusCents', 'supplyCreditCents', 'expenseReimbursementCents'];

export function validMonthlyVisitStatement(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.earningsSchemaVersion === undefined) {
    return value.monthlyVisitLines === undefined && [value.current, value.yearToDate].every(t => !record(t) || (
      t.monthlyBaseEarningsCents === undefined && t.extraTimeEarningsCents === undefined && t.visitUnits === undefined));
  }
  if (!record(value.current) || !record(value.yearToDate)) return false;
  if (value.earningsSchemaVersion !== 'monthly-visits-v1' || !Array.isArray(value.monthlyVisitLines)) return false;
  for (const totals of [value.current, value.yearToDate]) {
    if (!whole(totals.monthlyBaseEarningsCents) || !whole(totals.extraTimeEarningsCents) || !whole(totals.visitUnits)
      || !components.every(key => typeof totals[key] === 'number' && Number.isSafeInteger(totals[key]))
      || !Number.isSafeInteger(totals.totalEarningsCents)
      || components.reduce((sum, key) => sum + (totals[key] as number), 0) !== totals.totalEarningsCents) return false;
  }
  let base = 0, extra = 0, visits = 0;
  const seenEntries = new Set<string>();
  const seenAgreements = new Set<string>();
  for (const line of value.monthlyVisitLines) {
    if (!record(line) || typeof line.machineId !== 'string' || typeof line.machineLabel !== 'string'
      || !record(line.agreement) || !record(line.evaluation) || !Array.isArray(line.entries)) return false;
    const a = line.agreement, e = line.evaluation;
    if (typeof a.id !== 'string' || seenAgreements.has(a.id) || !positive(a.included_visits) || !positive(a.included_minutes_per_visit)
      || !whole(a.monthly_base_cents) || !whole(a.extra_hour_rate_cents) || e.calculationStatus !== 'ready'
      || !Array.isArray(e.blockers) || e.blockers.length || !whole(e.baseEarningsCents) || !whole(e.extraEarningsCents)
      || !whole(e.visitUnits) || !duration(e.actualMinutes) || !duration(e.extraActualMinutes)
      || e.baseEarningsCents !== a.monthly_base_cents || e.visitUnits !== a.included_visits || e.visitUnits !== line.entries.length
      || e.timeEarningsCents !== e.baseEarningsCents + e.extraEarningsCents) return false;
    seenAgreements.add(a.id);
    let actual = 0, extraActual = 0;
    for (const entry of line.entries) {
      if (!record(entry) || typeof entry.id !== 'string' || seenEntries.has(entry.id)
        || typeof entry.workDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.workDate)
        || typeof entry.actualStartAt !== 'string' || typeof entry.actualEndAt !== 'string'
        || !duration(entry.actualMinutes) || entry.actualMinutes <= 0) return false;
      const elapsed = (Date.parse(entry.actualEndAt) - Date.parse(entry.actualStartAt)) / 60000;
      if (!Number.isFinite(elapsed) || !close(elapsed, entry.actualMinutes)) return false;
      seenEntries.add(entry.id);
      actual += entry.actualMinutes;
      extraActual += Math.max(entry.actualMinutes - a.included_minutes_per_visit, 0);
    }
    if (!close(actual, e.actualMinutes) || !close(extraActual, e.extraActualMinutes)) return false;
    base += e.baseEarningsCents; extra += e.extraEarningsCents; visits += e.visitUnits;
  }
  return base === value.current.monthlyBaseEarningsCents && extra === value.current.extraTimeEarningsCents && visits === value.current.visitUnits;
}
