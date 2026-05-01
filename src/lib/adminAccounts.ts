import { supabaseClient } from '@/lib/supabaseClient';
import type { PlusAccessSource } from '@/lib/membership';

export type MachineType = 'commercial' | 'mini' | 'micro';

export type AdminAccountSummary = {
  user_id: string;
  customer_email: string | null;
  membership_status: string | null;
  current_period_end: string | null;
  membership_cancel_at_period_end: boolean;
  paid_subscription_active: boolean;
  plus_access_source: PlusAccessSource;
  has_plus_access: boolean;
  plus_grant_id: string | null;
  plus_grant_starts_at: string | null;
  plus_grant_expires_at: string | null;
  plus_grant_active: boolean;
  total_orders: number;
  last_order_at: string | null;
  open_support_requests: number;
  total_machine_count: number;
  last_machine_update_at: string | null;
};

export type CustomerMachineInventoryRecord = {
  id: string;
  customer_user_id: string;
  machine_type: MachineType;
  quantity: number;
  source: string;
  updated_reason: string;
  last_updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PlusAccessGrantRecord = {
  id: string;
  user_id: string;
  starts_at: string;
  expires_at: string;
  grant_reason: string;
  granted_by: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
  created_at: string;
  updated_at: string;
};

type UpsertMachineInventoryInput = {
  customerUserId: string;
  machineType: MachineType;
  quantity: number;
  updatedReason: string;
};

type GrantPlusAccessInput = {
  customerUserId: string;
  expiresAt: string;
  reason: string;
};

type RevokePlusAccessInput = {
  grantId: string;
  reason: string;
};

const formatRpcError = (
  rpcName: string,
  error: { code?: string; message?: string } | null | undefined
) => {
  const code = error?.code?.trim();
  const message = error?.message?.trim() || 'Unknown Supabase error.';
  return `${rpcName} failed${code ? ` (${code})` : ''}: ${message}`;
};

export const fetchAdminAccountSummaries = async (
  search: string
): Promise<AdminAccountSummary[]> => {
  const { data, error } = await supabaseClient.rpc('admin_get_account_summaries', {
    p_search: search.trim() ? search.trim() : null,
  });

  if (error) {
    throw new Error(formatRpcError('admin_get_account_summaries', error));
  }

  return (data ?? []) as AdminAccountSummary[];
};

export const fetchMachineInventoryForAccount = async (
  customerUserId: string
): Promise<CustomerMachineInventoryRecord[]> => {
  const { data, error } = await supabaseClient
    .from('customer_machine_inventory')
    .select('*')
    .eq('customer_user_id', customerUserId)
    .order('machine_type', { ascending: true });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to load machine inventory.');
  }

  return data as CustomerMachineInventoryRecord[];
};

export const upsertMachineInventoryAdmin = async ({
  customerUserId,
  machineType,
  quantity,
  updatedReason,
}: UpsertMachineInventoryInput): Promise<CustomerMachineInventoryRecord> => {
  const { data, error } = await supabaseClient.rpc('admin_upsert_customer_machine_inventory', {
    p_customer_user_id: customerUserId,
    p_machine_type: machineType,
    p_quantity: quantity,
    p_updated_reason: updatedReason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to update machine inventory.');
  }

  return data as CustomerMachineInventoryRecord;
};

export const grantPlusAccessAdmin = async ({
  customerUserId,
  expiresAt,
  reason,
}: GrantPlusAccessInput): Promise<PlusAccessGrantRecord> => {
  const { data, error } = await supabaseClient.rpc('admin_grant_plus_access', {
    p_customer_user_id: customerUserId,
    p_expires_at: expiresAt,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to grant Plus Customer access.');
  }

  return data as PlusAccessGrantRecord;
};

export const revokePlusAccessAdmin = async ({
  grantId,
  reason,
}: RevokePlusAccessInput): Promise<PlusAccessGrantRecord> => {
  const { data, error } = await supabaseClient.rpc('admin_revoke_plus_access', {
    p_grant_id: grantId,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to revoke Plus Customer access.');
  }

  return data as PlusAccessGrantRecord;
};
