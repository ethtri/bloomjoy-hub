import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { NayaxMachinePicker } from '@/components/admin/NayaxMachinePicker';
import { MachineHelp } from '@/components/admin/MachineHelp';
import { fetchRefundNayaxInventory } from '@/lib/refundOperations';
import { fetchMachineWorkspaceMetadata, machineWorkspaceQueryKey, saveMachineWorkspaceMapping, previewMachineReaderChange, changeMachineReader, previewSamePhysicalMachineReaderJoin, joinSamePhysicalMachineReader, type MachineWorkspaceMetadata } from '@/lib/machineWorkspace';
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
  const [committedReader, setCommittedReader] = useState<{ id: string; account: string } | null>(null);
  const [changedOn, setChangedOn] = useState('');
  const [changedAtLocal, setChangedAtLocal] = useState('');
  const [changedAt, setChangedAt] = useState('');
  const [changeReason, setChangeReason] = useState('');
  const [confirmedChange, setConfirmedChange] = useState(false);
  const [confirmedSameMachine, setConfirmedSameMachine] = useState(false);
  const [physicalMoveSelected, setPhysicalMoveSelected] = useState(false);
  const [draftMetadata, setDraftMetadata] = useState<MachineWorkspaceMetadata | undefined>();
  const inventory = inventoryQuery.data?.machines ?? [];
  const selected = inventory.find((item) => item.id === inventoryId);
  const dirty = Boolean(draftMetadata && inventoryId && (!selected || selected.nayaxMachineId !== draftMetadata.nayaxMachineId || selected.accountKey !== (draftMetadata.nayaxAccountKey || 'TGPACI_USA_DB')));
  const readerPreview = useQuery({
    queryKey: ['admin-machine-reader-change', machineId, inventoryId, changedAtLocal],
    queryFn: () => previewMachineReaderChange(machineId, inventoryId, changedAtLocal || null),
    enabled: canEdit && !demo && dirty && Boolean(selected), retry: false,
  });
  const preview = readerPreview.data;
  const sameMachinePreview = useQuery({
    queryKey: ['admin-same-physical-machine-reader', machineId, inventoryId],
    queryFn: () => previewSamePhysicalMachineReaderJoin(machineId, inventoryId),
    enabled: canEdit && !demo && dirty && Boolean(selected?.reportingMachineId && selected.reportingMachineId !== machineId) && Boolean(metadata?.sources.length),
    retry: false,
  });
  const canJoinSameMachine = sameMachinePreview.data?.eligible === true && !sameMachinePreview.isError && !sameMachinePreview.isFetching;
  const joiningSameMachine = canJoinSameMachine && !physicalMoveSelected;
  const requiresSameMachinePreview = dirty && Boolean(selected?.reportingMachineId && selected.reportingMachineId !== machineId) && Boolean(metadata?.sources.length);
  const checkingSameMachine = requiresSameMachinePreview && sameMachinePreview.isFetching;
  const sameMachinePreviewFailed = requiresSameMachinePreview && sameMachinePreview.isError;
  const movingOwner = Boolean(preview?.ownerMachineId && preview.ownerMachineId !== machineId);
  const restoringSameReader = !preview?.currentReaderId && preview?.previousReaderId === preview?.newReaderId && preview?.previousAccountKey === preview?.newAccountKey;
  const needsReaderChange = Boolean(preview?.currentReaderId || (preview?.hasReaderHistory && !restoringSameReader) || movingOwner);
  const verifiedPreview = Boolean(preview && !readerPreview.isError && !readerPreview.isFetching);
  useEffect(() => { setConfirmedChange(false); setChangedAt(''); }, [inventoryId, preview?.expectedMachineUpdatedAt, preview?.expectedOwnerUpdatedAt, preview?.timezone, changedOn, changedAtLocal]);
  useEffect(() => { setConfirmedSameMachine(false); setPhysicalMoveSelected(false); }, [inventoryId, sameMachinePreview.isError, sameMachinePreview.data?.expectedMachineUpdatedAt, sameMachinePreview.data?.expectedHistoricalMachineUpdatedAt, sameMachinePreview.data?.expectedInventoryUpdatedAt, sameMachinePreview.data?.expectedSourceIdentityDigest]);
  useEffect(() => { if (metadata && (!draftMetadata || draftMetadata.machineId !== machineId || !dirty)) { setDraftMetadata(metadata); setInventoryId(''); } }, [machineId, metadata, draftMetadata, dirty]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  async function save() {
    if (!draftMetadata || saving || committedReader || !verifiedPreview || checkingSameMachine || sameMachinePreviewFailed || (!joiningSameMachine && (preview?.historicalOwnerConflict || preview?.ownerArchived))) return;
    setSaving(true);
    try {
      if (joiningSameMachine) {
        if (!confirmedSameMachine || !sameMachinePreview.data) return;
        await joinSamePhysicalMachineReader(sameMachinePreview.data);
      } else if (needsReaderChange) {
        if (!confirmedChange || !changedOn || !changeReason.trim() || (movingOwner && !changedAt)) return;
        await changeMachineReader(preview!, changedOn, changedAt || null, changeReason);
      } else await saveMachineWorkspaceMapping(draftMetadata, draftMetadata.venueLabel ?? '', inventoryId || null);
      setCommittedReader({ id: preview!.newReaderId, account: preview!.newAccountKey });
      onDirtyChange?.(false);
      toast.success('Reader connection saved.');
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: machineWorkspaceQueryKey }),
        queryClient.invalidateQueries({ queryKey: ['admin-refund-nayax-inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-refund-manager-setup'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-machine-source-inventory'] }),
        onSaved(),
      ]);
    } catch (error) {
      setConfirmedSameMachine(false); setConfirmedChange(false);
      void readerPreview.refetch();
      if (requiresSameMachinePreview) void sameMachinePreview.refetch();
      toast.error(error instanceof Error ? error.message : 'Unable to save machine mapping.');
    }
    finally { setSaving(false); }
  }
  useEffect(() => {
    if (committedReader && !metadataQuery.isError && !metadataQuery.isFetching
      && metadata?.nayaxMachineId === committedReader.id
      && (metadata.nayaxAccountKey || 'TGPACI_USA_DB') === committedReader.account) {
      setCommittedReader(null); setDraftMetadata(undefined); setInventoryId('');
      setChangedOn(''); setChangedAtLocal(''); setChangeReason(''); setConfirmedChange(false);
      onDirtyChange?.(false);
    }
  }, [committedReader, metadata, metadataQuery.isError, metadataQuery.isFetching, onDirtyChange]);
  if (committedReader) return <section aria-label="Source identity and Nayax matching" className="space-y-3 rounded-md border p-3">
    <p role="status" className="font-medium">Reader connection saved</p>
    <p className="break-words text-sm">Nayax ID {committedReader.id} · {committedReader.account}. Reloading this same machine does not save the connection again.</p>
    <Button key="saved-reader-read-retry" type="button" variant="outline" className="min-h-11" disabled={saving || metadataQuery.isFetching} onClick={async () => {
      setSaving(true);
      try { await Promise.allSettled([metadataQuery.refetch(), onSaved()]); } finally { setSaving(false); }
    }}>Retry loading</Button>
  </section>;
  return <section className="space-y-3" aria-label="Source identity and Nayax matching">
    {demo ? <p className="text-sm text-muted-foreground">Source mapping unavailable in demo.</p> : metadataQuery.isError ? <div role="alert">Unable to load source identities. <Button variant="link" onClick={() => void metadataQuery.refetch()}>Retry</Button></div> : !metadata ? <p role="status" className="text-sm text-muted-foreground">{metadataQuery.isPending ? 'Loading identities…' : 'Source data unavailable. Refresh to retry.'}</p> : <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 break-words text-sm">
          {metadata.sources.length ? metadata.sources.map((source) => <p key={`${source.platform}:${source.account}:${source.id}`}><span className="font-medium">{source.platform}</span>: {source.name || 'Unnamed'}<span className="block text-muted-foreground">ID {source.id}</span></p>) : <p className="text-muted-foreground">Source not connected</p>}
        </div>
        <MachineHelp label="Source and import details">
          <p>Original provider names and IDs are read-only. An exact match does not activate refunds.</p>
          {metadata.sources.map((source) => <div key={`${source.platform}:${source.account}:${source.id}`} className="mt-3 break-words"><p className="font-medium">{source.platform}{source.account ? ` · ${source.account}` : ''}</p><p>{source.platform === 'Kexiaozhan' ? 'Last positive source observation' : 'Last source transaction'}: {dateLabel(source.lastTransaction)}</p><p>Last seen: {dateLabel(source.lastSeenAt)}</p><p>Import: {dateLabel(source.lastSuccessfulImport)} · {importFreshnessLabel(source.lastSuccessfulImport)}</p></div>)}
          <p className="mt-3">Import freshness does not prove complete coverage or genuine inactivity.</p>
        </MachineHelp>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Nayax match</p>
        {canEdit ? <NayaxMachinePicker records={inventory} machineId={machineId} selectedId={inventoryId} currentName={metadata.nayaxMachineId ? `${metadata.nayaxName || 'Saved Nayax record'} · ID ${metadata.nayaxMachineId} · ${metadata.nayaxAccountKey || 'TGPACI_USA_DB'}` : ''} disabled={saving || inventoryQuery.isPending || inventoryQuery.isError} allowOccupied onSelect={(id) => { setInventoryId(id); onDirtyChange?.(true); }} /> : <p className="break-words text-sm">{metadata.nayaxMachineId ? `${metadata.nayaxName || 'Saved Nayax record'} · ID ${metadata.nayaxMachineId} · ${metadata.nayaxAccountKey || 'TGPACI_USA_DB'}` : 'Not matched'}</p>}
        {inventoryQuery.isError && <p role="alert" className="text-sm text-destructive">Imported Nayax records unavailable. Refresh to retry.</p>}
      </div>
      {metadata.salesActivationPending && <p className="rounded-md border p-3 text-sm">Source connected for management. Sales activation awaits reconciliation; imported orders remain pending and existing sales history is unchanged.</p>}
      {dirty && <div className="space-y-3 rounded-md border p-3 text-sm">
        {readerPreview.isFetching || checkingSameMachine ? <p role="status">Checking current and historical reader connections…</p> : readerPreview.isError ? <div role="alert">Reader connection unavailable. <Button variant="link" onClick={() => void readerPreview.refetch()}>Retry</Button></div> : sameMachinePreviewFailed ? <div role="alert">Connection details unavailable. Reload before reviewing this reader. <Button type="button" variant="link" onClick={() => void sameMachinePreview.refetch()}>Reload connection details</Button></div> : preview && <>
          <p className="break-words">Current reader: {preview.currentReaderId || 'None'} · {preview.currentAccountKey || 'No current account'}{!preview.currentReaderId && preview.previousReaderId && <> · Previous reader: {preview.previousReaderId}</>}<br />Selected reader: {preview.newReaderId} · {preview.newAccountKey}</p>
          {preview.ownerMachineId && <p className="break-words">Already connected to: {sameMachinePreview.data?.historicalMachineName || preview.ownerMachineName || preview.ownerMachineId}</p>}
          {joiningSameMachine && sameMachinePreview.data ? <div className="space-y-3" role="region" aria-label="Review same machine connection">
            <p>Connect this reader to {sameMachinePreview.data.machineName}. Keep this machine’s company and Managers.</p>
            <label className="flex min-h-11 items-start gap-2"><input type="checkbox" className="mt-1" checked={confirmedSameMachine} onChange={event => setConfirmedSameMachine(event.target.checked)} disabled={saving || !verifiedPreview} />These are the same physical machine</label>
            <details><summary className="cursor-pointer py-2 underline">Historical transactions and refunds</summary><p className="mt-2">{sameMachinePreview.data.historicalCardTransactionCount} card transactions and {sameMachinePreview.data.historicalRefundCaseCount} refund cases remain with {sameMachinePreview.data.historicalMachineName}, under their original company. Its historical record remains available in reporting. This connection does not enable customer refunds or automatic card refunds.</p></details>
            <Button type="button" variant="link" className="min-h-11 h-auto whitespace-normal px-0 text-left" disabled={saving} onClick={() => { setPhysicalMoveSelected(true); setConfirmedSameMachine(false); }}>This reader physically moved between machines</Button>
          </div> : <>
          {canJoinSameMachine && <Button type="button" variant="link" className="min-h-11 h-auto whitespace-normal px-0 text-left" disabled={saving} onClick={() => { setPhysicalMoveSelected(false); setConfirmedChange(false); }}>These records are the same physical machine</Button>}
          {requiresSameMachinePreview && sameMachinePreview.data?.reason && <p className="text-muted-foreground">{sameMachinePreview.data.reason}</p>}
          {preview.historicalOwnerConflict || preview.ownerArchived ? <p role="alert">This reader needs its historical ownership reconciled before it can move. Existing connections remain unchanged.</p> : needsReaderChange && <>
            <p>{movingOwner ? 'Review moving this reader between these two machines. Original transactions stay with their original machine.' : 'Change the reader on this same machine. Its source, company, managers and past transactions stay unchanged.'}</p>
            <Label htmlFor={`reader-change-date-${machineId}`}>Actual reader change date</Label>
            <Input id={`reader-change-date-${machineId}`} type="date" className="min-h-11 w-full min-w-0 text-base md:text-base" value={changedOn} onChange={event => setChangedOn(event.target.value)} disabled={saving} />
            <p className="text-muted-foreground">Saved machine time zone: {preview.timezone}. A calendar date does not invent an installation time.</p>
            {movingOwner && <>
              <Label htmlFor={`reader-change-time-${machineId}`}>Actual local change time</Label>
              <Input id={`reader-change-time-${machineId}`} type="datetime-local" className="min-h-11 w-full min-w-0 text-base md:text-base" value={changedAtLocal} onChange={event => setChangedAtLocal(event.target.value)} disabled={saving} />
              {changedAtLocal && preview.effectiveInstants.length === 0 && <p role="alert">This local time does not exist in the saved time zone. Review the actual time.</p>}
              {preview.effectiveInstants.map(instant => <label key={instant} className="flex min-h-11 items-center gap-2"><input type="radio" name={`reader-change-instant-${machineId}`} checked={changedAt === instant} onChange={() => { setChangedAt(instant); setConfirmedChange(false); }} />{instant} UTC{preview.effectiveInstants.length > 1 ? ' · Choose the actual occurrence' : ''}</label>)}
            </>}
            <Label htmlFor={`reader-change-reason-${machineId}`}>Reason for this change</Label>
            <Input id={`reader-change-reason-${machineId}`} className="min-h-11 text-base md:text-base" value={changeReason} onChange={event => { setChangeReason(event.target.value); setConfirmedChange(false); }} disabled={saving} />
            <p className="text-muted-foreground">Old reader evidence remains available. Imports without enough purchase-time evidence stay pending for review; refunds are not automatically enabled.</p>
            <label className="flex min-h-11 items-start gap-2"><input type="checkbox" checked={confirmedChange} onChange={event => setConfirmedChange(event.target.checked)} disabled={saving || !verifiedPreview || !changedOn || !changeReason.trim() || (movingOwner && !changedAt)} />I reviewed the two reader IDs, ownership and actual change date.</label>
          </>}
          </>}
        </>}
      </div>}

      <p className="text-xs text-muted-foreground">Last recorded transaction: {metadata.lastRecordedTransaction ? `${dateLabel(metadata.lastRecordedTransaction)} · ${transactionAgeLabel(metadata.lastRecordedTransaction)}` : 'None recorded'} · {transactionSourceLabel(metadata.transactionSource)} · {importFreshnessLabel(metadata.lastSuccessfulSalesImport)}</p>
      {dirty && canEdit && <div className="flex justify-end"><Button key="normal-reader-save" type="button" className="min-h-11 text-base" onClick={() => void save()} disabled={saving || !verifiedPreview || checkingSameMachine || sameMachinePreviewFailed || (joiningSameMachine ? !confirmedSameMachine : Boolean(preview?.historicalOwnerConflict || preview?.ownerArchived || (needsReaderChange && (!confirmedChange || !changedOn || !changeReason.trim() || (movingOwner && !changedAt)))))}>{saving ? 'Saving…' : joiningSameMachine ? 'Connect this reader' : needsReaderChange ? 'Save reader change' : 'Save Nayax match'}</Button></div>}
    </>}
  </section>;
}
