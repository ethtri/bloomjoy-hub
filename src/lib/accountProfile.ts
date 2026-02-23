import { supabaseClient } from '@/lib/supabaseClient';
import type { MembershipStatus } from '@/lib/membership';

export type CustomerProfileRecord = {
  user_id: string;
  full_name: string | null;
  company_name: string | null;
  phone: string | null;
  shipping_street_1: string | null;
  shipping_street_2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
  shipping_country: string | null;
  created_at: string;
  updated_at: string;
};

export type PortalAccountProfileInput = {
  fullName: string;
  companyName: string;
  phone: string;
  shippingStreet1: string;
  shippingStreet2: string;
  shippingCity: string;
  shippingState: string;
  shippingPostalCode: string;
  shippingCountry: string;
};

export type PortalMembershipSummary = {
  status: MembershipStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

type SubscriptionRecord = {
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  updated_at: string;
};

const normalizeMembershipStatus = (status: string | undefined): MembershipStatus => {
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

const resolveMembershipRecord = (records: SubscriptionRecord[]): SubscriptionRecord | null => {
  if (!records.length) {
    return null;
  }

  const now = Date.now();
  const active = records.find((record) => {
    const normalizedStatus = normalizeMembershipStatus(record.status);
    const periodEnd =
      record.current_period_end !== null ? new Date(record.current_period_end).getTime() : null;

    return (
      (normalizedStatus === 'active' || normalizedStatus === 'trialing') &&
      (periodEnd === null || periodEnd > now)
    );
  });

  return active ?? records[0];
};

export const fetchPortalAccountProfile = async (
  userId: string
): Promise<CustomerProfileRecord | null> => {
  const { data, error } = await supabaseClient
    .from('customer_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Unable to load account profile.');
  }

  return (data as CustomerProfileRecord | null) ?? null;
};

export const upsertPortalAccountProfile = async (
  userId: string,
  profile: PortalAccountProfileInput
): Promise<CustomerProfileRecord> => {
  const { data, error } = await supabaseClient
    .from('customer_profiles')
    .upsert(
      {
        user_id: userId,
        full_name: profile.fullName.trim() || null,
        company_name: profile.companyName.trim() || null,
        phone: profile.phone.trim() || null,
        shipping_street_1: profile.shippingStreet1.trim() || null,
        shipping_street_2: profile.shippingStreet2.trim() || null,
        shipping_city: profile.shippingCity.trim() || null,
        shipping_state: profile.shippingState.trim() || null,
        shipping_postal_code: profile.shippingPostalCode.trim() || null,
        shipping_country: profile.shippingCountry.trim() || null,
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save account profile.');
  }

  return data as CustomerProfileRecord;
};

export const fetchPortalMembershipSummary = async (
  userId: string
): Promise<PortalMembershipSummary> => {
  const { data, error } = await supabaseClient
    .from('subscriptions')
    .select('status,current_period_end,cancel_at_period_end,updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(error.message || 'Unable to load membership details.');
  }

  const records = (data as SubscriptionRecord[] | null) ?? [];
  const selected = resolveMembershipRecord(records);

  if (!selected) {
    return {
      status: 'none',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
  }

  return {
    status: normalizeMembershipStatus(selected.status),
    currentPeriodEnd: selected.current_period_end,
    cancelAtPeriodEnd: selected.cancel_at_period_end,
  };
};
