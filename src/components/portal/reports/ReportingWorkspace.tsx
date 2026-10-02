import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bookmark, Download, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/auth-context';
import { exportSalesReportPdf, fetchReportingDimensions, fetchSalesReport, type ReportingAccessContext, type SalesReportFilters } from '@/lib/reporting';
import { closeReservedSignedExportWindow, openSignedExportUrl, reserveSignedExportWindow } from '@/lib/signedExportWindow';
import { comparisonRange, defaultWorkspaceState, operationalReportHref, knownMoney, money, number, parseSavedViews, readWorkspaceState, salesGroups, validDate, workspaceViews, writeWorkspaceState, type SavedReportingView, type WorkspaceState, type WorkspaceView } from '@/lib/reportingWorkspace';
import { ReportingLocations, ReportingOverview } from './ReportingSalesAnalytics';
import { ReportingOperations } from './ReportingOperations';
import { ReportingFilters } from './ReportingFilters';
import { ReportingFinance } from './ReportingFinance';
import { fetchFinanceReportingAccess } from '@/lib/financeReporting';

export type ReportingScope = { dateFrom: string; dateTo: string; machineIds?: string[]; locationIds?: string[] };
export type ReportingDomainPanel = (scope: ReportingScope) => ReactNode;
export type ReportingScopeDimension = { machineId: string; machineLabel: string; locationId: string; locationName: string };
type Props = {
  accessContext: ReportingAccessContext; accessLoading: boolean; accessError?: boolean;
  canUsePartners: boolean; partnerView: ReactNode;
  laborPanel?: ReportingDomainPanel; refundPanel?: ReportingDomainPanel;
  laborDimensions?: ReportingScopeDimension[]; refundDimensions?: ReportingScopeDimension[];
  domainAccessLoading?: boolean; domainAccessError?: boolean;
  detailedSales: (filters?: SalesReportFilters) => ReactNode;
};
const labels: Record<WorkspaceView, string> = { overview: 'Overview', sales: 'Sales', finance: 'Finance', locations: 'Locations', labor: 'Labor', refunds: 'Refunds & Recovery', partners: 'Partners' };

