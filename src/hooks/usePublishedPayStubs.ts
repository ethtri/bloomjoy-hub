import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { fetchMyOperatorPayStatementContext, fetchPayStatementArtifact } from '@/lib/operatorPayouts';

export function usePublishedPayStubs(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['operator-pay-statements', user?.id],
    queryFn: fetchMyOperatorPayStatementContext,
    enabled: Boolean(user?.id) && enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function usePublishedPayArtifact(profileId?: string, statementId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['operator-pay-statement-artifact', user?.id, profileId, statementId],
    queryFn: async () => {
      const artifact = await fetchPayStatementArtifact(statementId!);
      if (artifact.statement?.id !== statementId || artifact.statement.status !== 'issued') {
        throw new Error('Published statement unavailable.');
      }
      return artifact;
    },
    enabled: Boolean(user?.id && profileId && statementId),
    staleTime: 0,
    retry: false,
  });
}
