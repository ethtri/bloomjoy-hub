import { supabaseClient } from '@/lib/supabaseClient';
import type { PlusAccessSummary } from '@/lib/membership';
import { fetchMyPlusAccess } from '@/lib/plusAccess';

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

export type PortalMembershipSummary = PlusAccessSummary;

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
  _userId: string
): Promise<PortalMembershipSummary> => {
  return fetchMyPlusAccess();
};
