import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getTimeEditingDeadline, type TimeEditingAuthority } from '@/lib/timeEditingDeadline';
import { getWeekStart, TIMEKEEPING_TIME_ZONE } from '@/lib/timekeepingUi';
import { cn } from '@/lib/utils';

export function TimeEditingDeadline({ workDate, now, authority, profileId, link = false }: {
  workDate: string;
  now: Date;
  authority?: TimeEditingAuthority;
  profileId?: string;
  link?: boolean;
}) {
  const { language, t } = useLanguage();
  const deadline = getTimeEditingDeadline(workDate, now, authority);
  if (!deadline) return null;
  const locale = language === 'zh-Hans' ? 'zh-CN' : 'en-US';
  const month = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${deadline.month}T12:00:00Z`));
  const date = new Intl.DateTimeFormat(locale, {
    month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: TIMEKEEPING_TIME_ZONE,
  }).format(new Date(deadline.lastEditableAt));
  const href = `/portal/time?date=${workDate}&week=${getWeekStart(workDate)}&month=${workDate.slice(0, 7)}${profileId ? `&profile=${encodeURIComponent(profileId)}` : ''}`;
  return (
    <div data-time-deadline className={cn('flex items-start gap-3 rounded-lg px-3 py-3 text-sm leading-6',
      deadline.closingSoon ? 'bg-amber/10 text-foreground' : 'bg-muted/40 text-muted-foreground')}>
      <CalendarDays aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p>{t(deadline.editable ? 'timeDeadline.open' : now.getTime() < deadline.cutoffAt ? 'timeDeadline.entryClosed' : 'timeDeadline.closed', { month, deadline: date })}</p>
        {!deadline.editable && <p>{t('timeDeadline.managerCorrection')}</p>}
        {link && <Link to={href} className="inline-flex min-h-11 items-center gap-1 rounded text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
          {t('timeDeadline.reviewMonth', { month })}<ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />
        </Link>}
      </div>
    </div>
  );
}
