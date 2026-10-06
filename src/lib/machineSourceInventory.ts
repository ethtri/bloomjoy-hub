import { supabaseClient } from '@/lib/supabaseClient';

export type MachineSourceInventoryItem = {
  sourceKey: string;
  platform: 'Sunze' | 'Kexiaozhan';
  providerAccountId: string | null;
  sourceAccountKey: string | null;
  sourceId: string;
  sourceName: string | null;
  sourceStatus: string | null;
  discoveryStatus: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  sourceTimezone: string | null;
  lastSourceTransaction: string | null;
  reportingMachineId: string | null;
  machineName?: string | null;
  nayaxMachineId?: string | null;
  nayaxAccountKey?: string | null;
  nayaxName?: string | null;
  mappingConflict: boolean;
  archivedMapping: boolean;
};

export const machineSourceInventoryQueryKey = ['admin-machine-source-inventory'];

export const setupImportedMachine = async (source: MachineSourceInventoryItem, input: {
  accountId: string; machineName: string; machineType: string; operationalPhase: string;
  timezone: string; inventoryId: string; managerEmails: string[];
}): Promise<string> => {
  const { data, error } = await supabaseClient.rpc('admin_setup_imported_machine', {
    p_platform: source.platform, p_provider_account_id: source.providerAccountId,
    p_source_id: source.sourceId, p_account_id: input.accountId,
    p_machine_name: input.machineName, p_machine_type: input.machineType,
    p_operational_phase: input.operationalPhase, p_timezone: input.timezone,
    p_inventory_id: input.inventoryId || null, p_manager_emails: input.managerEmails,
    p_reason: 'Imported machine setup saved from Machines',
  });
  if (error || !data?.machineId) throw new Error(error?.message || 'Unable to set up this imported machine.');
  return data.machineId;
};

export const fetchMachineSourceInventory = async (): Promise<MachineSourceInventoryItem[]> => {
  if (!supabaseClient) throw new Error('Source inventory is unavailable.');
  const { data, error } = await supabaseClient.rpc('admin_get_machine_source_inventory');
  if (error) throw error;
  if (!data || !Array.isArray(data.sources) || data.count !== data.sources.length) {
    throw new Error('The imported machine inventory is incomplete. Retry loading it.');
  }
  const keys = new Set<string>();
  const identities = new Set<string>();
  return data.sources.map((item: MachineSourceInventoryItem) => {
    const identity = JSON.stringify([item?.platform, item?.providerAccountId ?? null, item?.sourceId]);
    if (!item?.sourceKey || !item.sourceId || !['Sunze', 'Kexiaozhan'].includes(item.platform) || keys.has(item.sourceKey) || identities.has(identity) || (item.platform === 'Kexiaozhan' && !item.providerAccountId)) {
      throw new Error('The imported machine inventory could not be verified. Retry loading it.');
    }
    keys.add(item.sourceKey);
    identities.add(identity);
    return item;
  });
};
