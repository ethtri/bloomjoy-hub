import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { NayaxMachinePicker } from '@/components/admin/NayaxMachinePicker';
import { MachineHelp } from '@/components/admin/MachineHelp';
import { fetchRefundNayaxInventory } from '@/lib/refundOperations';
import { fetchMachineWorkspaceMetadata, machineWorkspaceQueryKey, saveMachineWorkspaceMapping, type MachineWorkspaceMetadata } from '@/lib/machineWorkspace';
import { importFreshnessLabel, transactionAgeLabel, transactionSourceLabel } from '@/lib/machineTransactionRecency';

const dateLabel = (value: string | null) => value ? new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleString() : 'Unknown';
export function MachineIdentitySummary({ metadata }: { metadata?: MachineWorkspaceMetadata }) {
  if (!metadata) return <p className="text-xs text-muted-foreground">Source data unavailable</p>;
  return <div className="mt-2 space-y-1 break-words text-xs">
    <p>{metadata.sources.length ? metadata.sources.map((source) => `${source.platform}: ${source.name || 'Unnamed'} · ID ${source.id}`).join(' / ') : 'Source not connected'}</p>
    <p className="text-muted-foreground">Nayax {metadata.nayaxMachineId ? `${metadata.nayaxName || 'Unnamed'} · ID ${metadata.nayaxMachineId} · ${metadata.nayaxAccountKey || 'TGPACI_USA_DB'}` : 'Not matched'}</p>
  </div>;
}

export function MachineIdentityMapping({ machineId, canEdit, demo = false, onSaved, onDirtyChange }: {
  machineId: string; canEdit: boolean; demo?: boolean; onSaved: () => Promise<unknown>; onDirtyChange?: (dirty: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const metadataQuery = useQuery({ queryKey: machineWorkspaceQueryKey, queryFn: fetchMachineWorkspaceMetadata, enabled: !demo, staleTime: 30000 });
  const inventoryQuery = useQuery({ queryKey: ['admin-refund-nayax-inventory'], queryFn: fetchRefundNayaxInventory, enabled: !demo && canEdit, staleTime: 30000 });
  const metadata = metadataQuery.data?.find((item) => item.machineId === machineId);
  const [inventoryId, setInventoryId] = useState('');
  const [saving, setSaving] = useState(false);
  const [draftMetadata, setDraftMetadata] = useState<MachineWorkspaceMetadata | undefined>();
  const inventory = inventoryQuery.data?.machines ?? [];
  const selected = inventory.find((item) => item.id === inventoryId);
  const dirty = Boolean(draftMetadata && inventoryId && (!selected || selected.nayaxMachineId !== draftMetadata.nayaxMachineId || selected.accountKey !== (draftMetadata.nayaxAccountKey || 'TGPACI_USA_DB')));
  useEffect(() => { if (metadata && (!draftMetadata || draftMetadata.machineId !== machineId || !dirty)) { setDraftMetadata(metadata); setInventoryId(''); } }, [machineId, metadata, draftMetadata, dirty]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  async function save() {
    if (!draftMetadata || saving) return;
    setSaving(true);
    try {
      await saveMachineWorkspaceMapping(draftMetadata, draftMetadata.venueLabel ?? '', inventoryId || null);
      setDraftMetadata(undefined);
      await Promise.all([queryClient.invalidateQueries({ queryKey: machineWorkspaceQueryKey }), onSaved()]);
      setInventoryId(''); toast.success('Exact Nayax match saved.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to save machine mapping.'); }
    finally { setSaving(false); }
  }
  return <section className="space-y-3" aria-label="Source identity and Nayax matching">
    {demo ? <p className="text-sm text-muted-foreground">Source mapping unavailable in demo.</p> : metadataQuery.isError ? <div role="alert">Unable to load source identities. <Button variant="link" onClick={() => void metadataQuery.refetch()}>Retry</Button></div> : !metadata ? <p role="status" className="text-sm text-muted-foreground">{metadataQuery.isPending ? 'Loading identities…' : 'Source data unavailable. Refresh to retry.'}</p> : <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 break-words text-sm">
          {metadata.sources.length ? metadata.sources.map((source) => <p key={`${source.platform}:${source.account}:${source.id}`}><span className="font-medium">{source.platform}</span>: {source.name || 'Unnamed'}<span className="block text-muted-foreground">ID {source.id}</span></p>) : <p className="text-muted-foreground">Source not connected</p>}
        </div>
        <MachineHelp label="Source and import details">
          <p>Original provider names and IDs are read-only. An exact match does not activate refunds.</p>
          {metadata.sources.map((source) => <div key={`${source.platform}:${source.account}:${source.id}`} className="mt-3 break-words"><p className="font-medium">{source.platform}{source.account ? ` · ${source.account}` : ''}</p><p>Last source transaction: {dateLabel(source.lastTransaction)}</p><p>Last seen: {dateLabel(source.lastSeenAt)}</p><p>Import: {dateLabel(source.lastSuccessfulImport)} · {importFreshnessLabel(source.lastSuccessfulImport)}</p></div>)}
          <p className="mt-3">Import freshness does not prove complete coverage or genuine inactivity.</p>
        </MachineHelp>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Nayax match</p>
        {canEdit ? <NayaxMachinePicker records={inventory} machineId={machineId} selectedId={inventoryId} currentName={metadata.nayaxMachineId ? `${metadata.nayaxName || 'Saved Nayax record'} · ID ${metadata.nayaxMachineId} · ${metadata.nayaxAccountKey || 'TGPACI_USA_DB'}` : ''} disabled={saving || inventoryQuery.isPending || inventoryQuery.isError} onSelect={(id) => { setInventoryId(id); onDirtyChange?.(true); }} /> : <p className="break-words text-sm">{metadata.nayaxMachineId ? `${metadata.nayaxName || 'Saved Nayax record'} · ID ${metadata.nayaxMachineId} · ${metadata.nayaxAccountKey || 'TGPACI_USA_DB'}` : 'Not matched'}</p>}
        {inventoryQuery.isError && <p role="alert" className="text-sm text-destructive">Imported Nayax records unavailable. Refresh to retry.</p>}
      </div>
      <p className="text-xs text-muted-foreground">Last recorded transaction: {metadata.lastRecordedTransaction ? `${dateLabel(metadata.lastRecordedTransaction)} · ${transactionAgeLabel(metadata.lastRecordedTransaction)}` : 'None recorded'} · {transactionSourceLabel(metadata.transactionSource)} · {importFreshnessLabel(metadata.lastSuccessfulSalesImport)}</p>
      {dirty && canEdit && <div className="flex justify-end"><Button type="button" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save Nayax match'}</Button></div>}
    </>}
  </section>;
}
