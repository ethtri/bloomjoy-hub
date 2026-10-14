import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getNextPacificMidnight } from '@/lib/timeEditingDeadline';
import { getTodayInTimekeepingZone } from '@/lib/timekeepingUi';

/** Keep an open form honest at the cutoff and when a suspended tab returns. */
export function useTimekeepingClock(enabled = true) {
  const [now, setNow] = useState(() => new Date());
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    let previousDay = getTodayInTimekeepingZone();
    const update = (refresh = false) => {
      clearTimeout(timer);
      const current = new Date();
      const day = getTodayInTimekeepingZone(current);
      setNow(current);
      if (refresh || day !== previousDay) {
        void queryClient.invalidateQueries({ queryKey: ['operator-timekeeping'] });
        void queryClient.invalidateQueries({ queryKey: ['operator-timekeeping-access'] });
      }
      previousDay = day;
      // Never drift past midnight. The shorter heartbeat also updates urgency.
      timer = setTimeout(() => update(), Math.max(1, Math.min(60_000, getNextPacificMidnight(current) - current.getTime())));
    };
    const resume = () => { if (document.visibilityState === 'visible') update(true); };
    update();
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [enabled, queryClient]);
  return now;
}
