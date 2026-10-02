import { ArrowRight, Clock3, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { money, number } from '@/lib/reportingWorkspace';

type LaborSummary = {
  loading: boolean; error: boolean; actualMinutes: number; paidShifts: number; entries: number;
};
type RecoverySummary = {
  loading: boolean; error: boolean; requestCount: number; outstandingCents: number;
  unknownBalanceCount: number; asOfDate: string;
};
type Props = {
  labor?: LaborSummary; refunds?: RecoverySummary;
  onNavigate: (view: 'labor' | 'refunds') => void;
};

/** Only render domains after their separate access check has succeeded. */
export function ReportingOperationsSummary({ labor, refunds, onNavigate }: Props) {
  if (!labor && !refunds) return null;
  return <div className={`grid gap-7 border-t border-border pt-6 ${labor && refunds ? 'lg:grid-cols-2' : ''}`}>
    {labor && <section aria-labelledby="reporting-labor-summary-title" className="min-w-0">
      <div className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-muted-foreground" aria-hidden="true"/><h2 id="reporting-labor-summary-title" className="text-xl font-semibold tracking-tight">Recorded effort</h2></div>
      {labor.loading ? <SummarySkeleton label="Loading recorded effort"/> : labor.error ? <p role="status" className="mt-3 text-sm text-muted-foreground">Recorded effort could not be loaded. This is not a zero-work result.</p> : <>
        <dl className="mt-4 grid grid-cols-3 gap-3"><SummaryValue label="Recorded hours" value={number(labor.actualMinutes / 60)}/><SummaryValue label="Time entries" value={number(labor.entries)}/><SummaryValue label="Paid shifts" value={number(labor.paidShifts)}/></dl>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Recorded entries in the selected period and scope. Each entry rounds independently for paid shifts; entries are not visits or staffing utilization.</p>
        {labor.entries === 0 && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">No recorded entries does not prove no work occurred. Recording coverage is unknown.</p>}
      </>}
      <Button variant="link" className="mt-2 min-h-11 h-auto whitespace-normal px-0 py-2 text-left text-[#a93750]" onClick={() => onNavigate('labor')}>View labor in Timekeeping <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true"/></Button>
    </section>}
    {refunds && <section aria-labelledby="reporting-recovery-summary-title" className={`min-w-0 ${labor ? 'lg:border-l lg:border-border lg:pl-7' : ''}`}>
      <div className="flex items-center gap-2"><RotateCcw className="h-5 w-5 text-muted-foreground" aria-hidden="true"/><h2 id="reporting-recovery-summary-title" className="text-xl font-semibold tracking-tight">Refunds & recovery</h2></div>
      {refunds.loading ? <SummarySkeleton label="Loading refunds and recovery"/> : refunds.error ? <p role="status" className="mt-3 text-sm text-muted-foreground">Recovery activity could not be loaded. This is not a zero-request result.</p> : <>
        <dl className="mt-4 grid grid-cols-2 gap-3"><SummaryValue label="Requests received" value={number(refunds.requestCount)}/><SummaryValue label={refunds.unknownBalanceCount ? 'Known outstanding balance' : 'Outstanding balance'} value={money(refunds.outstandingCents)}/></dl>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Requests received in the selected period. Outstanding balance is as of {refunds.asOfDate}, using the authorized recovery scope.</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{refunds.unknownBalanceCount ? `${number(refunds.unknownBalanceCount)} requests have unknown balances and are omitted from the known subtotal. ` : ''}Source coverage may be incomplete. Requests are not confirmed failed vends; gift resolution is separate from cash paid.</p>
      </>}
      <Button variant="link" className="mt-2 min-h-11 h-auto whitespace-normal px-0 py-2 text-left text-[#a93750]" onClick={() => onNavigate('refunds')}>View reports in Refunds <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true"/></Button>
    </section>}
  </div>;
}

function SummaryValue({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs leading-relaxed text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-2xl font-semibold tabular-nums tracking-tight">{value}</dd></div>;
}
function SummarySkeleton({ label }: { label: string }) {
  return <div className="mt-4 space-y-3" role="status" aria-label={label}><Skeleton className="h-10 w-2/3"/><Skeleton className="h-4 w-full"/><Skeleton className="h-4 w-4/5"/></div>;
}