export function ReportingWorkspace({ accessContext, accessLoading, accessError, canUsePartners, partnerView, laborPanel, refundPanel, laborDimensions, refundDimensions, domainAccessLoading, domainAccessError, detailedSales }: Props) {
  const { user, isCorporatePartner } = useAuth();
  const navigateToApp = useNavigate();
  const [params, setParams] = useSearchParams();
  const defaults = useMemo(() => ({ ...defaultWorkspaceState(), ...(isCorporatePartner ? { view: 'partners' as const } : {}) }), [isCorporatePartner]);
  const state = useMemo(() => readWorkspaceState(params, defaults), [params, defaults]);
  const [saving, setSaving] = useState(false); const [saveName, setSaveName] = useState('');
  const [saved, setSaved] = useState<SavedReportingView[]>([]); const [exporting, setExporting] = useState(false);
  const storageKey = `bloomjoy-reporting-views:${user?.id ?? 'signed-out'}`;
  useEffect(() => { try { setSaved(parseSavedViews(localStorage.getItem(storageKey))); } catch { setSaved([]); } }, [storageKey]);
  const navigate = (patch: Partial<WorkspaceState>) => {
    const next = writeWorkspaceState({ ...state, ...patch }, params);
    if (patch.view) next.delete('report');
    setParams(next);
  };
  const showDetailed = state.view === 'sales';
  const workspaceMode = state.view !== 'partners' && !showDetailed;
  const hasLaborPanel = Boolean(laborPanel); const hasRefundPanel = Boolean(refundPanel);
  const financeAccess = useQuery({ queryKey: ['reporting-finance-access', user?.id], queryFn: fetchFinanceReportingAccess, enabled: Boolean(user?.id), staleTime: 60000, retry: false });
  const hasFinanceAccess = financeAccess.isSuccess && financeAccess.data?.hasAccess === true;
  const visibleViews = useMemo(() => workspaceViews.filter(view => view === 'partners' ? canUsePartners : view === 'finance' ? hasFinanceAccess : accessContext.hasReportingAccess), [canUsePartners, hasFinanceAccess, accessContext.hasReportingAccess]);
  useEffect(() => {
    const selectedServiceUnavailable = (state.view === 'finance' && financeAccess.isError) || (['labor', 'refunds'].includes(state.view) && domainAccessError);
    if ((!params.has('view') || selectedServiceUnavailable) && !accessLoading && !domainAccessLoading && !financeAccess.isLoading && visibleViews.length && !visibleViews.includes(state.view)) {
      setParams(writeWorkspaceState({ ...state, view: visibleViews[0] }, params), { replace: true });
    }
  }, [params, accessLoading, domainAccessLoading, domainAccessError, financeAccess.isLoading, financeAccess.isError, visibleViews, state, setParams]);
  const legacyDomain = state.view === 'labor' || state.view === 'refunds' ? state.view : null;
  const legacyAllowed = legacyDomain === 'labor' ? hasLaborPanel : legacyDomain === 'refunds' ? hasRefundPanel : false;
  const selectedAllowed = visibleViews.includes(state.view);
  const onlyOperationalDomain = !params.has('view') && !accessLoading && !domainAccessLoading && !financeAccess.isLoading && !visibleViews.length ? (hasLaborPanel ? 'labor' : hasRefundPanel ? 'refunds' : null) : null;
  const salesView = ['overview', 'locations'].includes(state.view);
  const rangeTooLong = (Date.parse(state.dateTo) - Date.parse(state.dateFrom)) / 86400000 > 366;
  const fromParam = params.get('from'); const toParam = params.get('to');
  const invalidLinkedDates = (params.has('from') || params.has('to')) && (!validDate(fromParam) || !validDate(toParam) || fromParam > toParam);
  const periodInvalid = rangeTooLong || invalidLinkedDates;
  const dimensions = useQuery({ queryKey: ['reporting-workspace-dimensions', user?.id], queryFn: fetchReportingDimensions, enabled: Boolean(user?.id && accessContext.hasReportingAccess), staleTime: 60000 });
  const choices = state.view === 'finance' ? financeAccess.data?.dimensions ?? [] : state.view === 'labor' ? laborDimensions ?? [] : state.view === 'refunds' ? refundDimensions ?? [] : dimensions.data ?? [];
  const locations = [...new Map(choices.map(item => [item.locationId, item.locationName])).entries()];
  const machines = [...new Map(choices.filter(item => state.locationId === 'all' || item.locationId === state.locationId).map(item => [item.machineId, item])).values()];
  const choicesReady = state.view === 'finance' ? financeAccess.isSuccess : state.view === 'labor' ? laborDimensions !== undefined : state.view === 'refunds' ? refundDimensions !== undefined : dimensions.isSuccess;
  const scopeInvalid = Boolean(choicesReady && state.view !== 'partners' && ((state.locationId !== 'all' && !locations.some(([id]) => id === state.locationId)) || (state.machineId !== 'all' && !machines.some(item => item.machineId === state.machineId))));
  const filters: SalesReportFilters = useMemo(() => ({ dateFrom: state.dateFrom, dateTo: state.dateTo, grain: 'day', machineIds: state.machineId === 'all' ? [] : [state.machineId], locationIds: state.locationId === 'all' ? [] : [state.locationId], paymentMethods: state.paymentMethod === 'all' ? [] : [state.paymentMethod] }), [state]);
  const prior = useMemo(() => comparisonRange(state), [state]);
  const enabled = Boolean(user?.id && selectedAllowed && salesView && dimensions.isSuccess && !scopeInvalid && !periodInvalid);
  const report = useQuery({ queryKey: ['reporting-workspace-sales', user?.id, filters], queryFn: () => fetchSalesReport(filters), enabled, staleTime: 30000 });
  const priorFilters = { ...filters, dateFrom: prior?.dateFrom ?? state.dateFrom, dateTo: prior?.dateTo ?? state.dateTo };
  const comparison = useQuery({ queryKey: ['reporting-workspace-sales', user?.id, priorFilters], queryFn: () => fetchSalesReport(priorFilters), enabled: enabled && Boolean(prior), staleTime: 30000 });
  const rows = report.data ?? []; const previous = prior && comparison.isSuccess ? comparison.data ?? [] : [];
  const compareAvailable = Boolean(prior && comparison.isSuccess && !prior.shortened);
  const scope: ReportingScope = { dateFrom: state.dateFrom, dateTo: state.dateTo, machineIds: filters.machineIds?.length ? filters.machineIds : undefined, locationIds: filters.locationIds?.length ? filters.locationIds : undefined };
  const analytics = { rows, previous: compareAvailable ? previous : [], state, priorFrom: prior?.dateFrom, compareAvailable, dimensions: dimensions.data ?? [], onNavigate: navigate };
  const salesReady = salesView && report.isSuccess && !scopeInvalid && !periodInvalid && !report.isFetching;
  const writeSaved = (views: SavedReportingView[]) => { try { localStorage.setItem(storageKey, JSON.stringify(views)); setSaved(views); return true; } catch { toast.error('This browser could not save the view.'); return false; } };
  const saveView = () => { if (!saveName.trim() || !user?.id) return; if (writeSaved([...saved, { id: crypto.randomUUID(), name: saveName.trim(), state }])) { setSaving(false); setSaveName(''); toast.success('View saved on this browser.'); } };
  const exportPdf = async () => {
    if (!salesReady || !rows.length) return;
    const reserved = reserveSignedExportWindow(); setExporting(true);
    try { const result = await exportSalesReportPdf({ ...filters, title: `Sales ${state.dateFrom} to ${state.dateTo}` }); openSignedExportUrl(result.signedUrl, reserved); }
    catch (error) { closeReservedSignedExportWindow(reserved); toast.error(error instanceof Error ? error.message : 'Unable to export report.'); }
    finally { setExporting(false); }
  };
  const downloadBriefing = () => {
    const net = knownMoney(rows, 'netSalesCents'); const locations = salesGroups(rows, compareAvailable ? previous : [], 'location');
    const text = [`Bloomjoy reporting briefing`, `Generated: ${new Date().toISOString()}`, `Business dates: ${state.dateFrom} through ${state.dateTo} (inclusive, machine-local)`,
      `Scope: location ${choices.find(item => item.locationId === state.locationId)?.locationName ?? 'All accessible locations'}; machine ${choices.find(item => item.machineId === state.machineId)?.machineLabel ?? 'All accessible machines'}; tender ${state.paymentMethod}`,
      `Comparison: ${prior ? `${prior.dateFrom} through ${prior.dateTo}${compareAvailable ? '' : ' (unavailable or unequal duration)'}` : 'None'}`,
      `Net sales: ${money(net.value)}${net.omittedRows ? `; known subtotal ${money(net.knownValue)}; ${net.omittedRows} unresolved rows` : ''}`,
      `Transactions: ${rows.length ? number(rows.reduce((sum, row) => sum + row.transactionCount, 0)) : 'Unavailable'}`,
      ...locations.map(item => `${item.label}: ${money(item.current)}; prior ${money(item.previous)}; ${item.cohort.replace(/_/g, ' ')}`),
      `Calculation versions: ${[...new Set(rows.map(row => row.calculationVersion))].join(', ') || 'No loaded records'}`,
      'Coverage: imported records only; provider completeness and absent-day coverage unknown. Missing rows are not proof of zero sales. No uptime, profit, payment settlement or causal claims.',
      'Refund deductions use the request period; changes/reversals use their change period; later payment adds no second deduction. Summary contains no customer, payment or personnel details.' ].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `bloomjoy-briefing-${state.dateFrom}-${state.dateTo}.txt`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const loading = accessLoading || (salesView && selectedAllowed && (dimensions.isLoading || report.isLoading)) || (showDetailed && selectedAllowed && dimensions.isLoading);
  if (onlyOperationalDomain) return <Navigate replace to={operationalReportHref(onlyOperationalDomain, params)}/>;
  return <div className="min-w-0 font-sans" data-reporting-workspace>
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-semibold tracking-tight">Reporting</h1><div className="flex flex-wrap gap-2">{workspaceMode && <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={() => setSaving(value => !value)}><Bookmark className="mr-2 hidden h-4 w-4 sm:block"/>Save view</Button>}{salesView && <><Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" disabled={!salesReady} onClick={downloadBriefing} aria-label="Download briefing"><span className="sm:hidden">Briefing</span><span className="hidden sm:inline">Download briefing</span></Button><Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" disabled={!salesReady || !rows.length || exporting} onClick={exportPdf}><Download className="mr-2 hidden h-4 w-4 sm:block"/>{exporting ? 'Exporting…' : 'Export PDF'}</Button></>}</div></header>
    {saving && workspaceMode && <div className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-border p-3"><div className="flex-1"><Label htmlFor="reporting-save-name">View name</Label><Input id="reporting-save-name" value={saveName} onChange={event => setSaveName(event.target.value)} maxLength={80} placeholder="My monthly review"/></div><Button disabled={!saveName.trim()} onClick={saveView}>Save on this browser</Button><Button variant="ghost" onClick={() => setSaving(false)}>Cancel</Button><p className="w-full text-xs text-muted-foreground">Stores filters only for your account. Data and permissions are checked again when opened.</p></div>}
    {saved.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">My views</span>{saved.map(view => <div key={view.id} className="flex items-center rounded-md border border-border"><Button variant="ghost" size="sm" onClick={() => { const next = writeWorkspaceState(view.state, params); next.delete('report'); setParams(next); }}>{view.name}</Button><Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Remove ${view.name}`} onClick={() => writeSaved(saved.filter(item => item.id !== view.id))}><X className="h-3 w-3"/></Button></div>)}</div>}
    <div className="mt-5 sm:hidden">
      <Label htmlFor="reporting-view">Report</Label>
      <Select value={selectedAllowed ? state.view : undefined} onValueChange={view => navigate({ view: view as WorkspaceView })}>
        <SelectTrigger id="reporting-view" className="mt-2 min-h-11 w-full"><SelectValue placeholder="Choose a report"/></SelectTrigger>
        <SelectContent>{visibleViews.map(view => <SelectItem key={view} value={view} className="min-h-11">{labels[view]}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <nav aria-label="Reporting views" className="mt-5 hidden flex-wrap border-b border-border sm:flex">{visibleViews.map(view => <button type="button" key={view} aria-current={view === state.view ? 'page' : undefined} className={`border-b-2 px-4 py-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${view === state.view ? 'border-[#c44c64] font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`} onClick={() => navigate({ view })}>{labels[view]}</button>)}</nav>
    {workspaceMode && <>
      <ReportingFilters key={`${state.view}:${state.dateFrom}:${state.dateTo}`} state={state} salesView={salesView} locations={locations} machines={machines} onChange={navigate}/>
      <p className="mt-2 text-xs text-muted-foreground">{salesView && prior ? `Comparing with ${prior.dateFrom} to ${prior.dateTo}. ` : ''}{state.dateTo >= new Date().toLocaleDateString('en-CA') ? 'Current day may be partial. ' : ''}Business dates, inclusive. <a href="#reporting-coverage" className="underline underline-offset-2">Data coverage</a></p>
    </>}
    {(accessError || (!accessLoading && !domainAccessLoading && !financeAccess.isLoading && !selectedAllowed && !(state.view === 'finance' && financeAccess.isError))) && <Alert className="mt-6"><AlertTitle>{accessError ? 'Reporting access could not be loaded' : 'This reporting view is not available to your account'}</AlertTitle><AlertDescription>Select an available view or refresh to retry access. A saved link does not grant permission.{hasLaborPanel && <Button variant="link" className="min-h-11 whitespace-normal" onClick={() => navigateToApp(operationalReportHref('labor', params))}>View labor in Timekeeping</Button>}{hasRefundPanel && <Button variant="link" className="min-h-11 whitespace-normal" onClick={() => navigateToApp(operationalReportHref('refunds', params))}>View reports in Refunds</Button>}</AlertDescription></Alert>}
    {state.view === 'finance' && financeAccess.isLoading && <Skeleton aria-label="Checking finance access" className="mt-6 h-32"/>}
    {state.view === 'finance' && financeAccess.isError && <Alert className="mt-6"><AlertTitle>Finance access could not be loaded</AlertTitle><AlertDescription>Your sales and refund reporting scope could not be verified. <Button variant="outline" className="ml-2 min-h-11" onClick={() => void financeAccess.refetch()}><RefreshCw className="mr-2 h-4 w-4"/>Retry</Button></AlertDescription></Alert>}
    {rangeTooLong && workspaceMode && <Alert className="mt-6"><AlertTitle>Choose a shorter reporting period</AlertTitle><AlertDescription>Analytics supports up to 367 days at a time. Choose Custom range from Period. For longer periods, use Sales.</AlertDescription></Alert>}
    {invalidLinkedDates && state.view !== 'partners' && <Alert className="mt-6"><AlertTitle>The linked dates are invalid</AlertTitle><AlertDescription>Choose valid dates before loading this report. <Button variant="link" onClick={() => navigate({ dateFrom: state.dateFrom, dateTo: state.dateTo })}>Use the dates shown above</Button></AlertDescription></Alert>}
    {scopeInvalid && <Alert className="mt-6"><AlertTitle>Selected scope is unavailable</AlertTitle><AlertDescription>This location or machine is outside this view's currently authorized scope. <Button variant="link" onClick={() => navigate({ locationId: 'all', machineId: 'all' })}>Choose all accessible locations</Button></AlertDescription></Alert>}
    {loading && <div aria-label="Loading report" className="mt-6 space-y-5"><div className="grid grid-cols-2 gap-6 lg:grid-cols-4">{[1,2,3,4].map(item => <Skeleton className="h-24" key={item}/>)}</div><Skeleton className="h-72"/></div>}
    {((salesView && (report.isError || dimensions.isError)) || (showDetailed && dimensions.isError)) && <Alert variant="destructive" className="mt-6"><AlertTitle>Sales report unavailable</AlertTitle><AlertDescription>Loaded records could not be fetched. This is not a zero-sales result. <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={() => { void dimensions.refetch(); if (salesView) void report.refetch(); }}><RefreshCw className="mr-2 h-4 w-4"/>Retry</Button></AlertDescription></Alert>}
    {salesView && prior && (comparison.isError || prior.shortened) && <p className="mt-3 text-xs text-muted-foreground">{comparison.isError ? 'Comparison unavailable for these dates.' : 'Comparison dates do not form an equal calendar window. Percentage changes are unavailable.'}</p>}
    {!loading && !periodInvalid && selectedAllowed && salesView && report.isSuccess && !scopeInvalid && <>{state.view === 'overview' && <ReportingOverview {...analytics}/>} {state.view === 'locations' && <ReportingLocations {...analytics}/>}</>}
    {selectedAllowed && !scopeInvalid && !periodInvalid && salesView && (hasLaborPanel || hasRefundPanel) && <ReportingOperations key={user?.id} scope={scope} canUseLabor={hasLaborPanel} canUseRefunds={hasRefundPanel} onNavigate={view => navigateToApp(operationalReportHref(view, state))} />}
    {legacyDomain && legacyAllowed && <Navigate replace to={operationalReportHref(legacyDomain, params)}/>}
    {selectedAllowed && !scopeInvalid && !periodInvalid && state.view === 'finance' && <ReportingFinance scope={scope} onMachine={(machineId, locationId) => navigate({ machineId, locationId })}/>}
    {selectedAllowed && state.view === 'partners' && <div className="mt-6">{partnerView}</div>}
    {selectedAllowed && showDetailed && !scopeInvalid && !invalidLinkedDates && dimensions.isSuccess && <div className="mt-4">{detailedSales(filters)}</div>}
    <details className="mt-8 border-t border-border pt-4" id="reporting-coverage"><summary className="cursor-pointer text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Data coverage and metric definitions</summary><div className="mt-3 max-w-3xl space-y-2 text-sm leading-relaxed text-muted-foreground"><p>Latest sale in authorized scope: {accessContext.latestSaleDate ?? 'Unknown'}. Latest completed import: {accessContext.latestImportCompletedAt ? new Date(accessContext.latestImportCompletedAt).toLocaleString() : 'Unknown'}. A recent import does not establish completeness across providers, machines or dates.</p><p>No loaded rows means unavailable coverage, not confirmed zero activity. Unknown amounts remain unavailable; known subtotals identify omitted rows. Prior comparisons use the same currently authorized filters and require a positive prior denominator.</p><p>Transaction counts use the canonical provider financial unit. Sales per recorded transaction uses sales before refunds, excluding tax under the shared basis. Machine-local business dates are retained. Time entries, recovery and payroll use their own permissions and date basis.</p><p>Calculation versions in loaded sales: {[...new Set(rows.map(row => row.calculationVersion))].join(', ') || 'No loaded sales'}. No provider completeness denominator or verified uptime is available.</p></div></details>
  </div>;
}
