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
  salesActivationPending?: boolean;
};

export type ImportedSourceReuseOption = {
  inventoryId: string; machineId: string; machineName: string; companyId: string;
  companyName: string; timezone: string; expectedMachineUpdatedAt: string;
  eligible: boolean; reason: string | null;
};
export const fetchImportedSourceReuseOptions = async (source: MachineSourceInventoryItem): Promise<ImportedSourceReuseOption[]> => {
  const { data, error } = await supabaseClient.rpc('admin_get_imported_source_reuse_options', {
    p_platform: source.platform, p_provider_account_id: source.providerAccountId, p_source_id: source.sourceId,
  });
  if (error || !Array.isArray(data)) throw new Error(error?.message || 'Unable to review existing reader connections.');
  return data;
};
export const reuseImportedSourceMachine = async (source: MachineSourceInventoryItem, option: ImportedSourceReuseOption): Promise<string> => {
  const { data, error } = await supabaseClient.rpc('admin_reuse_imported_source_machine', {
    p_platform: source.platform, p_provider_account_id: source.providerAccountId, p_source_id: source.sourceId,
    p_inventory_id: option.inventoryId, p_expected_machine_id: option.machineId,
    p_expected_updated_at: option.expectedMachineUpdatedAt,
    p_expected_timezone: option.timezone,
    p_reason: 'Reviewed same physical machine throughout: connect source to the existing reader machine and preserve financial history',
  });
  if (error || !data?.machineId) throw new Error(error?.message || 'Unable to use this existing machine.');
  return data.machineId;
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

export const fetchMachineSourceInventorySnapshot = async (): Promise<{
  sources: MachineSourceInventoryItem[];
  importHealth: { observedAt: string | null; verified: boolean; issue: string | null } | null;
}> => {
  if (!supabaseClient) throw new Error('Source inventory is unavailable.');
  const { data, error } = await supabaseClient.rpc('admin_get_machine_source_inventory');
  if (error) throw error;
  if (!data || !Array.isArray(data.sources) || data.count !== data.sources.length) {
    throw new Error('The imported machine inventory is incomplete. Retry loading it.');
  }
  const keys = new Set<string>();
  const identities = new Set<string>();
  const sources = data.sources.map((item: MachineSourceInventoryItem) => {
    const identity = JSON.stringify([item?.platform, item?.providerAccountId ?? null, item?.sourceId]);
    if (!item?.sourceKey || !item.sourceId || !['Sunze', 'Kexiaozhan'].includes(item.platform) || keys.has(item.sourceKey) || identities.has(identity) || (item.platform === 'Kexiaozhan' && !item.providerAccountId)) {
      throw new Error('The imported machine inventory could not be verified. Retry loading it.');
    }
    keys.add(item.sourceKey);
    identities.add(identity);
    return item;
  });
  return { sources, importHealth: data.importHealth ? {
    observedAt: typeof data.importHealth.observedAt === 'string' ? data.importHealth.observedAt : null,
    verified: data.importHealth.verified === true,
    issue: typeof data.importHealth.issue === 'string' ? data.importHealth.issue : null,
  } : null };
};

export const fetchMachineSourceInventory = async (): Promise<MachineSourceInventoryItem[]> =>
  (await fetchMachineSourceInventorySnapshot()).sources;
