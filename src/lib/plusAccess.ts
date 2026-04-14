import { supabaseClient } from '@/lib/supabaseClient';
import {
  emptyPlusAccessSummary,
  normalizeMembershipStatus,
  normalizePlusAccessSource,
  type PlusAccessSummary,
} from '@/lib/membership';

type PlusAccessRpcRecord = {
  has_plus_access: boolean | null;
  source: string | null;
  membership_status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  paid_subscription_active: boolean | null;
  free_grant_id: string | null;
  free_grant_starts_at: string | null;
  free_grant_expires_at: string | null;
  free_grant_active: boolean | null;
};

const mapPlusAccessRecord = (record: PlusAccessRpcRecord | null): PlusAccessSummary => {
  if (!record) {
    return emptyPlusAccessSummary;
  }

  return {
    hasPlusAccess: Boolean(record.has_plus_access),
    source: normalizePlusAccessSource(record.source ?? undefined),
    membershipStatus: normalizeMembershipStatus(record.membership_status ?? undefined),
    currentPeriodEnd: record.current_period_end,
    cancelAtPeriodEnd: Boolean(record.cancel_at_period_end),
    paidSubscriptionActive: Boolean(record.paid_subscription_active),
    freeGrantId: record.free_grant_id,
    freeGrantStartsAt: record.free_grant_starts_at,
    freeGrantExpiresAt: record.free_grant_expires_at,
    freeGrantActive: Boolean(record.free_grant_active),
  };
};

export const fetchMyPlusAccess = async (): Promise<PlusAccessSummary> => {
  const { data, error } = await supabaseClient.rpc('get_my_plus_access');

  if (error) {
    throw new Error(error.message || 'Unable to load Plus access.');
  }

  const record = Array.isArray(data)
    ? ((data as PlusAccessRpcRecord[])[0] ?? null)
    : ((data as PlusAccessRpcRecord | null) ?? null);

  return mapPlusAccessRecord(record);
};
