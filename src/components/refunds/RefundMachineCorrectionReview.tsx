import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchRefundMachineCorrectionOptions, fetchRefundReceiptOverview, saveRefundReceiptEvidence } from '@/lib/refundAuthoritativeReceiptApi';
import { buildRefundMachineCorrectionRequest, refreshRefundReceiptViews, refundMachineCorrectionReviewSnapshot,
  refundReceiptReviewSnapshot, type RefundReceiptOverview } from '@/lib/refundAuthoritativeReceipt';

type Props = { overview: RefundReceiptOverview; context: { machineLabel: string; locationName: string; expectedCaseVersion?: number }; onBusyChange: (busy: boolean) => void };

export function RefundMachineCorrectionReview({ overview: v, context, onBusyChange }: Props) {
  const client = useQueryClient();
  const [inventoryId, setInventoryId] = useState('');
  const [machineNumber, setMachineNumber] = useState('');
  const [reference, setReference] = useState('');
  const [approvedSnapshot, setApprovedSnapshot] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const query = useQuery({ queryKey: ['refund-legacy-machine-correction-options', v.caseId],
    queryFn: () => fetchRefundMachineCorrectionOptions(v.caseId), retry: false, staleTime: 0, gcTime: 0 });
  const options = query.data;
  const target = options?.targets.find((t) => t.inventoryId === inventoryId);
  const current = options && v.caseId === options.caseId && v.expectedCaseVersion === options.expectedCaseVersion &&
    context.expectedCaseVersion === v.expectedCaseVersion;
  const snapshot = options ? refundMachineCorrectionReviewSnapshot(v, options, inventoryId, context, reference, machineNumber) : '';
  const reviewed = Boolean(snapshot) && snapshot === approvedSnapshot;
  const ready = current && v.canRecord && !v.receipt && target?.accountScope === v.accountScope && target.machineNumber === machineNumber &&
    reference === `DTM:NAYAX-${v.originalTransactionId}`;
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: v.currencyCode }).format(v.originalAmountCents / 100);
  async function refresh() {
    setApprovedSnapshot(''); setFeedback('');
    await refreshRefundReceiptViews((queryKey) => client.invalidateQueries({ queryKey }));
  }
  async function save() {
    if (!options || !reviewed || !ready || busy || query.isFetching || query.isError) return;
    setBusy(true); onBusyChange(true); setFeedback('');
    try {
      // Re-read with this user's real session immediately before submission. Never
      // silently transplant a checked attestation onto fresh inventory or case data.
      const [freshCase, freshOptions] = await Promise.all([fetchRefundReceiptOverview(v.caseId), fetchRefundMachineCorrectionOptions(v.caseId)]);
      if (!freshCase || refundReceiptReviewSnapshot(freshCase) !== refundReceiptReviewSnapshot(v) ||
        refundMachineCorrectionReviewSnapshot(freshCase, freshOptions, inventoryId, context, reference, machineNumber) !== approvedSnapshot) {
        throw new Error('Review changed');
      }
      await saveRefundReceiptEvidence(buildRefundMachineCorrectionRequest(freshCase, freshOptions, inventoryId,
        machineNumber, reference, true, context.expectedCaseVersion));
      setApprovedSnapshot('');
      await refreshRefundReceiptViews((queryKey) => client.invalidateQueries({ queryKey }));
      setFeedback('Machine corrected and full-refund observation saved. No payment or message was sent.');
    } catch {
      setApprovedSnapshot('');
      setFeedback('Correction was not confirmed. Review refreshed evidence and current access before trying again. Do not retry payment or send a message.');
      await refreshRefundReceiptViews((queryKey) => client.invalidateQueries({ queryKey }));
    } finally { setBusy(false); onBusyChange(false); }
  }
  return <div className="space-y-4" data-testid="refund-machine-correction-review">
    <div><h4 className="font-semibold">Correct this claim’s machine and record the refund</h4>
      <p className="mt-1 text-sm leading-6">Only a recognized legacy portal record can be corrected here. Both machines must remain in your active manager scope, in the same account, location and time zone. Current Super Admin access is checked again when saving.</p></div>
    {query.isLoading ? <p role="status" className="text-sm">Loading current machine evidence…</p> : query.isError ?
      <p role="alert" className="text-sm">Current machine review is unavailable. Check your Super Admin access and manager assignments, then refresh. No changes were made.</p> : <>
      {!current && <p role="alert" className="text-sm">The case changed. Refresh both the case and inventory before reviewing.</p>}
      <div className="space-y-2"><Label htmlFor="refund-correction-target">Correct machine from current inventory</Label>
        <select id="refund-correction-target" value={inventoryId} disabled={busy || query.isFetching || !current}
          onChange={(e) => { setInventoryId(e.target.value); setMachineNumber(''); setApprovedSnapshot(''); }}
          className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Choose the machine shown in Nayax</option>
          {options?.targets.map((t) => <option value={t.inventoryId} key={t.inventoryId}>{t.machineLabel} · {t.machineNumber}</option>)}
        </select>
        {options?.targets.length === 0 && <p className="text-sm text-muted-foreground">No other current machine is available in this scope. Resolve inventory or manager access through the supported admin workflow. Do not change customer evidence to bypass this check.</p>}
      </div>
      {target && <>
        <dl className="grid gap-x-6 gap-y-3 bg-muted/30 p-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Original case machine</dt><dd className="break-words font-medium">{context.machineLabel}</dd><dd className="break-all text-muted-foreground">Provider ID {v.providerMachineId}</dd></div>
          <div><dt className="text-muted-foreground">Corrected current machine</dt><dd className="break-words font-medium">{target.machineLabel}</dd><dd className="break-all text-muted-foreground">Provider ID {target.providerMachineId}</dd></div>
          <div><dt className="text-muted-foreground">Account / location</dt><dd className="break-words">{target.accountScope} / {context.locationName}</dd></div>
          <div><dt className="text-muted-foreground">Numeric machine number</dt><dd className="break-all font-medium tabular-nums">{target.machineNumber}</dd></div>
          <div><dt className="text-muted-foreground">Unchanged original</dt><dd className="break-all">{v.originalTransactionId}</dd></div>
          <div><dt className="text-muted-foreground">Exact full refund</dt><dd className="font-medium">{amount} {v.currencyCode} · Refunded (62)</dd></div>
        </dl>
        <p className="text-sm leading-6">The current claim and receipt will use the corrected machine. The historical attempt, original customer report, QR evidence and sent notice stay unchanged. Old candidate-match factors are not evidence for the corrected machine. No inventory mapping, payment, accounting date or message will be created or changed.</p>
        <div className="space-y-2"><Label htmlFor="refund-correction-number">Enter the numeric machine number verified in Nayax</Label>
          <Input id="refund-correction-number" inputMode="numeric" autoComplete="off" maxLength={120} value={machineNumber} disabled={busy}
            className="min-h-11" onChange={(e) => { setMachineNumber(e.target.value); setApprovedSnapshot(''); }} /></div>
        <div className="space-y-2"><Label htmlFor="refund-correction-reference">Exact Nayax original reference</Label>
          <Input id="refund-correction-reference" value={reference} disabled={busy} className="min-h-11" placeholder={`DTM:NAYAX-${v.originalTransactionId}`}
            onChange={(e) => { setReference(e.target.value); setApprovedSnapshot(''); }} /></div>
        <label className="flex min-h-11 items-start gap-3 py-2 text-sm leading-6">
          <input type="checkbox" className="mt-1.5 h-4 w-4 shrink-0" checked={reviewed} disabled={busy || query.isFetching || !ready}
            onChange={(e) => setApprovedSnapshot(e.target.checked ? snapshot : '')} />
          <span>I verified the corrected account, provider ID and numeric machine number against this exact original in Nayax. The full {amount} is Refunded (62), the original and amount are unchanged, and the actual settlement time is unavailable. I am recording a current observation, not approving the historical attempt.</span>
        </label>
        <Button className="min-h-11 w-full whitespace-normal sm:w-auto" disabled={busy || query.isFetching || !ready || !reviewed}
          onClick={() => void save()}>{busy ? 'Saving reviewed correction…' : 'Correct machine and record observation'}</Button>
      </>}
    </>}
    {feedback && <p role="status" aria-live="polite" className="text-sm leading-6">{feedback}</p>}
    <Button variant="ghost" className="min-h-11" disabled={busy || query.isFetching} onClick={() => void refresh()}>Refresh case and machine evidence</Button>
  </div>;
}
