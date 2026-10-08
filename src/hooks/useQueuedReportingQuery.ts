import { useEffect, useRef } from 'react';
import { CancelledError, hashKey, useQuery, type QueryKey } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { reportingAdmission, ReportingAdmissionCancelled } from '@/lib/reportingAdmission';
import { reportingQueryRetry } from '@/lib/reportingQuery';

/** A pending request must still belong to the current user, scope and access. */
export function useReportAdmission(queryKey: QueryKey, enabled = true) {
  const { user } = useAuth();
  const key = hashKey(queryKey);
  const owner = user?.id;
  const current = useRef({ owner, key, enabled });
  current.current = { owner, key, enabled };
  useEffect(() => { reportingAdmission.revalidate(); }, [owner, key, enabled]);
  useEffect(() => () => { current.current.enabled = false; reportingAdmission.revalidate(); }, []);
  return <T,>(request: () => Promise<T>, signal?: AbortSignal, priority = 0) => reportingAdmission.run({
    signal, priority,
    eligible: () => Boolean(owner && current.current.enabled && current.current.owner === owner && current.current.key === key),
  }, request);
}

export function useQueuedReportingQuery<T>({ queryKey, queryFn, enabled = true, priority = 0, staleTime = 30000 }: {
  queryKey: QueryKey; queryFn: () => Promise<T>; enabled?: boolean; priority?: number; staleTime?: number;
}) {
  const admit = useReportAdmission(queryKey, enabled);
  return useQuery({ queryKey, enabled, staleTime, retry: reportingQueryRetry,
    queryFn: async ({ signal }) => {
      try { return await admit(queryFn, signal, priority); }
      catch (error) {
        if (error instanceof ReportingAdmissionCancelled) throw new CancelledError({ revert: true });
        throw error;
      }
    },
  });
}
