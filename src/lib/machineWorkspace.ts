import { supabaseClient } from '@/lib/supabaseClient';

export type MachineSourceIdentity = {
  platform: string; name: string | null; id: string; account: string | null;
  lastSeenAt: string | null; lastTransaction: string | null; lastImportAt: string | null;
  lastSuccessfulImport: string | null;
};
export type MachineWorkspaceMetadata = {
  machineId: string; venueLabel: string | null; nayaxMachineId: string | null;
  nayaxAccountKey: string | null; lastRecordedTransaction: string | null;
  nayaxName: string | null;
  nayaxLastTransaction: string | null;
  excludeCashFromFinancialReporting?: boolean;
  transactionSource: string | null; transactionImportedAt: string | null;
  lastSuccessfulSalesImport: string | null; sources: MachineSourceIdentity[];
  salesActivationPending?: boolean;
  machineName?: string;
};
export const machineWorkspaceQueryKey = ['admin-machine-workspace-metadata'];
export async function fetchMachineWorkspaceMetadata(): Promise<MachineWorkspaceMetadata[]> {
  const { data, error } = await supabaseClient.rpc('admin_get_machine_workspace_metadata');
  if (error) throw new Error(error.message);
  return data ?? [];
}
export async function saveMachineWorkspaceMapping(metadata: MachineWorkspaceMetadata, venueLabel: string, inventoryId: string | null) {
  const { error } = await supabaseClient.rpc('admin_save_machine_workspace_mapping', {
    p_machine_id: metadata.machineId, p_venue_label: venueLabel, p_inventory_id: inventoryId,
    p_expected_nayax_machine_id: metadata.nayaxMachineId,
    p_expected_nayax_account_key: metadata.nayaxAccountKey, p_expected_venue_label: metadata.venueLabel,
  });
  if (error) throw new Error(error.message);
}
export async function linkSunzeSourceToMachine(machineId: string, sourceMachineId: string) {
  const { error } = await supabaseClient.rpc('admin_link_sunze_source_to_machine', { p_machine_id: machineId, p_source_machine_id: sourceMachineId });
  if (error) throw new Error(error.message);
}
export async function saveMachineDisplayName(machineId: string, name: string, expectedName: string) {
  const { error } = await supabaseClient.rpc('admin_set_machine_display_name', {
    p_machine_id: machineId, p_display_name: name, p_expected_display_name: expectedName,
  });
  if (error) throw new Error(error.message);
}
export async function saveMachineRefundSettings(machineId: string, intakeEnabled: boolean) {
  const { error } = await supabaseClient.rpc('admin_save_machine_refund_settings', {
    p_machine_id: machineId, p_refund_intake_enabled: intakeEnabled,
    p_reason: 'Transaction matching settings updated from Admin Machines',
  });
  if (error) throw new Error(error.message);
}

export async function saveMachineCashReportingExclusion(machineId: string, excluded: boolean, expectedExcluded: boolean) {
  const { error } = await supabaseClient.rpc('admin_set_machine_cash_reporting_exclusion', {
    p_machine_id: machineId, p_exclude_cash: excluded, p_expected_exclude_cash: expectedExcluded,
  });
  if (error) throw new Error(error.message);
}

export type MachineReaderChangePreview = {
  machineId: string; machineName: string; expectedMachineUpdatedAt: string;
  currentReaderId: string | null; currentAccountKey: string | null;
  inventoryId: string; newReaderId: string; newAccountKey: string;
  ownerMachineId: string | null; ownerMachineName: string | null;
  expectedOwnerUpdatedAt: string | null; ownerArchived: boolean;
  historicalOwnerConflict: boolean; timezone: string; effectiveInstants: string[];
};
export async function previewMachineReaderChange(machineId: string, inventoryId: string, changedAtLocal: string | null): Promise<MachineReaderChangePreview> {
  const { data, error } = await supabaseClient.rpc('admin_preview_machine_reader_change', {
    p_machine_id: machineId, p_inventory_id: inventoryId, p_changed_at_local: changedAtLocal,
  });
  if (error) throw new Error(error.message);
  return data;
}
export async function changeMachineReader(preview: MachineReaderChangePreview, changedOn: string, changedAt: string | null, reason: string) {
  const { data, error } = await supabaseClient.rpc('admin_change_machine_reader', {
    p_machine_id: preview.machineId, p_inventory_id: preview.inventoryId,
    p_expected_machine_updated_at: preview.expectedMachineUpdatedAt,
    p_expected_owner_updated_at: preview.expectedOwnerUpdatedAt,
    p_expected_timezone: preview.timezone, p_changed_on: changedOn,
    p_changed_at: changedAt, p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data;
}
