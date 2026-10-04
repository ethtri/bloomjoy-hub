import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchRefundNayaxInventory } from '@/lib/refundOperations';
import { fetchMachineWorkspaceMetadata, machineWorkspaceQueryKey, saveMachineWorkspaceMapping, type MachineWorkspaceMetadata } from '@/lib/machineWorkspace';
import { importFreshnessLabel, transactionAgeLabel } from '@/lib/machineTransactionRecency';

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
  const [venue, setVenue] = useState('');
  const [inventoryId, setInventoryId] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [draftMetadata, setDraftMetadata] = useState<MachineWorkspaceMetadata | undefined>();
  const inventory = inventoryQuery.data?.machines ?? [];
  const current = inventory.find((item) => item.nayaxMachineId === metadata?.nayaxMachineId && item.accountKey === (metadata?.nayaxAccountKey || 'TGPACI_USA_DB'));
  const matches = inventory.filter((item) => item.id === inventoryId || [item.machineName, item.nayaxMachineId, item.accountKey].join(' ').toLowerCase().includes(search.toLowerCase()));
  const selected = inventory.find((item) => item.id === inventoryId);
  const dirty = Boolean(draftMetadata) && (venue.trim() !== (draftMetadata?.venueLabel ?? '') || Boolean(inventoryId && (!selected || selected.nayaxMachineId !== draftMetadata?.nayaxMachineId || selected.accountKey !== (draftMetadata?.nayaxAccountKey || 'TGPACI_USA_DB'))));
  useEffect(() => { if (metadata && (!draftMetadata || draftMetadata.machineId !== machineId || !dirty)) { setDraftMetadata(metadata); setVenue(metadata.venueLabel ?? ''); setInventoryId(''); setSearch(''); } }, [machineId, metadata, draftMetadata, dirty]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  async function save() {
    if (!draftMetadata || saving) return;
    setSaving(true);
    try {
      await saveMachineWorkspaceMapping(draftMetadata, venue, inventoryId || null);
      setDraftMetadata(undefined);
      await Promise.all([queryClient.invalidateQueries({ queryKey: machineWorkspaceQueryKey }), onSaved()]);
      setInventoryId(''); toast.success('Venue and exact Nayax match saved.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to save machine mapping.'); }
    finally { setSaving(false); }
  }
  return <section className="my-6 space-y-4 border-y border-border py-5" aria-label="Source identity and Nayax matching">
    <div><h2 className="text-lg font-semibold">Source ↔ Nayax match</h2><p className="mt-1 text-sm text-muted-foreground">Connect the imported identities for this physical machine. Mapping status is independent of refund readiness.</p></div>
    {demo ? <p className="text-sm text-muted-foreground">Source mapping is unavailable in visual demo mode.</p> : metadataQuery.isError ? <div role="alert">Unable to load source identities. <Button variant="link" onClick={() => void metadataQuery.refetch()}>Retry</Button></div> : !metadata ? <p role="status" className="text-sm text-muted-foreground">{metadataQuery.isPending ? 'Loading machine identities…' : 'No identity metadata available. Refresh before editing.'}</p> : <>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0 space-y-3 rounded-md border border-border p-4"><h3 className="text-sm font-semibold">Original source</h3>
          {!metadata.sources.length && <p className="text-sm text-muted-foreground">No source connection recorded. Provisional and Nayax-only machines remain available.</p>}
          {metadata.sources.map((source) => <div key={`${source.platform}:${source.account}:${source.id}`} className="break-words text-sm"><p className="font-medium">{source.platform} · {source.name || 'Unnamed source machine'}</p><p className="text-xs text-muted-foreground">Machine ID {source.id}{source.account ? ` · Account ${source.account}` : ''}</p><p className="mt-2 text-xs">{source.platform === 'Kexiaozhan' ? 'Latest positive source observation' : 'Last source transaction'}: {source.lastTransaction ? `${dateLabel(source.lastTransaction)} · ${transactionAgeLabel(source.lastTransaction)}` : 'Not recorded'}</p><p className="mt-1 text-xs text-muted-foreground">Source last seen: {dateLabel(source.lastSeenAt)}<br/>Latest source import: {dateLabel(source.lastSuccessfulImport)} · {importFreshnessLabel(source.lastSuccessfulImport)}</p></div>)}
        </div>
        <div className="min-w-0 space-y-3 rounded-md border border-border p-4"><h3 className="text-sm font-semibold">Nayax · {metadata.nayaxMachineId ? 'Matched' : 'Not matched'}</h3><p className="break-words text-sm">{metadata.nayaxName || current?.machineName || (metadata.nayaxMachineId ? 'Saved Nayax record' : 'Choose an imported record')}<br/><span className="text-xs text-muted-foreground">{metadata.nayaxMachineId ? `ID ${metadata.nayaxMachineId} · Account ${metadata.nayaxAccountKey || 'TGPACI_USA_DB (legacy)'}` : 'No exact match saved'}</span></p>
          <p className="text-xs text-muted-foreground">Last Nayax transaction: {metadata.nayaxLastTransaction ? `${dateLabel(metadata.nayaxLastTransaction)} · ${transactionAgeLabel(metadata.nayaxLastTransaction)}` : 'Not recorded'}</p>{canEdit && <><Label htmlFor={`nayax-search-${machineId}`}>Find Nayax record</Label><Input id={`nayax-search-${machineId}`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, machine ID or account" disabled={saving || inventoryQuery.isError}/><Label htmlFor={`nayax-match-${machineId}`}>Imported Nayax match</Label><select id={`nayax-match-${machineId}`} className="min-h-11 w-full rounded-md border border-input bg-background px-2 text-sm" value={inventoryId} onChange={(event) => { setInventoryId(event.target.value); onDirtyChange?.(true); }} disabled={saving || inventoryQuery.isPending || inventoryQuery.isError}><option value="">Keep current match</option>{matches.map((item) => <option key={item.id} value={item.id} disabled={Boolean(item.reportingMachineId && item.reportingMachineId !== machineId)}>{item.machineName || 'Unnamed'} · ID {item.nayaxMachineId} · {item.accountKey}{item.reportingMachineId && item.reportingMachineId !== machineId ? ' · Already linked' : ''}{!item.providerActive ? ' · Inactive' : ''}{item.state === 'excluded' ? ' · Ignored' : ''}{metadataQuery.data?.find((entry) => entry.machineId === item.reportingMachineId)?.nayaxLastTransaction ? ` · Last transaction ${metadataQuery.data?.find((entry) => entry.machineId === item.reportingMachineId)?.nayaxLastTransaction}` : ''}</option>)}</select>{inventoryQuery.isError && <p role="alert" className="text-sm text-destructive">Unable to load Nayax inventory. <Button variant="link" onClick={() => void inventoryQuery.refetch()}>Retry</Button></p>}{selected && <p className="break-words text-xs">Selected: {selected.machineName} · ID {selected.nayaxMachineId} · Account {selected.accountKey}<br/>Inventory last imported: {dateLabel(selected.lastSuccessfulSyncAt)} · {importFreshnessLabel(selected.lastSuccessfulSyncAt)}</p>}</>}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor={`physical-venue-${machineId}`}>Location / venue</Label><Input id={`physical-venue-${machineId}`} maxLength={300} value={venue} onChange={(event) => { setVenue(event.target.value); onDirtyChange?.(true); }} placeholder="Great Mall near food court" disabled={!canEdit || saving}/><p className="mt-1 text-xs text-muted-foreground">Physical placement for this machine. Your reporting location and time zone stay attached to its company assignment.</p></div><div className="text-sm"><p className="font-medium">Last recorded transaction</p><p className="mt-1">{metadata.lastRecordedTransaction ? `${dateLabel(metadata.lastRecordedTransaction)} · ${transactionAgeLabel(metadata.lastRecordedTransaction)}` : 'No transactions recorded'}</p><p className="mt-1 text-xs text-muted-foreground">Source: {metadata.transactionSource || 'Unknown'} · {importFreshnessLabel(metadata.lastSuccessfulSalesImport)}<br/>Latest successful sales import: {dateLabel(metadata.lastSuccessfulSalesImport)}</p></div></div>
      <p className="text-xs text-muted-foreground">Import times show available source/account data, and do not prove complete machine coverage. Missing or old transactions require review; they do not establish inactivity.</p>
      {canEdit && <div className="flex justify-end"><Button onClick={() => void save()} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save venue and Nayax match'}</Button></div>}
    </>}
  </section>;
}
