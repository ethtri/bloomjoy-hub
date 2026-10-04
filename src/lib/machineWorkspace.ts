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
  transactionSource: string | null; transactionImportedAt: string | null;
  lastSuccessfulSalesImport: string | null; sources: MachineSourceIdentity[];
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
