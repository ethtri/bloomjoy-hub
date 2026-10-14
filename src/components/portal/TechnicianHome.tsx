import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, BookOpen, ChevronRight, FileText, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import type { usePortalTimekeepingAccess } from '@/hooks/usePortalTimekeepingAccess';
import { getWeekStart } from '@/lib/timekeepingUi';

type Props = {
  timekeeping: ReturnType<typeof usePortalTimekeepingAccess>;
  canAccessTraining: boolean;
  canAccessReporting: boolean;
};

const linkStyle = 'inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function TechnicianHome({ timekeeping, canAccessTraining, canAccessReporting }: Props) {
  const { language, t } = useLanguage();
  const [profileId, setProfileId] = useState('');
  const profiles = timekeeping.data?.profiles.filter((profile) => profile.status === 'active') ?? [];
  const profile = profiles.find((item) => item.id === profileId) ?? profiles[0];
  const entries = (profile?.currentEntries ?? [])
    .filter((entry) => entry.status !== 'voided')
    .sort((a, b) => b.workDate.localeCompare(a.workDate) || b.startTime.localeCompare(a.startTime));
  const minutes = entries.reduce((total, entry) => total + entry.actualDurationMinutes, 0);
  const shifts = entries.reduce((total, entry) => total + entry.paidShifts, 0);
  const locale = language === 'zh-Hans' ? 'zh-CN' : 'en-US';
  const date = (value: string) => new Intl.DateTimeFormat(locale, {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
  const time = (value: string) => new Intl.DateTimeFormat(locale, {
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  }).format(new Date(`2000-01-01T${value.slice(0, 5)}:00Z`));
  const duration = (value: number) => t('workday.duration', {
    hours: Math.floor(value / 60), minutes: value % 60,
  });
  const profileSearch = profile ? `?profile=${encodeURIComponent(profile.id)}` : '';
  const unavailable = Boolean(timekeeping.error);
  const loading = timekeeping.isResolvingPortalTimekeeping;

  return (
    <section className="portal-section">
      <div className="container-page space-y-6" data-dashboard-state={unavailable ? 'error' : loading ? 'loading' : 'ready'}>
        <header data-dashboard-header>
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t('workday.title')}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">{t('workday.description')}</p>
        </header>

        {profiles.length > 1 && (
          <div className="max-w-sm space-y-2">
            <label className="block text-sm font-medium" htmlFor="home-profile">{t('workday.account')}</label>
            <select id="home-profile" value={profile?.id ?? ''} onChange={(event) => setProfileId(event.target.value)} className="min-h-11 w-full rounded-lg border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {profiles.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.accountName}</option>)}
            </select>
          </div>
        )}

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(16rem,1fr)]">
          <section aria-labelledby="workday-time-title" className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6" data-dashboard-primary-task>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 id="workday-time-title" className="text-xl font-semibold">{t('workday.timeTitle')}</h2>
                {!unavailable && profile && <p className="mt-1 text-sm text-muted-foreground">{date(profile.currentPeriod.periodStartDate)} – {date(profile.currentPeriod.periodEndDate)}</p>}
                {!loading && !unavailable && profile && <p className="mt-5 text-sm tabular-nums text-muted-foreground" data-workday-summary><strong className="font-semibold text-foreground">{duration(minutes)}</strong> {t(shifts === 1 ? 'workday.recordedSingle' : 'workday.recorded', { shifts })}</p>}
              </div>
              {!loading && <Button asChild className="min-h-11 sm:shrink-0"><Link data-dashboard-primary-action to={profile && !unavailable ? `/portal/time/new${profileSearch}` : '/portal/time'}>{t(profile && !unavailable ? 'workday.addTime' : 'dashboard.openTime')}</Link></Button>}
            </div>

            {loading ? (
              <div className="mt-5 space-y-4" role="status" data-dashboard-primary-loading>
                <Skeleton className="h-6 w-2/3" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" />
                <span className="sr-only">{t('dashboard.statusChecking')}</span>
              </div>
            ) : unavailable ? (
              <div className="mt-5 rounded-xl bg-muted/50 p-4" role="alert" data-dashboard-status-error data-dashboard-error-state>
                <p className="font-medium">{t('workday.timeUnavailable')}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('workday.timeUnavailableDescription')}</p>
                <Button variant="outline" className="mt-3 min-h-11" disabled={timekeeping.isFetching} onClick={() => void timekeeping.refetch()}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />{t('dashboard.retryStatus')}</Button>
              </div>
            ) : !profile ? (
              <p className="mt-5 text-sm leading-6 text-muted-foreground">{t('dashboard.timeSetupDescription')}</p>
            ) : (
              <>
                <div className="mt-5 border-t border-border pt-4">
                  <h3 className="text-sm font-semibold">{t('workday.recentEntries')}</h3>
                  {entries.length === 0 ? (
                    <div className="py-6" data-workday-empty>
                      <p className="font-medium">{t('workday.noTime')}</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('workday.noTimeDescription')}</p>
                    </div>
                  ) : (
                    <ul className="mt-1 divide-y divide-border">
                      {entries.slice(0, 3).map((entry, index) => (
                        <li key={entry.id} className={index === 2 ? 'hidden sm:block' : undefined}>
                          <Link to={`/portal/time?profile=${encodeURIComponent(profile.id)}&week=${getWeekStart(entry.workDate)}&date=${entry.workDate}`} className="group flex min-h-20 items-center gap-3 rounded-lg py-4 outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring" data-workday-entry>
                            <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{entry.machineLabel}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground sm:text-sm">{date(entry.workDate)}, <span className="whitespace-nowrap">{time(entry.startTime)}</span> – <span className="whitespace-nowrap">{time(entry.endTime)}</span></span></span>
                            <span className="shrink-0 text-xs tabular-nums sm:text-sm">{duration(entry.actualDurationMinutes)}</span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="border-t border-border pt-2"><Link className={linkStyle} to={`/portal/time${profileSearch}`}>{t('workday.allTime')}<ChevronRight className="h-4 w-4" aria-hidden="true" /></Link></div>
              </>
            )}
          </section>

          <section aria-labelledby="workday-pay-title" className="rounded-2xl border border-border bg-card p-5 sm:p-6 xl:self-stretch">
            <div className="flex items-start gap-4 xl:flex-col">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/5 text-primary"><FileText className="h-6 w-6" aria-hidden="true" /></span>
              <div><h2 id="workday-pay-title" className="text-xl font-semibold">{t('workday.payStubs')}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{t('workday.payDescription')}</p></div>
            </div>
            <div className="mt-5 border-t border-border pt-2"><Link className={linkStyle} to={`/portal/time${profileSearch}#pay-stubs`} data-dashboard-secondary-action>{t('workday.viewPay')}<ChevronRight className="h-4 w-4" aria-hidden="true" /></Link></div>
          </section>
        </div>

        {(canAccessReporting || canAccessTraining) && <section aria-labelledby="workday-tools-title">
          <h2 id="workday-tools-title" className="mb-3 text-xl font-semibold">{t('workday.tools')}</h2>
          <nav aria-label={t('workday.tools')} className="divide-y divide-border rounded-2xl border border-border bg-card px-5 sm:px-6">
            {[
              { show: canAccessReporting, href: '/portal/reports', icon: BarChart3, title: 'portal.nav.reporting' as const, description: 'workday.reportingDescription' as const },
              { show: canAccessTraining, href: '/portal/training', icon: BookOpen, title: 'portal.nav.training' as const, description: 'workday.trainingDescription' as const },
            ].filter((item) => item.show).map((item) => <Link key={item.href} to={item.href} className="group flex min-h-20 items-center gap-4 rounded-lg py-4 outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring"><item.icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{t(item.title)}</span><span className="mt-1 block text-sm leading-5 text-muted-foreground">{t(item.description)}</span></span><ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden="true" /></Link>)}
          </nav>
        </section>}
      </div>
    </section>
  );
}
