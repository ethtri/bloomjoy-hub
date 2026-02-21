export type MembershipStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'inactive'
  | 'none';

// Keep membership checks aligned with subscriptions table policy logic.
export const hasPlusAccess = (status: MembershipStatus | undefined): boolean =>
  status === 'active' || status === 'trialing';
