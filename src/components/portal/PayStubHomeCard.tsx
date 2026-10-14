import { usePayStubFormat } from '@/hooks/usePayStubFormat';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePublishedPayArtifact, usePublishedPayStubs } from '@/hooks/usePublishedPayStubs';
import { newestPublishedStatements, payStubHref, publishedPayAmount, publishedStatementDate } from '@/lib/publishedPayStub';
import { PayStubError, PayStubLoading } from './PayStubShared';

export function PayStubHomeCard({ profileId }: { profileId?: string }) {
  const { t, money, date } = usePayStubFormat();
  const context = usePublishedPayStubs();
  const profiles = context.data?.profiles ?? [];
  // A selected timekeeping profile must not silently display a different payer's statement.
  const profile = profileId ? profiles.find(item => item.id === profileId) : profiles.length === 1 ? profiles[0] : undefined;
  const newest = newestPublishedStatements(profile?.statements ?? [])[0];
  const artifact = usePublishedPayArtifact(profile?.id, context.isError ? undefined : newest?.id);
  const amount = artifact.isError ? null : publishedPayAmount(artifact.data?.statement);
  const statementDate = artifact.isError ? null : publishedStatementDate(artifact.data?.statement);
  return <section aria-labelledby="workday-pay-title" className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6 xl:self-stretch">
    <h2 id="workday-pay-title" className="text-xl font-semibold">{t('workday.payStubs')}</h2>
    <div className="mt-4">
      {context.isLoading ? <PayStubLoading /> : context.isError ? <PayStubError onRetry={() => void context.refetch()} busy={context.isFetching} /> : newest ? <>
        <p className="text-sm font-medium">{t('payStub.latest')}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{date(newest.periodStartDate)} – {date(newest.periodEndDate)}</p>
        {newest.version > 1 && <p className="mt-1 text-sm text-muted-foreground">{t('payStub.revised', { version: newest.version })}</p>}
        {artifact.isLoading ? <PayStubLoading /> : artifact.isError ? <div className="mt-3"><PayStubError onRetry={() => void artifact.refetch()} busy={artifact.isFetching} /></div> : <dl className="mt-4 space-y-3 text-sm">
          {statementDate && <div><dt className="text-muted-foreground">{t('payStub.statementDate')}</dt><dd className="mt-1">{date(statementDate)}</dd></div>}
          {amount !== null && <div><dt className="text-muted-foreground">{t('payStub.total')} (USD)</dt><dd className="mt-1 text-xl font-semibold tabular-nums" data-published-pay-amount>{money(amount)}</dd></div>}
        </dl>}
        <Button asChild className="mt-5 min-h-11 w-full"><Link to={payStubHref(profile.id, newest.id)}>{t('payStub.view')}</Link></Button>
      </> : <p className="text-sm leading-6 text-muted-foreground">{t(profile ? 'workday.noPay' : 'workday.payDescription')}</p>}
    </div>
    <div className="mt-5 border-t border-border pt-2"><Link className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" to={payStubHref(profile?.id ?? profileId)} data-dashboard-secondary-action>{t('payStub.history')}<ChevronRight className="h-4 w-4" aria-hidden="true" /></Link></div>
  </section>;
}
