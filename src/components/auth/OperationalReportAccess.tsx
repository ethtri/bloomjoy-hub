import { Link, Outlet } from 'react-router-dom';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { Button } from '@/components/ui/button';
import { useReportingAnalyticsAccess } from '@/hooks/useReportingAnalyticsAccess';

/** Report navigation reuses analytics authority, never queue or time-edit authority. */
export function OperationalReportAccess({ domain }: { domain: 'labor' | 'refunds' }) {
  const access = useReportingAnalyticsAccess(true, domain);
  const query = domain === 'labor' ? access.labor : access.refunds;
  const allowed = domain === 'labor' ? access.canUseLabor : access.canUseRefunds;
  if (allowed) return <Outlet />;
  return <PortalLayout><section className="portal-section"><div className="container-page space-y-4">
    {query.isPending ? <p role="status" className="text-muted-foreground">Opening report…</p> : <>
      <h1 className="text-2xl font-semibold">{query.isError ? 'Report unavailable' : 'Report access required'}</h1>
      <p className="text-muted-foreground">{query.isError ? 'This report could not be opened. Please try again.' : 'This report is not available for this account.'}</p>
      <div className="flex flex-wrap gap-3">
        {query.isError && <Button className="min-h-11" onClick={() => void query.refetch()}>Try again</Button>}
        <Button variant="outline" className="min-h-11" asChild><Link to="/portal">Back to dashboard</Link></Button>
      </div>
    </>}
  </div></section></PortalLayout>;
}
