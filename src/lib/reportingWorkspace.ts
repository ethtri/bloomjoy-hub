import type { PaymentMethod, SalesReportRow } from './reporting';
import { taxPolicyEstimate } from './reportingTaxPolicyEvidence';

export type WorkspaceView = 'overview' | 'sales' | 'finance' | 'locations' | 'machines' | 'labor' | 'refunds' | 'partners';
export type ComparisonMode = 'previous_period' | 'previous_month' | 'previous_year' | 'none';
export type WorkspaceState = {
  view: WorkspaceView; dateFrom: string; dateTo: string;
  companyId: string; locationId: string; machineId: string; paymentMethod: PaymentMethod | 'all';
  comparison: ComparisonMode;
};
export const workspaceViews: WorkspaceView[] = ['overview', 'sales', 'machines', 'finance', 'locations', 'partners'];
const day = 86400000;
const dateValue = (value: string) => new Date(`${value}T00:00:00Z`);
export const dateString = (value: Date) => value.toISOString().slice(0, 10);
export const validDate = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dateValue(value).getTime()) && dateString(dateValue(value)) === value);
export function defaultWorkspaceState(now = new Date()): WorkspaceState {
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const end = new Date(today.getTime() - day);
  const start = new Date(today.getTime() - 7 * day);
  return { view: 'overview', dateFrom: dateString(start), dateTo: dateString(end), companyId: 'all', locationId: 'all', machineId: 'all', paymentMethod: 'all', comparison: 'previous_period' };
}
export function reportingPeriods(now = new Date()) {
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const offset = (days: number) => new Date(today.getTime() + days * day);
  const month = (offset: number, date = 1) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, date));
  const mondayOffset = -((today.getUTCDay() + 6) % 7);
  const period = (id: string, label: string, from: Date, to: Date) => ({ id, label, dateFrom: dateString(from), dateTo: dateString(to) });
  return [
    period('today', 'Today', today, today),
    period('yesterday', 'Yesterday', offset(-1), offset(-1)),
    period('last_7', 'Last 7 complete days', offset(-7), offset(-1)),
    period('this_week', 'This week', offset(mondayOffset), today),
    period('last_week', 'Last week', offset(mondayOffset - 7), offset(mondayOffset - 1)),
    period('last_30', 'Last 30 complete days', offset(-30), offset(-1)),
    ...(today.getUTCDate() > 1 ? [period('month_complete', 'Month through yesterday', month(0), offset(-1))] : []),
    period('month_to_date', 'Month to date', month(0), today),
    period('last_month', 'Last month', month(-1), month(0, 0)),
    period('year_to_date', 'Year to date', new Date(Date.UTC(today.getUTCFullYear(), 0, 1)), today),
    period('last_year', 'Last year', new Date(Date.UTC(today.getUTCFullYear() - 1, 0, 1)), new Date(Date.UTC(today.getUTCFullYear(), 0, 0))),
  ];
}
export function readWorkspaceState(params: URLSearchParams, defaults = defaultWorkspaceState()): WorkspaceState {
  const from = params.get('from'); const to = params.get('to');
  const datesValid = validDate(from) && validDate(to) && from <= to;
  const view = params.get('view') === 'operator' ? 'sales' : params.get('view') === 'partner' ? 'partners' : params.get('view');
  const compare = params.get('compare'); const tender = params.get('tender');
  return { ...defaults, view: [...workspaceViews, 'labor', 'refunds'].includes(view as WorkspaceView) ? view as WorkspaceView : defaults.view,
    ...(datesValid ? { dateFrom: from, dateTo: to } : {}),
    companyId: params.get('company') || 'all', locationId: params.get('location') || 'all', machineId: params.get('machine') || 'all',
    paymentMethod: ['cash', 'credit', 'other', 'unknown'].includes(tender ?? '') ? tender as PaymentMethod : 'all',
    comparison: ['previous_period', 'previous_month', 'previous_year', 'none'].includes(compare ?? '') ? compare as ComparisonMode : defaults.comparison };
}
export function writeWorkspaceState(state: WorkspaceState, existing = new URLSearchParams()): URLSearchParams {
  const params = new URLSearchParams(existing);
  for (const [key, value] of Object.entries({ view: state.view, from: state.dateFrom, to: state.dateTo, company: state.companyId ?? 'all', location: state.locationId, machine: state.machineId, tender: state.paymentMethod, compare: state.comparison })) {
    if (value === 'all') params.delete(key); else params.set(key, value);
  }
  return params;
}
export function comparisonRange(state: Pick<WorkspaceState, 'dateFrom' | 'dateTo' | 'comparison'>) {
  if (state.comparison === 'none') return null;
  const start = dateValue(state.dateFrom); const end = dateValue(state.dateTo);
  const days = Math.round((end.getTime() - start.getTime()) / day) + 1;
  if (state.comparison === 'previous_period') return { dateFrom: dateString(new Date(start.getTime() - days * day)), dateTo: dateString(new Date(start.getTime() - day)), days, shortened: false };
  if (state.comparison === 'previous_year') {
    const priorStart = priorYearDate(start); const priorEnd = priorYearDate(end);
    const priorDays = Math.round((priorEnd.getTime() - priorStart.getTime()) / day) + 1;
    // Leap-day endpoints clamp to February 28 for the query, but never establish
    // an equal calendar-date comparison or a fabricated daily match.
    const leapEndpoint = priorStart.getUTCDate() !== start.getUTCDate() || priorEnd.getUTCDate() !== end.getUTCDate();
    return { dateFrom: dateString(priorStart), dateTo: dateString(priorEnd), days: priorDays, shortened: priorDays !== days || leapEndpoint };
  }
  const previousMonthLast = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 0));
  const priorStart = new Date(Date.UTC(previousMonthLast.getUTCFullYear(), previousMonthLast.getUTCMonth(), Math.min(start.getUTCDate(), previousMonthLast.getUTCDate())));
  const priorEnd = new Date(Math.min(priorStart.getTime() + (days - 1) * day, previousMonthLast.getTime()));
  const priorDays = Math.round((priorEnd.getTime() - priorStart.getTime()) / day) + 1;
  return { dateFrom: dateString(priorStart), dateTo: dateString(priorEnd), days: priorDays, shortened: priorDays !== days };
}
function priorYearDate(value: Date) {
  const year = value.getUTCFullYear() - 1; const month = value.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(value.getUTCDate(), lastDay)));
}
export function periodChange(current: number | null, previous: number | null) {
  if (current == null || previous == null) return { absolute: null, percent: null };
  return { absolute: current - previous, percent: previous > 0 ? (current - previous) / previous * 100 : null };
}
export function knownSalesAmount(row: SalesReportRow, field: 'netSalesCents' | 'grossSalesCents' | 'refundAmountCents' | 'taxCents' | 'customerReceiptsCents') {
  if (field === 'customerReceiptsCents') return row.customerReceiptsKnownCents ?? row.customerReceiptsCents;
  if (field === 'grossSalesCents' && row.grossSalesKnownCents !== undefined) return row.grossSalesKnownCents;
  if (field === 'netSalesCents' && row.netSalesKnownCents !== undefined) return row.netSalesKnownCents;
  if (field === 'refundAmountCents' && row.refundAmountKnownCents !== undefined) return row.refundAmountKnownCents;
  return row[field];
}
export function knownMoney(rows: SalesReportRow[], field: 'netSalesCents' | 'grossSalesCents' | 'refundAmountCents' | 'taxCents' | 'customerReceiptsCents') {
  const applicable = field === 'customerReceiptsCents' ? rows.filter(row => !(row.customerReceiptsCents == null && row.customerReceiptsKnownCents == null && row.customerReceiptsUnknownCount === 0)) : rows;
  return { value: applicable.length && applicable.every(row => row[field] != null) ? applicable.reduce((sum, row) => sum + row[field]!, 0) : null,
    knownValue: applicable.reduce((sum, row) => sum + (knownSalesAmount(row, field) ?? 0), 0), omittedRows: applicable.filter(row => row[field] == null).length };
}
/** Display only calculable rows. A complete total stays null if any row is unresolved. */
export function moneyCoverage(rows: SalesReportRow[], field: Parameters<typeof knownMoney>[1] = 'netSalesCents') {
  const total = knownMoney(rows, field);
  const knownRows = rows.filter(row => knownSalesAmount(row, field) != null).length;
  const estimate = taxPolicyEstimate(rows, field);
  const remainingUnknownComponents = rows.reduce((sum, row) => {
    const unknown = field === 'grossSalesCents' ? row.grossSalesUnknownCount ?? Math.max(row.unresolvedSalesCount, row.grossSalesCents == null ? 1 : 0)
      : field === 'refundAmountCents' ? row.refundAmountUnknownCount ?? Math.max(row.unresolvedRefundCount, row.refundAmountCents == null ? 1 : 0)
      : field === 'netSalesCents' ? row.netSalesUnknownCount ?? (row.netSalesCents == null ? 1 : 0)
      : field === 'customerReceiptsCents' ? row.customerReceiptsUnknownCount ?? (row.customerReceiptsCents == null ? 1 : 0)
      : row.taxCents == null ? 1 : 0;
    const evidence = row.taxPolicyEvidence;
    const estimated = !evidence ? 0 : field === 'grossSalesCents' && evidence.estimatedSalesExTaxCents !== null ? evidence.provisionalSalesComponents
      : field === 'refundAmountCents' && evidence.estimatedRefundExTaxCents !== null ? evidence.provisionalRefundComponents
      : field === 'netSalesCents' && evidence.estimatedNetExTaxCents !== null ? evidence.provisionalNetComponents : 0;
    return sum + Math.max(0, unknown - estimated);
  }, 0);
  const withEstimates = estimate.value === null ? null : total.knownValue + estimate.value;
  if (withEstimates !== null && !Number.isSafeInteger(withEstimates)) throw new Error('The report amount is too large to display accurately.');
  return { ...total, knownRows, estimatedValue: estimate.value, estimatedRows: estimate.contributors, withEstimates, remainingUnknownComponents, noSalesRecorded: field === 'customerReceiptsCents' && rows.length > 0 && rows.every(row => row.customerReceiptsCents == null && row.customerReceiptsKnownCents == null && row.customerReceiptsUnknownCount === 0), displayValue: knownRows ? total.knownValue : null,
    status: !rows.length ? 'empty' as const : total.omittedRows ? 'partial' as const : 'complete' as const };
}
export function moneyCoverageNote(total: ReturnType<typeof moneyCoverage>) {
  if (total.status === 'empty') return 'No loaded records';
  if (total.noSalesRecorded) return 'No sales recorded';
  if (total.estimatedValue !== null) return `${total.displayValue === null ? 'No confirmed amount' : `${money(total.displayValue)} known`} + ${money(total.estimatedValue)} estimated${total.remainingUnknownComponents ? `; ${number(total.remainingUnknownComponents)} ${total.remainingUnknownComponents === 1 ? 'component still unavailable' : 'components still unavailable'}` : ''}; estimates are pending tax verification and are not payout amounts`;
  if (total.status === 'complete') return 'Calculated from loaded records';
  return `${number(total.omittedRows)} ${total.omittedRows === 1 ? 'row has' : 'rows have'} missing amounts${total.knownRows ? '; known subtotal only' : '; no calculable amounts'}`;
}
export function moneyCoverageText(total: ReturnType<typeof moneyCoverage>, formatter: (value: number | null) => string = money) {
  if (total.noSalesRecorded) return 'No sales recorded';
  if (total.withEstimates !== null) return `${formatter(total.withEstimates)} ${total.remainingUnknownComponents ? 'subtotal including estimates' : 'including estimates'}`;
  return `${formatter(total.displayValue)}${total.status === 'partial' && total.knownRows ? ' (known subtotal)' : ''}`;
}
export function unresolvedComponents(rows: SalesReportRow[]) {
  return { sales: rows.reduce((sum, row) => sum + row.unresolvedSalesCount, 0),
    refunds: rows.reduce((sum, row) => sum + row.unresolvedRefundCount, 0),
    taxRows: rows.filter(row => row.taxCents == null).length };
}
export type SalesGroup = { id: string; label: string; current: number | null; previous: number | null; currentCoverage: ReturnType<typeof moneyCoverage>; previousCoverage: ReturnType<typeof moneyCoverage>; transactions: number | null; previousTransactions: number | null; change: ReturnType<typeof periodChange>; cohort: 'both' | 'current_only' | 'previous_only'; rows: SalesReportRow[] };
export function salesGroups(current: SalesReportRow[], previous: SalesReportRow[], kind: 'location' | 'machine'): SalesGroup[] {
  const key = kind === 'location' ? 'locationId' : 'machineId'; const label = kind === 'location' ? 'locationName' : 'machineLabel';
  const ids = new Set([...current, ...previous].map(row => row[key]));
  return [...ids].map(id => {
    const rows = current.filter(row => row[key] === id); const prior = previous.filter(row => row[key] === id);
    const currentCoverage = moneyCoverage(rows); const previousCoverage = moneyCoverage(prior);
    const now = currentCoverage.value; const before = previousCoverage.value;
    return { id, label: (rows[0] ?? prior[0])[label], current: now, previous: before, currentCoverage, previousCoverage, transactions: rows.length ? rows.reduce((sum, row) => sum + row.transactionCount, 0) : null,
      previousTransactions: prior.length ? prior.reduce((sum, row) => sum + row.transactionCount, 0) : null, change: periodChange(now, before),
      cohort: rows.length && prior.length ? 'both' : rows.length ? 'current_only' : 'previous_only', rows } as SalesGroup;
  }).sort((a, b) => (b.currentCoverage.displayValue ?? -Infinity) - (a.currentCoverage.displayValue ?? -Infinity));
}
export function alignedTrend(current: SalesReportRow[], previous: SalesReportRow[], from: string, to: string, priorFrom?: string, comparison: ComparisonMode = 'previous_period') {
  const result: { date: string; priorDate: string | null; current: number | null; previous: number | null; currentCoverage: ReturnType<typeof moneyCoverage>; previousCoverage: ReturnType<typeof moneyCoverage>; currentKnown: number | null; previousKnown: number | null; transactions: number | null }[] = [];
  for (let stamp = dateValue(from).getTime(), index = 0; stamp <= dateValue(to).getTime(); stamp += day, index++) {
    const currentDate = new Date(stamp); const date = dateString(currentDate);
    const calendarPrior = comparison === 'previous_year' ? priorYearDate(currentDate) : null;
    const priorDate = !priorFrom ? null : calendarPrior ? calendarPrior.getUTCDate() === currentDate.getUTCDate() ? dateString(calendarPrior) : null : dateString(new Date(dateValue(priorFrom).getTime() + index * day));
    const rows = current.filter(row => row.periodStart.slice(0, 10) === date); const prior = previous.filter(row => row.periodStart.slice(0, 10) === priorDate);
    const currentCoverage = moneyCoverage(rows); const previousCoverage = moneyCoverage(prior);
    result.push({ date, priorDate, current: currentCoverage.value, previous: previousCoverage.value, currentCoverage, previousCoverage,
      currentKnown: currentCoverage.displayValue, previousKnown: previousCoverage.displayValue, transactions: rows.length ? rows.reduce((sum, row) => sum + row.transactionCount, 0) : null });
  }
  return result;
}
export const money = (cents: number | null) => cents == null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const refundImpactMoney = (cents: number | null) => cents == null ? 'Unavailable' : cents === 0 ? money(0) : `${cents > 0 ? '-' : '+'}${money(Math.abs(cents))}`;
export const number = (value: number | null) => value == null ? 'Unavailable' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
export const changeLabel = (value: ReturnType<typeof periodChange>, monetary = true) => value.absolute == null ? 'Not comparable' : `${value.absolute > 0 ? '+' : ''}${monetary ? money(value.absolute) : number(value.absolute)}${value.percent == null ? ' · no positive prior denominator' : ` (${value.percent > 0 ? '+' : ''}${value.percent.toFixed(1)}%)`}`;
export type SavedReportingView = { id: string; name: string; state: WorkspaceState };
export function parseSavedViews(value: string | null): SavedReportingView[] {
  try { const values: unknown = JSON.parse(value ?? '[]'); if (!Array.isArray(values)) return [];
    return values.filter((item): item is SavedReportingView => Boolean(item && typeof item.id === 'string' && typeof item.name === 'string' && item.state && validDate(item.state.dateFrom) && validDate(item.state.dateTo) && item.state.dateFrom <= item.state.dateTo && [...workspaceViews, 'labor', 'refunds'].includes(item.state.view))).map(item => ({ ...item, state: readWorkspaceState(writeWorkspaceState(item.state)) }));
  } catch { return []; }
}

/** Carry operational scope to the owning app. Destination access checks stay authoritative. */
export function operationalReportHref(domain: 'labor' | 'refunds', scope: Pick<WorkspaceState, 'dateFrom' | 'dateTo' | 'locationId' | 'machineId'> & { companyId?: string } | URLSearchParams) {
  const params = new URLSearchParams({ view: 'reports' });
  const values = scope instanceof URLSearchParams
    ? { company: domain === 'refunds' ? scope.get('company') : null, from: scope.get('from'), to: scope.get('to'), location: scope.get('location'), machine: scope.get('machine') }
    : { company: domain === 'refunds' ? scope.companyId : null, from: scope.dateFrom, to: scope.dateTo, location: scope.locationId, machine: scope.machineId };
  for (const [key, value] of Object.entries(values)) if (value && value !== 'all') params.set(key, value);
  return `${domain === 'labor' ? '/portal/time-review' : '/refunds'}?${params.toString()}`;
}
