import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { applyMachineRatePeriod, machineRateDraftError, machineRateDraftKey, type MachineRateDraft, type MachineRatePolicyState, type MachineRatePreview, type MachineRatePeriod } from '@/lib/reportingMachineRatePolicy';
import { fetchMachineRatePolicy, previewMachineRatePolicy, saveMachineRatePolicy } from '@/lib/reportingMachineRatePolicyApi';

export function MachineRatePolicyPanel({ machineId, canEdit, demo = false }: { machineId: string; canEdit: boolean; demo?: boolean }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ['admin-machine-rate-policy', user?.id, machineId];
  const policy = useQuery({ queryKey, queryFn: () => fetchMachineRatePolicy(machineId), enabled: !demo && Boolean(user?.id), staleTime: 30000 });
  if (demo) return <div className="mt-5 rounded-lg border p-4 text-sm">Tax rate editing is available for authorized machines in the live admin workspace.</div>;
  if (policy.isPending) return <p className="mt-5 text-sm text-muted-foreground" role="status">Loading tax rate and history…</p>;
  if (policy.isError || !policy.data) return <section className="mt-5 rounded-lg border p-4"><h3 className="font-semibold">Tax rate</h3><p className="mt-2 text-sm text-muted-foreground">The tax rate editor is unavailable. Try loading it again.</p><Button className="mt-3" variant="outline" onClick={() => void policy.refetch()}>Retry</Button></section>;
  return <MachineRateEditor key={machineId} state={policy.data} canEdit={canEdit} preview={draft => previewMachineRatePolicy(machineId, draft)} save={async (draft, token) => {
    let saved: MachineRatePolicyState;
    try { saved = await saveMachineRatePolicy(machineId, draft, token); }
    catch (error) { await queryClient.invalidateQueries({ queryKey }); throw error; }
    queryClient.setQueryData(queryKey, saved);
    toast.success('Tax rate saved. Recalculated reports use the selected purchase dates.');
    await queryClient.invalidateQueries({ predicate: query => /sales|finance|revenue|payout|technician-pay|partner.*(report|preview|dashboard)|admin-machine-tax-source/i.test(String(query.queryKey[0])) });
  }} />;
}

type Props = {
  state: MachineRatePolicyState;
  canEdit: boolean;
  preview: (draft: MachineRateDraft) => Promise<MachineRatePreview>;
  save: (draft: MachineRateDraft, token: string) => Promise<void>;
};

const money = (cents: number | null) => cents === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const statusLabel = (status: string) => status === 'provisional' ? 'Provisional estimate' : status === 'confirmed' ? 'Confirmed' : status === 'source_verified' ? 'Verified source' : 'Unavailable';

