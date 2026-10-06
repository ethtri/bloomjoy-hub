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

export const fetchMachineSourceInventory = async (): Promise<MachineSourceInventoryItem[]> => {
  if (!supabaseClient) throw new Error('Source inventory is unavailable.');
  const { data, error } = await supabaseClient.rpc('admin_get_machine_source_inventory');
  if (error) throw error;
  if (!data || !Array.isArray(data.sources) || data.count !== data.sources.length) {
    throw new Error('The imported machine inventory is incomplete. Retry loading it.');
  }
  const keys = new Set<string>();
  return data.sources.map((item: MachineSourceInventoryItem) => {
    if (!item?.sourceKey || !item.sourceId || !['Sunze', 'Kexiaozhan'].includes(item.platform) || keys.has(item.sourceKey)) {
      throw new Error('The imported machine inventory could not be verified. Retry loading it.');
    }
    keys.add(item.sourceKey);
    return item;
  });
};
