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
  catalogueInactiveAt?: string | null;
  machineUpdatedAt?: string | null;
  companyId?: string | null;
  companyName?: string | null;
};

export async function setMachineSourceCatalogueInactive(source: MachineSourceInventoryItem, inactive: boolean): Promise<void> {
  const { error } = await supabaseClient.rpc('admin_set_machine_source_catalogue_inactive', {
    p_platform: source.platform, p_provider_account_id: source.providerAccountId,
    p_source_id: source.sourceId, p_inactive: inactive,
    p_expected_inactive_at: source.catalogueInactiveAt ?? null,
    p_reason: inactive ? 'Machine source marked inactive from Machines' : 'Machine source restored from Inactive',
  });
  if (error) throw new Error(error.message);
}

export async function setMachineSourceState(source: MachineSourceInventoryItem, state: 'setup' | 'live' | 'inactive', expectedMachineUpdatedAt: string | null): Promise<void> {
  const { error } = await supabaseClient.rpc('admin_set_machine_source_state', {
    p_platform: source.platform, p_provider_account_id: source.providerAccountId,
    p_source_id: source.sourceId, p_state: state,
    p_expected_inactive_at: source.catalogueInactiveAt ?? null,
    p_expected_machine_updated_at: expectedMachineUpdatedAt,
    p_reason: 'Machine State saved from Manage',
  });
  if (error) throw new Error(error.message);
}

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
  readerChange?: { expectedOwnerUpdatedAt: string; changedOn: string; changedAt: string };
}): Promise<string> => {
  const { data, error } = await supabaseClient.rpc(input.readerChange ? 'admin_setup_imported_machine_with_reader_change' : 'admin_setup_imported_machine', {
    p_platform: source.platform, p_provider_account_id: source.providerAccountId,
    p_source_id: source.sourceId, p_account_id: input.accountId,
    p_machine_name: input.machineName, p_machine_type: input.machineType,
    p_operational_phase: input.operationalPhase, p_timezone: input.timezone,
    p_inventory_id: input.inventoryId || null, p_manager_emails: input.managerEmails,
    p_reason: 'Imported machine setup saved from Machines',
    ...(input.readerChange ? { p_expected_owner_updated_at: input.readerChange.expectedOwnerUpdatedAt, p_changed_on: input.readerChange.changedOn, p_changed_at: input.readerChange.changedAt } : {}),
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

export type ImportedReaderChangePreview = {
  inventoryId: string; newReaderId: string; newAccountKey: string;
  ownerMachineId: string | null; ownerMachineName: string | null;
  expectedOwnerUpdatedAt: string | null; ownerArchived: boolean;
  historicalOwnerConflict: boolean; timezone: string; effectiveInstants: string[];
};
export async function previewImportedReaderChange(inventoryId: string, timezone: string, changedAtLocal: string | null): Promise<ImportedReaderChangePreview> {
  const { data, error } = await supabaseClient.rpc('admin_preview_imported_machine_reader_change', {
    p_inventory_id: inventoryId, p_timezone: timezone, p_changed_at_local: changedAtLocal,
  });
  if (error) throw new Error(error.message);
  return data;
}
