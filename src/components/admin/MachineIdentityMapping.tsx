import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { NayaxMachinePicker } from '@/components/admin/NayaxMachinePicker';
import { MachineHelp } from '@/components/admin/MachineHelp';
import { Label } from '@/components/ui/label';
import { fetchRefundNayaxInventory } from '@/lib/refundOperations';
import { fetchMachineWorkspaceMetadata, machineWorkspaceQueryKey, saveMachineWorkspaceMapping, type MachineWorkspaceMetadata } from '@/lib/machineWorkspace';
import { importFreshnessLabel, transactionAgeLabel, transactionSourceLabel } from '@/lib/machineTransactionRecency';

const dateLabel = (value: string | null) => value ? new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleString() : 'Unknown';

export function MachineIdentitySummary({ metadata }: { metadata?: MachineWorkspaceMetadata }) {
  if (!metadata) return <p className="text-xs text-muted-foreground">Source and mapping data unavailable</p>;
  return <div className="mt-2 space-y-1 break-words text-xs">
    <p>{metadata.sources.length ? metadata.sources.map((source) => `${source.platform}: ${source.name || 'Unnamed'} · ${source.id}`).join(' / ') : 'Source not connected'}</p>
    <p className="text-muted-foreground">↔ Nayax {metadata.nayaxMachineId ? `${metadata.nayaxName || 'Unnamed'} · ${metadata.nayaxMachineId} · ${metadata.nayaxAccountKey || 'TGPACI_USA_DB (legacy)'}` : 'Not matched'}</p>
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
  const current = inventory.find((item) => item.nayaxMachineId === metadata?.nayaxMachineId && item.accountKey === (metadata?.nayaxAccountKey || 'TGPACI_USA_DB'));
  const selected = inventory.find((item) => item.id === inventoryId);
  const dirty = Boolean(draftMetadata) && (Boolean(inventoryId && (!selected || selected.nayaxMachineId !== draftMetadata?.nayaxMachineId || selected.accountKey !== (draftMetadata?.nayaxAccountKey || 'TGPACI_USA_DB'))));
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
  return <section className="my-6 space-y-4 border-y border-border py-5" aria-label="Source identity and Nayax matching">
    <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Source ↔ Nayax match</h2><MachineHelp label="About machine matching">Imported names and IDs identify provider records. An exact Nayax match is separate from refund readiness. Use the inventory workflow for advanced reader history.</MachineHelp></div>
    {demo ? <p className="text-sm text-muted-foreground">Source mapping is unavailable in visual demo mode.</p> : metadataQuery.isError ? <div role="alert">Unable to load source identities. <Button variant="link" onClick={() => void metadataQuery.refetch()}>Retry</Button></div> : !metadata ? <p role="status" className="text-sm text-muted-foreground">{metadataQuery.isPending ? 'Loading machine identities…' : 'No identity metadata available. Refresh before editing.'}</p> : <>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0 space-y-3 rounded-md border border-border p-4"><h3 className="text-sm font-semibold">Original source</h3>
          {!metadata.sources.length && <p className="text-sm text-muted-foreground">No source connection recorded. Provisional and Nayax-only machines remain available.</p>}
          {metadata.sources.map((source) => <div key={`${source.platform}:${source.account}:${source.id}`} className="break-words text-sm"><p className="font-medium">{source.platform} · {source.name || 'Unnamed source machine'}</p><p className="text-xs text-muted-foreground">Machine ID {source.id}{source.account ? ` · Account ${source.account}` : ''}</p><p className="mt-2 text-xs">{source.platform === 'Kexiaozhan' ? 'Latest positive source observation' : 'Last source transaction'}: {source.lastTransaction ? `${dateLabel(source.lastTransaction)} · ${transactionAgeLabel(source.lastTransaction)}` : 'Not recorded'}</p><p className="mt-1 text-xs text-muted-foreground">Source last seen: {dateLabel(source.lastSeenAt)}<br/>Latest source import: {dateLabel(source.lastSuccessfulImport)} · {importFreshnessLabel(source.lastSuccessfulImport)}</p></div>)}
        </div>
        <div className="min-w-0 space-y-3 rounded-md border border-border p-4"><h3 className="text-sm font-semibold">Nayax · {metadata.nayaxMachineId ? 'Matched' : 'Not matched'}</h3><p className="break-words text-sm">{metadata.nayaxName || current?.machineName || (metadata.nayaxMachineId ? 'Saved Nayax record' : 'Choose an imported record')}<br/><span className="text-xs text-muted-foreground">{metadata.nayaxMachineId ? `ID ${metadata.nayaxMachineId} · Account ${metadata.nayaxAccountKey || 'TGPACI_USA_DB (legacy)'}` : 'No exact match saved'}</span></p>
          <p className="text-xs text-muted-foreground">Last Nayax transaction: {metadata.nayaxLastTransaction ? `${dateLabel(metadata.nayaxLastTransaction)} · ${transactionAgeLabel(metadata.nayaxLastTransaction)}` : 'Not recorded'}</p>{canEdit && <NayaxMachinePicker records={inventory} machineId={machineId} selectedId={inventoryId} currentName={metadata.nayaxMachineId ? `${metadata.nayaxName || current?.machineName || 'Saved Nayax record'} · ID ${metadata.nayaxMachineId} · ${metadata.nayaxAccountKey || 'TGPACI_USA_DB'}` : ''} disabled={saving || inventoryQuery.isPending || inventoryQuery.isError} onSelect={(id) => { setInventoryId(id); onDirtyChange?.(true); }} />}{inventoryQuery.isError && <p role="alert" className="text-sm text-destructive">Unable to load imported Nayax records. Refresh to retry.</p>}</div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2"><div className="text-sm"><p className="font-medium">Last recorded transaction</p><p className="mt-1">{metadata.lastRecordedTransaction ? `${dateLabel(metadata.lastRecordedTransaction)} · ${transactionAgeLabel(metadata.lastRecordedTransaction)}` : 'No transactions recorded'}</p><p className="mt-1 text-xs text-muted-foreground">Source: {transactionSourceLabel(metadata.transactionSource)} · {importFreshnessLabel(metadata.lastSuccessfulSalesImport)}<br/>Latest successful sales import: {dateLabel(metadata.lastSuccessfulSalesImport)}</p></div></div>
      <MachineHelp label="About transaction freshness">Import times show available source/account data and do not prove complete machine coverage. Missing or old transactions require review; they do not establish inactivity.</MachineHelp>
      {canEdit && <div className="flex justify-end"><Button onClick={() => void save()} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save Nayax match'}</Button></div>}
    </>}
  </section>;
}