export function MachineRateEditor({ state, canEdit, preview, save }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<MachineRateDraft>({ ratePercent: state.current.ratePercent === null ? '' : String(state.current.ratePercent), status: state.current.status === 'confirmed' ? 'confirmed' : 'provisional', startsOn: state.asOfDate, endsOn: '', reason: '', evidenceReference: '' });
  const [impact, setImpact] = useState<{ key: string; value: MachineRatePreview } | null>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const change = (next: MachineRateDraft) => { setDraft(next); setImpact(null); setError(null); };
  const selectPeriod = (period: MachineRatePeriod) => change(applyMachineRatePeriod(draft, period, state.asOfDate, state.historyStartsOn));
  const currentImpact = impact?.key === machineRateDraftKey(draft) && impact.value.revision === state.revision ? impact.value : null;
  const previousDate = new Date(`${state.asOfDate}T00:00:00Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  const selectedPeriod: MachineRatePeriod | null = draft.endsOn === previousDate.toISOString().slice(0, 10) ? 'past' : draft.endsOn ? null : draft.startsOn === state.asOfDate ? 'current' : draft.startsOn && draft.startsOn < state.asOfDate ? 'both' : null;
  const handlePreview = async () => {
    const invalid = machineRateDraftError(draft);
    if (invalid) { setError(invalid); return; }
    setBusy('preview'); setError(null); setImpact(null);
    const key = machineRateDraftKey(draft);
    try { setImpact({ key, value: await preview(draft) }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to preview this rate.'); }
    finally { setBusy(null); }
  };
  const handleSave = async () => {
    if (!currentImpact || Date.parse(currentImpact.expiresAt) <= Date.now()) { setImpact(null); setError('Preview this change again before saving.'); return; }
    setBusy('save'); setError(null);
    try { await save(draft, currentImpact.previewToken); setEditing(false); setImpact(null); }
    catch (caught) { setImpact(null); setError(caught instanceof Error ? caught.message : 'Unable to save this rate.'); }
    finally { setBusy(null); }
  };
  return <section className="mt-5 rounded-lg border border-border p-4" aria-labelledby="machine-tax-policy-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 id="machine-tax-policy-title" className="font-semibold">Tax rate</h3><div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-xl font-semibold">{state.current.ratePercent === null ? 'Unavailable' : `${state.current.ratePercent}%`}</span><Badge variant="outline">{statusLabel(state.current.status)}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{state.current.label}</p></div>
      {canEdit && !editing && <Button variant="outline" onClick={() => { setEditing(true); setError(null); }}>Adjust rate</Button>}
    </div>
    <p className="mt-3 text-sm text-muted-foreground">Tax recorded on the original transaction takes priority. Cash and sales already recorded excluding tax keep their existing treatment.</p>
    {editing && <div className="mt-5 space-y-4 border-t border-border pt-4">
      <fieldset disabled={busy !== null} className="space-y-4">
        <legend className="sr-only">Change this machine's tax rate</legend>
        <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="machine-policy-rate">Tax rate (%)</Label><Input id="machine-policy-rate" inputMode="decimal" value={draft.ratePercent} onChange={event => change({ ...draft, ratePercent: event.target.value })} placeholder="9" className="mt-1 h-11" /><p className="mt-1 text-xs text-muted-foreground">Enter 9 for 9%. Enter 0 only for an explicit zero rate.</p></div><div><Label htmlFor="machine-policy-status">Evidence</Label><select id="machine-policy-status" value={draft.status} onChange={event => change({ ...draft, status: event.target.value as MachineRateDraft['status'] })} className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-base"><option value="provisional">Provisional (estimated)</option><option value="confirmed">Confirmed</option></select></div></div>
        <div><p className="text-sm font-medium">Which purchases should this apply to?</p><div className="mt-2 flex flex-wrap gap-2"><Button type="button" variant={selectedPeriod === 'past' ? 'default' : 'outline'} aria-pressed={selectedPeriod === 'past'} onClick={() => selectPeriod('past')}>Past dates</Button><Button type="button" variant={selectedPeriod === 'current' ? 'default' : 'outline'} aria-pressed={selectedPeriod === 'current'} onClick={() => selectPeriod('current')}>Current and future</Button><Button type="button" variant={selectedPeriod === 'both' ? 'default' : 'outline'} aria-pressed={selectedPeriod === 'both'} onClick={() => selectPeriod('both')}>Past and current</Button></div></div>
        <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="machine-policy-start">First purchase date</Label><Input id="machine-policy-start" type="date" value={draft.startsOn} onChange={event => change({ ...draft, startsOn: event.target.value })} className="mt-1 h-11" /></div><div><Label htmlFor="machine-policy-end">Last purchase date (optional)</Label><Input id="machine-policy-end" type="date" value={draft.endsOn} min={draft.startsOn || undefined} onChange={event => change({ ...draft, endsOn: event.target.value })} className="mt-1 h-11" /><p className="mt-1 text-xs text-muted-foreground">Leave blank to keep applying this rate to future purchases.</p></div></div>
        <div><Label htmlFor="machine-policy-reason">Reason for this change</Label><Textarea id="machine-policy-reason" value={draft.reason} onChange={event => change({ ...draft, reason: event.target.value })} className="mt-1" /></div>
        <div><Label htmlFor="machine-policy-evidence">Evidence reference (optional)</Label><Input id="machine-policy-evidence" value={draft.evidenceReference} onChange={event => change({ ...draft, evidenceReference: event.target.value })} placeholder="Owner confirmation, source record or internal note" className="mt-1 h-11" /></div>
      </fieldset>
      <p className="text-sm text-muted-foreground">{draft.status === 'provisional' ? 'This is an estimate. Verified source information, including a later Nayax rate, replaces it when available.' : 'This confirmed correction applies for the selected purchase dates until it is changed. Original transaction tax still takes priority.'}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {currentImpact && <div className="rounded-md border border-border bg-muted/30 p-3" aria-live="polite"><h4 className="font-medium">Change preview</h4><p className="mt-1 text-sm">Policy purchase dates: {currentImpact.range.startsOn} to {currentImpact.range.endsOn || 'ongoing (includes future purchases)'}.</p><p className="mt-1 text-sm">Impact across all recorded machine amounts: {currentImpact.observedRange.startsOn && currentImpact.observedRange.endsOn ? currentImpact.observedRange.startsOn + ' to ' + currentImpact.observedRange.endsOn : 'No recorded amounts yet'}.</p><p className="mt-1 text-xs text-muted-foreground">A rate applies to purchase dates. Its impact can include refunds recorded later; the amounts below use the recorded history above.</p><p className="mt-1 text-sm">{currentImpact.affectedSalesComponents.toLocaleString()} sales amounts and {currentImpact.affectedRefundComponents.toLocaleString()} refund amounts change. {currentImpact.preservedActualTaxSalesFacts.toLocaleString()} sales records retain their original tax.</p><div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b"><th className="py-2 text-left">Known amounts</th><th className="px-2 text-right">Before</th><th className="text-right">After</th></tr></thead><tbody><tr><th className="py-2 text-left font-normal">Sales excluding tax</th><td className="px-2 text-right">{money(currentImpact.before.knownSalesExTaxCents)}</td><td className="text-right">{money(currentImpact.after.knownSalesExTaxCents)}</td></tr><tr><th className="py-2 text-left font-normal">Refunds excluding tax</th><td className="px-2 text-right">{money(currentImpact.before.knownRefundExTaxCents)}</td><td className="text-right">{money(currentImpact.after.knownRefundExTaxCents)}</td></tr>{(draft.status === 'provisional' || currentImpact.before.provisionalSalesComponents + currentImpact.before.provisionalRefundComponents + currentImpact.after.provisionalSalesComponents + currentImpact.after.provisionalRefundComponents > 0) && ([['Estimated sales excluding tax', 'estimatedSalesExTaxCents'], ['Estimated refunds excluding tax', 'estimatedRefundExTaxCents'], ['Estimated net sales', 'estimatedNetExTaxCents']] as const).map(([label, field]) => <tr key={field}><th className="py-2 text-left font-normal">{label}</th><td className="px-2 text-right">{money(currentImpact.before[field])}</td><td className="text-right">{money(currentImpact.after[field])}</td></tr>)}</tbody></table></div>{draft.status === 'provisional' && <p className="mt-2 text-xs text-muted-foreground">Estimated amounts are separate from known amounts and are not used to authorize payouts. They yield to verified source information.</p>}<p className="mt-2 text-xs text-muted-foreground">Amounts not yet confirmed: sales {currentImpact.before.unknownSalesComponents} → {currentImpact.after.unknownSalesComponents}; refunds {currentImpact.before.unknownRefundComponents} → {currentImpact.after.unknownRefundComponents}.</p><p className="mt-1 text-xs text-muted-foreground">Still unavailable without an estimate: sales {Math.max(0, currentImpact.after.unknownSalesComponents - currentImpact.after.provisionalSalesComponents)}; refunds {Math.max(0, currentImpact.after.unknownRefundComponents - currentImpact.after.provisionalRefundComponents)}.</p><p className="mt-1 text-xs text-muted-foreground">Amounts with provisional estimates: sales {currentImpact.before.provisionalSalesComponents} → {currentImpact.after.provisionalSalesComponents}; refunds {currentImpact.before.provisionalRefundComponents} → {currentImpact.after.provisionalRefundComponents}.</p>{currentImpact.warnings.map((warning, index) => <p key={index} className="mt-2 text-sm">{warning}</p>)}</div>}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" disabled={busy !== null} onClick={() => { setEditing(false); setImpact(null); setError(null); }}>Cancel</Button><Button variant="outline" disabled={busy !== null} onClick={() => void handlePreview()}>{busy === 'preview' ? 'Calculating…' : 'Preview change'}</Button><Button disabled={busy !== null || !currentImpact} onClick={() => void handleSave()}>{busy === 'save' ? 'Saving…' : 'Save rate'}</Button></div>
    </div>}
    <details className="mt-4 border-t border-border pt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Rate history</summary><p className="mt-1 text-xs text-muted-foreground">Provisional rates are estimates and yield to verified source information. Saved changes retain their dates, evidence and author.</p>{state.policies.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No saved rate policies.</p> : <ol className="mt-3 divide-y divide-border">{state.policies.map(policy => <li key={policy.id} className="py-3 text-sm"><div className="flex flex-wrap items-center gap-2"><strong>{policy.ratePercent}%</strong><Badge variant="outline">{statusLabel(policy.status)}</Badge>{policy.supersededAt && <span className="text-muted-foreground">Superseded</span>}</div><p className="mt-1">{policy.startsOn} to {policy.endsOn || 'ongoing'}</p><p className="mt-1 break-words">{policy.reason}</p>{policy.evidenceReference && <p className="mt-1 break-words text-muted-foreground">{policy.evidenceReference}</p>}<p className="mt-1 text-xs text-muted-foreground">{policy.createdByLabel} · {new Date(policy.createdAt).toLocaleString()}</p></li>)}</ol>}</details>
  </section>;
}
