export type MembershipStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'inactive'
  | 'none';

export type PortalAccessTier = 'baseline' | 'training' | 'plus';

// Keep membership checks aligned with subscriptions table policy logic.
export const hasPlusAccess = (status: MembershipStatus | undefined): boolean =>
  status === 'active' || status === 'trialing';

export const normalizePortalAccessTier = (
  tier: string | undefined,
  fallback: PortalAccessTier = 'baseline'
): PortalAccessTier => {
  switch (tier) {
    case 'baseline':
    case 'training':
    case 'plus':
      return tier;
    default:
      return fallback;
  }
};

export const hasTrainingAccess = (tier: PortalAccessTier | undefined): boolean =>
  tier === 'training' || tier === 'plus';

export const hasCustomerPortalAccess = (tier: PortalAccessTier | undefined): boolean =>
  tier === 'baseline' || tier === 'plus';
