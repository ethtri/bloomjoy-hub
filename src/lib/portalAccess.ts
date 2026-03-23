export type PortalAccessTier = 'baseline' | 'training' | 'plus';
export type PortalAccountRole = 'partner' | 'operator' | null;

const portalAccessRank: Record<PortalAccessTier, number> = {
  baseline: 0,
  training: 1,
  plus: 2,
};

export const hasPortalAccess = (
  currentTier: PortalAccessTier | undefined,
  requiredTier: PortalAccessTier
) => portalAccessRank[currentTier ?? 'baseline'] >= portalAccessRank[requiredTier];

export const getPortalAccessBadgeLabel = ({
  accessTier,
  portalRole,
  hasPaidMembership,
  isAdmin,
}: {
  accessTier: PortalAccessTier;
  portalRole: PortalAccountRole;
  hasPaidMembership?: boolean;
  isAdmin?: boolean;
}) => {
  if (isAdmin) {
    return 'Admin access';
  }

  if (portalRole === 'partner') {
    return 'Partner access';
  }

  if (portalRole === 'operator') {
    return 'Training access';
  }

  if (hasPaidMembership || accessTier === 'plus') {
    return 'Plus active';
  }

  return 'Baseline access';
};

export const getPortalRequirementLabel = (tier: PortalAccessTier) => {
  switch (tier) {
    case 'training':
      return 'Training';
    case 'plus':
      return 'Plus';
    default:
      return 'Baseline';
  }
};
