import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { fetchEmailAlertPreferences } from '@/lib/emailAlerts';

export const emailAlertsQueryKey = (userId?: string) => ['email-alert-preferences', userId] as const;
export function useEmailAlerts(enabled = true) {
  const { user, isAuthenticated } = useAuth();
  return useQuery({
    queryKey: emailAlertsQueryKey(user?.id), queryFn: fetchEmailAlertPreferences,
    enabled: enabled && isAuthenticated && Boolean(user?.id), staleTime: 60000, retry: false, refetchOnWindowFocus: false,
  });
}
