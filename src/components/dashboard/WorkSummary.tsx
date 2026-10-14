import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { useHomeLaborSummary } from '@/hooks/useHomeLaborSummary';
import { laborAnalyticsTotals } from '@/lib/laborAnalyticsModel';
import { homePayReportHref, homeTimeReportHref } from '@/lib/homeLaborSummary';
import { homeLaborCopy } from './homeLaborCopy';

const linkStyle = 'inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

/** Read-only Home projections. Release requires #1912's corrected revision freshness. */
export function WorkSummary() {
  const { language } = useLanguage();
  const copy = homeLaborCopy[language];
  const { access, current, previous, periods, verified, canOpenAdminPay } = useHomeLaborSummary();
  const locale = language === 'zh-Hans' ? 'zh-CN' : 'en-US';
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const range = (scope: { dateFrom: string; dateTo: string }) => {
    const format = (value: string) => new Intl.DateTimeFormat(locale, {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(`${value}T12:00:00Z`));
    return `${format(scope.dateFrom)} – ${format(scope.dateTo)}`;
  };
  const retry = (action: () => unknown, fetching: boolean) => (
    <Button type="button" variant="outline" className="mt-3 min-h-11" disabled={fetching} onClick={() => void action()}>
      <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />{copy.retry}
    </Button>
  );
  if (verified && !access.data.hasAccess && !access.data.canViewPay) return null;
  const totals = current.data?.access.hasAccess ? laborAnalyticsTotals(current.data.rows) : null;
  const pay = previous.data?.access.canViewPay ? previous.data.pay : null;
  const currentAvailable = current.data?.access.hasAccess && current.data.dateFrom === periods.current.dateFrom && current.data.dateTo === periods.current.dateTo;
  const payAvailable = pay && previous.data?.dateFrom === periods.previous.dateFrom && previous.data.dateTo === periods.previous.dateTo;

  return <section aria-labelledby="home-labor-title" className="space-y-3" data-home-labor-summary>
    <h2 id="home-labor-title" className="font-display text-xl font-semibold">{copy.title}</h2>
    {access.isError ? <div className="rounded-xl border border-border bg-card p-5" role="alert" data-home-labor-access-error>
      <p className="text-sm">{copy.accessError}</p>{retry(() => access.refetch(), access.isFetching)}
    </div> : !verified ? <p role="status" className="text-sm text-muted-foreground">{copy.checking}</p> : (
      <div className={`grid items-start gap-4 ${access.data.hasAccess && access.data.canViewPay ? 'lg:grid-cols-2' : ''}`}>
        {access.data.hasAccess && <article className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6" data-home-recorded-time>
          <SummaryHeading title={copy.recorded} range={range(periods.current)} scope={copy.machineScope} />
          {current.isError ? <div className="mt-4" role="alert"><p className="text-sm">{copy.recordedError}</p>{retry(() => current.refetch(), current.isFetching)}</div>
            : current.isPending ? <LoadingSummary label={copy.loading} />
            : !currentAvailable || !totals ? <p className="mt-4 text-sm" role="status">{copy.unavailable}</p> : <>
              <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
                <Metric label={copy.actual} marker="data-home-actual-minutes" value={totals.actualMinutes}>{number(Math.floor(totals.actualMinutes / 60))} <span className="text-sm font-normal">{copy.hours}</span> {number(totals.actualMinutes % 60)} <span className="text-sm font-normal">{copy.minutes}</span></Metric>
                <Metric label={copy.shifts} marker="data-home-paid-shifts" value={totals.paidShifts}>{number(totals.paidShifts)}</Metric>
                <Metric label={copy.entries} marker="data-home-entry-count" value={totals.entryCount}>{number(totals.entryCount)}</Metric>
              </dl>
              {totals.entryCount === 0 && <p className="mt-4 text-sm leading-6 text-muted-foreground">{copy.emptyTime} {copy.emptyTimeNote}</p>}
            </>}
          {(current.isPending || (current.isSuccess && currentAvailable)) && <div className="mt-4 border-t border-border pt-2"><Link className={linkStyle} to={homeTimeReportHref(periods.current)}>{copy.reports}<ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /></Link></div>}
        </article>}
        {access.data.canViewPay && <article className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6" data-home-pay-inputs>
          <SummaryHeading title={copy.pay} range={range(periods.previous)} scope={copy.accountScope} />
          {previous.isError ? <div className="mt-4" role="alert"><p className="text-sm">{copy.payError}</p>{retry(() => previous.refetch(), previous.isFetching)}</div>
            : previous.isPending ? <LoadingSummary label={copy.loading} />
            : !payAvailable ? <p className="mt-4 text-sm" role="status">{copy.unavailable}</p> : <>
              <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Metric label={copy.calculationIssues} marker="data-home-calculation-issues" value={pay.calculationIssueCount}>{number(pay.calculationIssueCount)}</Metric>
                <Metric label={copy.missingRates} marker="data-home-missing-rates" value={pay.missingShiftRateEntries}>{number(pay.missingShiftRateEntries)}</Metric>
                <Metric label={copy.revisions} marker="data-home-revision-required" value={pay.revisionRequiredCount}>{number(pay.revisionRequiredCount)}</Metric>
              </dl>
              {pay.calculationIssueCount === 0 && pay.missingShiftRateEntries === 0 && pay.revisionRequiredCount === 0 && <p className="mt-4 text-sm leading-6 text-muted-foreground">{copy.emptyPay}</p>}
            </>}
          {(previous.isPending || (previous.isSuccess && payAvailable)) && <div className="mt-4 border-t border-border pt-2"><Link className={linkStyle} to={homePayReportHref(periods.previous, canOpenAdminPay)}>{canOpenAdminPay ? copy.payReport : copy.reports}<ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /></Link></div>}
        </article>}
      </div>
    )}
  </section>;
}

function SummaryHeading({ title, range, scope }: { title: string; range: string; scope: string }) {
  return <header><h3 className="text-base font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{range}</p><p className="mt-1 text-xs font-medium text-muted-foreground">{scope}</p></header>;
}

function Metric({ label, children, marker, value }: { label: string; children: ReactNode; marker: string; value: number }) {
  return <div className="min-w-0"><dt className="min-h-10 text-xs leading-5 text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-2xl font-semibold tabular-nums" {...{ [marker]: value }}>{children}</dd></div>;
}

function LoadingSummary({ label }: { label: string }) {
  return <div className="mt-5" role="status"><Skeleton className="h-14 w-full" /><span className="sr-only">{label}</span></div>;
}
