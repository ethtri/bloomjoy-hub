import { Outlet } from 'react-router-dom';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useEmailAlerts } from '@/hooks/useEmailAlerts';

/** Server eligibility is independent of Account Settings or Admin machine access. */
export function EmailAlertsRoute() {
  const query = useEmailAlerts();
  if (query.isSuccess && query.data.eligible) return <Outlet />;
  return <PortalLayout><section className="container-page space-y-6 py-8"><h1 className="text-3xl font-semibold">Email alerts</h1>
    {query.isPending ? <div aria-label="Loading email preferences" className="space-y-4"><Skeleton className="h-16"/><Skeleton className="h-72"/></div>
      : query.isError ? <Alert variant="destructive"><AlertTitle>Email preferences could not be loaded</AlertTitle><AlertDescription>Try again to check your available machines and saved choices.<Button className="mt-4 block" variant="outline" onClick={() => void query.refetch()}>Try again</Button></AlertDescription></Alert>
      : <div className="rounded-lg border border-dashed p-8"><h2 className="text-lg font-semibold">No machines available for alerts</h2><p className="mt-2 text-sm text-muted-foreground">Your machines will appear here when you have access. Ask your manager to check your assignments.</p></div>}
  </section></PortalLayout>;
}
