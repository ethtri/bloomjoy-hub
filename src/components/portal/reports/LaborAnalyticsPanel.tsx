import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Clock3, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchLaborAnalytics, laborAnalyticsCsv, laborAnalyticsTotals, type LaborAnalyticsReport, type LaborAnalyticsScope } from '@/lib/laborAnalytics';

const money = (cents: number | null) => cents === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

export function LaborAnalyticsPanel({ scope }: { scope: LaborAnalyticsScope }) {
  const [report, setReport] = useState<LaborAnalyticsReport | null>(null);
  const [error, setError] = useState(false);
  const scopeKey = JSON.stringify(scope);
  useEffect(() => {
    let active = true;
    setReport(null); setError(false);
    fetchLaborAnalytics(JSON.parse(scopeKey)).then(data => { if (active) setReport(data); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [scopeKey]);
  if (error) return <Card><CardContent className="pt-6" role="alert">Labor analytics could not load. Refresh to try again.</CardContent></Card>;
  if (!report) return <p className="py-8 text-muted-foreground" role="status">Loading recorded labor…</p>;
  if (!report.access.hasAccess && !report.access.canViewPay) return <p className="py-8 text-muted-foreground">Labor analytics requires Time Report or account Pay Report access.</p>;
  const totals = laborAnalyticsTotals(report.rows);
  const download = () => {
    const url = URL.createObjectURL(new Blob([laborAnalyticsCsv(report)], { type: 'text/csv;charset=utf-8;' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `labor-${report.dateFrom}-${report.dateTo}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-semibold flex items-center gap-2"><Clock3 className="h-5 w-5" />Recorded labor</h2><p className="text-sm text-muted-foreground">Where recorded effort goes across locations and weeks.</p></div>
      <Button variant="outline" className="min-h-11" onClick={download}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
    </div>
    {report.access.hasAccess && <>
      <div className="grid gap-3 sm:grid-cols-3">
        {[['Recorded hours', (totals.actualMinutes / 60).toFixed(2)], ['Time entries', totals.entryCount], ['Paid shifts', totals.paidShifts]].map(([label, value]) => <Card key={label}><CardContent className="pt-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p></CardContent></Card>)}
      </div>
      <p className="text-sm text-muted-foreground">Each entry rounds independently to a started hour for paid shifts. Three 20-minute entries are one recorded hour and three paid shifts. Entries are not visits or staffing utilization.</p>
      <Card><CardHeader><CardTitle className="text-base">Weekly effort by location and machine</CardTitle></CardHeader><CardContent>
        {!report.rows.length ? <p className="text-sm text-muted-foreground">No recorded entries in this scope. This does not prove no work occurred.</p> : <div className="hidden sm:block overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Recorded labor by week, location and machine</caption><thead><tr className="border-b">{['Week starting', 'Location / machine', 'Entries', 'Hours', 'Paid shifts'].map(label => <th key={label} className="py-3 px-2 text-left font-medium whitespace-nowrap">{label}</th>)}</tr></thead><tbody>{report.rows.map(row => <tr key={`${row.week}-${row.locationId}-${row.machineId}`} className="border-b last:border-0"><td className="py-3 px-2 whitespace-nowrap">{row.week}</td><td className="py-3 px-2"><span className="font-medium">{row.locationName}</span><br /><span className="text-muted-foreground">{row.machineLabel}</span></td><td className="py-3 px-2 tabular-nums">{row.entryCount}</td><td className="py-3 px-2 tabular-nums">{(row.actualMinutes / 60).toFixed(2)}</td><td className="py-3 px-2 tabular-nums">{row.paidShifts}</td></tr>)}</tbody></table></div>}
        {report.rows.length > 0 && <div className="divide-y divide-border sm:hidden">{report.rows.map(row => <article key={`${row.week}-${row.locationId}-${row.machineId}`} className="min-w-0 py-4 first:pt-0 last:pb-0"><h3 className="break-words font-medium">{row.locationName}</h3><p className="break-words text-sm text-muted-foreground">{row.machineLabel}</p><p className="mt-2 text-sm">Week starting {row.week}</p><dl className="mt-3 grid grid-cols-3 gap-2 text-sm"><div><dt className="text-muted-foreground">Entries</dt><dd className="font-medium tabular-nums">{row.entryCount}</dd></div><div><dt className="text-muted-foreground">Hours</dt><dd className="font-medium tabular-nums">{(row.actualMinutes / 60).toFixed(2)}</dd></div><div><dt className="text-muted-foreground">Paid shifts</dt><dd className="font-medium tabular-nums">{row.paidShifts}</dd></div></dl></article>)}</div>}
      </CardContent></Card>
    </>}
    {report.access.canViewPay && report.pay && <Card><CardHeader><CardTitle className="text-base">Authorized account earnings</CardTitle></CardHeader><CardContent className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-3">{[['Attributable shift earnings', money(report.pay.shiftEarningsCents)], ['Attributable commission', money(report.pay.commissionEarningsCents)], ['Unallocated other earnings', money(report.pay.unallocatedOtherEarningsCents)]].map(([label, value]) => <div key={label}><p className="text-sm text-muted-foreground">{label}</p><p className="text-xl font-semibold tabular-nums">{value}</p></div>)}</div>
      <p className="text-sm text-muted-foreground">{report.pay.coverage}</p>
      <p className="text-sm">Account scope: {report.pay.readyCalculationCount} ready full-month calculations · {report.pay.partialMonthCalculationCount} partial-month estimates · {report.pay.calculationIssueCount} calculation issues · {report.pay.revisionRequiredCount} revisions required · {report.pay.missingShiftRateEntries} entries missing a shift rate.</p>
      <p className="text-sm text-muted-foreground">{report.pay.publishedStatementCount} published statements for overlapping periods, across authorized accounts. {report.pay.statementBasis}</p>
    </CardContent></Card>}
    <p className="text-xs text-muted-foreground">{report.dateBasis}</p>
    <div className="flex flex-wrap gap-3">{report.access.canViewPay && <Button variant="outline" asChild><Link to={`/admin/payouts?month=${scope.dateFrom.slice(0, 7)}`}>Open Pay Report<ExternalLink className="ml-2 h-4 w-4" /></Link></Button>}</div>
  </div>;
}
