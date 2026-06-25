import { useQuery } from '@tanstack/react-query';
import { canUsePortalTeamManagement } from '@/components/portal/portalNavigation';
import { useAuth } from '@/contexts/auth-context';
import { fetchTechnicianManagementContext } from '@/lib/technicianEntitlements';

export function usePortalTechnicianManagement() {
  const { user, canManageTechnicians, capabilities } = useAuth();
  const hasAdvertisedTeamCapability = canUsePortalTeamManagement({
    canManageTechnicians,
    capabilities,
  });

  const query = useQuery({
    queryKey: ['technician-management-context', user?.id],
    queryFn: fetchTechnicianManagementContext,
    enabled: Boolean(user?.id && hasAdvertisedTeamCapability),
    staleTime: 1000 * 30,
  });

  const hasActiveTeamManagementScope = Boolean(
    query.data?.canManage && query.data.accounts.length > 0
  );

  return {
    ...query,
    hasAdvertisedTeamCapability,
    hasActiveTeamManagementScope,
    canUsePortalTeam: hasAdvertisedTeamCapability && hasActiveTeamManagementScope,
    isResolvingPortalTeam:
      hasAdvertisedTeamCapability && query.isLoading && !query.data && !query.error,
  };
}
