import { supabaseClient } from '@/lib/supabaseClient';

export type MachineType = 'commercial' | 'mini' | 'micro';

export type AdminAccountSummary = {
  user_id: string;
  customer_email: string | null;
  membership_status: string | null;
  current_period_end: string | null;
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

type UpsertMachineInventoryInput = {
  customerUserId: string;
  machineType: MachineType;
  quantity: number;
  updatedReason: string;
};

export const fetchAdminAccountSummaries = async (
  search: string
): Promise<AdminAccountSummary[]> => {
  const { data, error } = await supabaseClient.rpc('admin_get_account_summaries', {
    p_search: search.trim() ? search.trim() : null,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to load account summaries.');
  }

  return data as AdminAccountSummary[];
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
