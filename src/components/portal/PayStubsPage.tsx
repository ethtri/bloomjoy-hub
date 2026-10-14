import { usePayStubFormat } from '@/hooks/usePayStubFormat';
import { useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PortalLayout } from './PortalLayout';
import { usePublishedPayStubs } from '@/hooks/usePublishedPayStubs';
import { newestPublishedStatements, payStubHref } from '@/lib/publishedPayStub';
import { PayStubDetails } from './PayStubDetails';
import { PayStubsPanel } from './PayStubsPanel';
import { PayStubError, PayStubLoading } from './PayStubShared';

export function PayStubsPage() {
  const { t } = usePayStubFormat();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const profileId = search.get('profile');
  const statementId = search.get('statement');
  const query = usePublishedPayStubs();
  const profiles = query.data?.profiles ?? [];
  const profile = profileId ? profiles.find(item => item.id === profileId) : profiles[0];
  const statement = newestPublishedStatements(profile?.statements ?? []).find(item => item.id === statementId);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { window.scrollTo(0, 0); headingRef.current?.focus({ preventScroll: true }); }, [profileId, statementId]);
  return <PortalLayout><section className="portal-section"><div className="container-page max-w-5xl space-y-5">
    {statementId && <Button asChild variant="ghost" className="min-h-11 -ml-3"><Link to={payStubHref(profile?.id ?? profileId ?? undefined)}><ChevronLeft className="mr-2 h-4 w-4" aria-hidden="true" />{t('payStub.back')}</Link></Button>}
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div><h1 ref={headingRef} tabIndex={-1} className="font-display text-3xl font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring">{t(statementId ? 'payStub.title' : 'workday.payStubs')}</h1>{!statementId && <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('workday.payDescription')}</p>}</div>
      <Button asChild variant="outline" className="min-h-11"><Link to={`/portal/time${profile ? `?profile=${encodeURIComponent(profile.id)}` : ''}`}><Clock3 className="mr-2 h-4 w-4" aria-hidden="true" />{t('workday.allTime')}</Link></Button>
    </header>
    {profiles.length > 1 && <div className="max-w-md space-y-2"><label htmlFor="pay-profile" className="block text-sm font-medium">{t('workday.account')}</label><Select value={profile?.id ?? ''} onValueChange={value => navigate(payStubHref(value))}><SelectTrigger id="pay-profile" className="min-h-11 bg-card"><SelectValue /></SelectTrigger><SelectContent>{profiles.map(item => <SelectItem key={item.id} value={item.id}>{item.displayName} · {item.accountName}</SelectItem>)}</SelectContent></Select></div>}
    {statementId ? query.isLoading ? <PayStubLoading /> : query.isError || !profile || !statement ? <PayStubError onRetry={() => void query.refetch()} busy={query.isFetching} /> : <PayStubDetails key={`${profile.id}:${statement.id}`} profileId={profile.id} statement={statement} /> : <PayStubsPanel profile={profile} isLoading={query.isLoading} error={query.error || (profileId && !query.isLoading && !profile ? new Error('Unavailable') : null)} onRetry={() => void query.refetch()} expanded />}
  </div></section></PortalLayout>;
}
