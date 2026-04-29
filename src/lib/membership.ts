export type MembershipStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'inactive'
  | 'none';

export type PortalAccessTier = 'baseline' | 'training' | 'plus' | 'corporate_partner';

export type PlusAccessSource = 'paid_subscription' | 'free_grant' | 'admin' | 'none';

export type PlusAccessSummary = {
  hasPlusAccess: boolean;
  source: PlusAccessSource;
  membershipStatus: MembershipStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  paidSubscriptionActive: boolean;
  freeGrantId: string | null;
  freeGrantStartsAt: string | null;
  freeGrantExpiresAt: string | null;
  freeGrantActive: boolean;
};

// Keep membership checks aligned with subscriptions table policy logic.
export const hasPlusAccess = (status: MembershipStatus | undefined): boolean =>
  status === 'active' || status === 'trialing';

export const normalizeMembershipStatus = (status: string | undefined): MembershipStatus => {
  if (!status) return 'none';

  switch (status) {
    case 'active':
    case 'trialing':
    case 'past_due':
    case 'canceled':
    case 'inactive':
    case 'none':
      return status;
    default:
      return 'none';
  }
};

export const normalizePlusAccessSource = (source: string | undefined): PlusAccessSource => {
  switch (source) {
    case 'paid_subscription':
    case 'free_grant':
    case 'admin':
    case 'none':
      return source;
    default:
      return 'none';
  }
};

export const normalizePortalAccessTier = (
  tier: string | undefined,
  fallback: PortalAccessTier = 'baseline'
): PortalAccessTier => {
  switch (tier) {
    case 'baseline':
    case 'training':
    case 'plus':
    case 'corporate_partner':
      return tier;
    default:
      return fallback;
  }
};

export const hasTrainingAccess = (tier: PortalAccessTier | undefined): boolean =>
  tier === 'training' || tier === 'plus' || tier === 'corporate_partner';

export const hasCustomerPortalAccess = (tier: PortalAccessTier | undefined): boolean =>
  tier === 'baseline' || tier === 'plus' || tier === 'corporate_partner';

export const emptyPlusAccessSummary: PlusAccessSummary = {
  hasPlusAccess: false,
  source: 'none',
  membershipStatus: 'none',
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  paidSubscriptionActive: false,
  freeGrantId: null,
  freeGrantStartsAt: null,
  freeGrantExpiresAt: null,
  freeGrantActive: false,
};
