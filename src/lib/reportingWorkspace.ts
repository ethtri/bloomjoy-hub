import type { PaymentMethod, SalesReportRow } from './reporting';

export type WorkspaceView = 'overview' | 'sales' | 'locations' | 'labor' | 'refunds' | 'partners';
export type ComparisonMode = 'previous_period' | 'previous_month' | 'none';
export type WorkspaceState = {
  view: WorkspaceView; dateFrom: string; dateTo: string;
  locationId: string; machineId: string; paymentMethod: PaymentMethod | 'all';
  comparison: ComparisonMode;
};
export const workspaceViews: WorkspaceView[] = ['overview', 'sales', 'locations', 'labor', 'refunds', 'partners'];
const day = 86400000;
const dateValue = (value: string) => new Date(`${value}T00:00:00Z`);
export const dateString = (value: Date) => value.toISOString().slice(0, 10);
export const validDate = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dateValue(value).getTime()) && dateString(dateValue(value)) === value);
export function defaultWorkspaceState(now = new Date()): WorkspaceState {
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const end = new Date(today.getTime() - day);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  return { view: 'overview', dateFrom: dateString(start), dateTo: dateString(end), locationId: 'all', machineId: 'all', paymentMethod: 'all', comparison: 'previous_month' };
}
export function readWorkspaceState(params: URLSearchParams, defaults = defaultWorkspaceState()): WorkspaceState {
  const from = params.get('from'); const to = params.get('to');
  const datesValid = validDate(from) && validDate(to) && from <= to;
  const view = params.get('view') === 'operator' ? 'sales' : params.get('view') === 'partner' ? 'partners' : params.get('view');
  const compare = params.get('compare'); const tender = params.get('tender');
  return { ...defaults, view: workspaceViews.includes(view as WorkspaceView) ? view as WorkspaceView : defaults.view,
    ...(datesValid ? { dateFrom: from, dateTo: to } : {}),
    locationId: params.get('location') || 'all', machineId: params.get('machine') || 'all',
    paymentMethod: ['cash', 'credit', 'other', 'unknown'].includes(tender ?? '') ? tender as PaymentMethod : 'all',
    comparison: ['previous_period', 'previous_month', 'none'].includes(compare ?? '') ? compare as ComparisonMode : defaults.comparison };
}
export function writeWorkspaceState(state: WorkspaceState, existing = new URLSearchParams()): URLSearchParams {
  const params = new URLSearchParams(existing);
  for (const [key, value] of Object.entries({ view: state.view, from: state.dateFrom, to: state.dateTo, location: state.locationId, machine: state.machineId, tender: state.paymentMethod, compare: state.comparison })) {
    if (value === 'all') params.delete(key); else params.set(key, value);
  }
  return params;
}
export function comparisonRange(state: Pick<WorkspaceState, 'dateFrom' | 'dateTo' | 'comparison'>) {
  if (state.comparison === 'none') return null;
  const start = dateValue(state.dateFrom); const end = dateValue(state.dateTo);
  const days = Math.round((end.getTime() - start.getTime()) / day) + 1;
  if (state.comparison === 'previous_period') return { dateFrom: dateString(new Date(start.getTime() - days * day)), dateTo: dateString(new Date(start.getTime() - day)), days, shortened: false };
  const previousMonthLast = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 0));
  const priorStart = new Date(Date.UTC(previousMonthLast.getUTCFullYear(), previousMonthLast.getUTCMonth(), Math.min(start.getUTCDate(), previousMonthLast.getUTCDate())));
  const priorEnd = new Date(Math.min(priorStart.getTime() + (days - 1) * day, previousMonthLast.getTime()));
  const priorDays = Math.round((priorEnd.getTime() - priorStart.getTime()) / day) + 1;
  return { dateFrom: dateString(priorStart), dateTo: dateString(priorEnd), days: priorDays, shortened: priorDays !== days };
}
export function periodChange(current: number | null, previous: number | null) {
  if (current == null || previous == null) return { absolute: null, percent: null };
  return { absolute: current - previous, percent: previous > 0 ? (current - previous) / previous * 100 : null };
}
export function knownMoney(rows: SalesReportRow[], field: 'netSalesCents' | 'grossSalesCents' | 'refundAmountCents' | 'taxCents') {
  return { value: rows.length && rows.every(row => row[field] != null) ? rows.reduce((sum, row) => sum + row[field]!, 0) : null,
    knownValue: rows.reduce((sum, row) => sum + (row[field] ?? 0), 0), omittedRows: rows.filter(row => row[field] == null).length };
}
export type SalesGroup = { id: string; label: string; current: number | null; previous: number | null; transactions: number | null; previousTransactions: number | null; change: ReturnType<typeof periodChange>; cohort: 'both' | 'current_only' | 'previous_only'; rows: SalesReportRow[] };
export function salesGroups(current: SalesReportRow[], previous: SalesReportRow[], kind: 'location' | 'machine'): SalesGroup[] {
  const key = kind === 'location' ? 'locationId' : 'machineId'; const label = kind === 'location' ? 'locationName' : 'machineLabel';
  const ids = new Set([...current, ...previous].map(row => row[key]));
  return [...ids].map(id => {
    const rows = current.filter(row => row[key] === id); const prior = previous.filter(row => row[key] === id);
    const now = knownMoney(rows, 'netSalesCents').value; const before = knownMoney(prior, 'netSalesCents').value;
    return { id, label: (rows[0] ?? prior[0])[label], current: now, previous: before, transactions: rows.length ? rows.reduce((sum, row) => sum + row.transactionCount, 0) : null,
      previousTransactions: prior.length ? prior.reduce((sum, row) => sum + row.transactionCount, 0) : null, change: periodChange(now, before),
      cohort: rows.length && prior.length ? 'both' : rows.length ? 'current_only' : 'previous_only', rows } as SalesGroup;
  }).sort((a, b) => (b.current ?? -Infinity) - (a.current ?? -Infinity));
}
export function alignedTrend(current: SalesReportRow[], previous: SalesReportRow[], from: string, to: string, priorFrom?: string) {
  const result: { date: string; priorDate: string | null; current: number | null; previous: number | null; transactions: number | null }[] = [];
  for (let stamp = dateValue(from).getTime(), index = 0; stamp <= dateValue(to).getTime(); stamp += day, index++) {
    const date = dateString(new Date(stamp)); const priorDate = priorFrom ? dateString(new Date(dateValue(priorFrom).getTime() + index * day)) : null;
    const rows = current.filter(row => row.periodStart.slice(0, 10) === date); const prior = previous.filter(row => row.periodStart.slice(0, 10) === priorDate);
    result.push({ date, priorDate, current: knownMoney(rows, 'netSalesCents').value, previous: knownMoney(prior, 'netSalesCents').value, transactions: rows.length ? rows.reduce((sum, row) => sum + row.transactionCount, 0) : null });
  }
  return result;
}
export const money = (cents: number | null) => cents == null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const number = (value: number | null) => value == null ? 'Unavailable' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
export const changeLabel = (value: ReturnType<typeof periodChange>, monetary = true) => value.absolute == null ? 'Not comparable' : `${value.absolute > 0 ? '+' : ''}${monetary ? money(value.absolute) : number(value.absolute)}${value.percent == null ? ' · no positive prior denominator' : ` (${value.percent > 0 ? '+' : ''}${value.percent.toFixed(1)}%)`}`;
export type SavedReportingView = { id: string; name: string; state: WorkspaceState };
export function parseSavedViews(value: string | null): SavedReportingView[] {
  try { const values: unknown = JSON.parse(value ?? '[]'); if (!Array.isArray(values)) return [];
    return values.filter((item): item is SavedReportingView => Boolean(item && typeof item.id === 'string' && typeof item.name === 'string' && item.state && validDate(item.state.dateFrom) && validDate(item.state.dateTo) && item.state.dateFrom <= item.state.dateTo && workspaceViews.includes(item.state.view))).map(item => ({ ...item, state: readWorkspaceState(writeWorkspaceState(item.state)) }));
  } catch { return []; }
}
