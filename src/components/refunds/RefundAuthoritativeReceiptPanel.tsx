import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchRefundReceiptOverview, saveRefundReceiptEvidence } from '@/lib/refundAuthoritativeReceiptApi';
import { buildReceiptAdoptionRequest, buildReceiptRecordRequest, refreshRefundReceiptViews, refundReceiptReviewSnapshot, type RefundReceiptOverview, type RefundMachineCorrectionEvidence } from '@/lib/refundAuthoritativeReceipt';
import { RefundMachineCorrectionReview } from './RefundMachineCorrectionReview';
import { RefundHistoricalOwnerNoticeReview, historicalOwnerNoticeRecordedLabel } from './RefundHistoricalOwnerNoticeReview';
import { RefundReceiptCompletionNotice } from './RefundReceiptCompletionNotice';

type Props = { caseId: string; demo?: boolean;
  machineContext?: { machineLabel: string; locationName: string; expectedCaseVersion?: number };
  machineCorrection?: RefundMachineCorrectionEvidence | null;
  onCorrectionReviewChange?: (active: boolean) => void;
};
const demoOverview: RefundReceiptOverview = {
  schemaVersion: 'refund_receipt_overview_v1', visible: true, caseId: 'ad400000-0000-4000-8000-000000000001',
  caseReference: 'RF-RECEIPT-DEMO', expectedCaseVersion: 1, canRecord: true, attemptId: null,
  attemptBindingKind: 'no_attempt_integrity_hold',
  accountScope: 'SYNTHETIC-ACCOUNT', providerMachineId: 'SYNTHETIC-MACHINE', originalTransactionId: '123456781',
  originalAmountCents: 700, currencyCode: 'USD', receipt: null, noticeChoices: [],
};

export function RefundAuthoritativeReceiptPanel({ caseId, demo = false, machineContext, machineCorrection, onCorrectionReviewChange }: Props) {
  const queryClient = useQueryClient();
  const [localDemo, setLocalDemo] = useState(demoOverview);
  const [reference, setReference] = useState('');
  const [paymentReviewSnapshot, setPaymentReviewSnapshot] = useState('');
  const [messageId, setMessageId] = useState('');
  const [noticeReviewSnapshot, setNoticeReviewSnapshot] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [historicalNoticeOpen, setHistoricalNoticeOpen] = useState(false);
  const [historicalSavedCaseId, setHistoricalSavedCaseId] = useState('');
  const query = useQuery({ queryKey: ['refund-authoritative-receipt', caseId],
    queryFn: () => fetchRefundReceiptOverview(caseId), enabled: !demo, retry: false, staleTime: 0, gcTime: 0 });
  const v = demo ? localDemo : query.data;
  const correcting = correctionOpen && !v?.receipt;
  useEffect(() => {
    // Receipt and parent overview refresh independently. Keep suppression latched
    // even if the receipt wins the race or the parent refresh fails. The parent's
    // confirmed lifecycle takes precedence; closing this pane clears the latch.
    onCorrectionReviewChange?.(correctionOpen);
    return () => onCorrectionReviewChange?.(false);
  }, [correctionOpen, onCorrectionReviewChange]);
  const currentSnapshot = refundReceiptReviewSnapshot(v);
  const reviewedPayment = Boolean(currentSnapshot) && paymentReviewSnapshot === currentSnapshot;
  const reviewedNotice = Boolean(currentSnapshot) && noticeReviewSnapshot === currentSnapshot;
  const setReviewedPayment = (reviewed: boolean) => setPaymentReviewSnapshot(reviewed ? currentSnapshot : '');
  const setReviewedNotice = (reviewed: boolean) => setNoticeReviewSnapshot(reviewed ? currentSnapshot : '');
  const selected = v?.noticeChoices.find((n) => n.id === messageId);
  async function save(kind: 'record' | 'adopt') {
    if (!v || busy) return;
    setBusy(true); setFeedback('');
    try {
      const request = kind === 'record' ? buildReceiptRecordRequest(v, reference, reviewedPayment)
        : buildReceiptAdoptionRequest(v, messageId, reviewedNotice);
      if (demo) {
        setLocalDemo(kind === 'record' ? { ...v, canRecord: false,
          receipt: { id: 'ad900000-0000-4000-8000-000000000001', observedAt: '2026-09-02T16:00:00Z',
            settlementTimePrecision: 'unknown', noticeAdopted: false, noticeSentAt: null, managerCcVerified: null },
          noticeChoices: [{ id: 'ad800000-0000-4000-8000-000000000001', sentAt: '2026-09-02T15:00:00Z',
            subject: 'Your refund update', plainBody: 'Your $7.00 refund for RF-RECEIPT-DEMO is confirmed. The other purchase in this thread is still pending.' }] }
          : { ...v, receipt: { ...v.receipt!, noticeAdopted: true, noticeSentAt: selected!.sentAt, managerCcVerified: false }, noticeChoices: [] });
      } else {
        await saveRefundReceiptEvidence(request);
        await refreshRefundReceiptViews((queryKey) => queryClient.invalidateQueries({ queryKey }));
      }
      setReviewedPayment(false); setReviewedNotice(false);
      setFeedback(kind === 'record' ? 'Full-refund observation saved. Nothing was sent; accounting date remains unknown.'
        : 'Existing notice verified for this claim. Nothing was sent again.');
    } catch {
      setFeedback('Evidence was not confirmed. Reload and review the current case and source proof before trying again.');
    } finally { setBusy(false); }
  }
  if (!demo && query.isLoading) return <p role="status" className="mt-4 text-sm">Loading reconciliation evidence…</p>;
  if (!demo && query.isError) return <div className="mt-4 space-y-2 text-sm" role="alert">
    <p>Receipt review is unavailable. No payment or message was created.</p>
    <Button variant="outline" className="min-h-11" onClick={() => void query.refetch()}>Reload receipt review</Button>
  </div>;
  if (!v?.visible) return null;
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: v.currencyCode }).format(v.originalAmountCents / 100);
  return <section data-testid="refund-authoritative-receipt-panel" className="mt-4 space-y-4 border-t border-border pt-4 text-foreground" aria-label="Authoritative refund evidence">
    <div>
      <h3 className="font-semibold text-balance">{v.receipt ? 'Refund confirmed · accounting date unknown' : 'Nayax confirms a full refund, but no settlement date?'}</h3>
      <p className="mt-1 text-sm leading-6 text-pretty">{v.receipt ? 'The saved observation confirms the payment. Review customer communication below while Refund Operations checks the accounting date.' : 'Record an observation without inventing a processing date, creating an accounting adjustment, sending money or contacting the customer.'}</p>
    </div>
    <dl className="grid gap-3 rounded-lg bg-muted/30 p-3 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Exact claim</dt><dd className="break-words font-medium">{v.caseReference}</dd></div>
      <div><dt className="text-muted-foreground">Full refund</dt><dd className="font-medium tabular-nums">{amount} {v.currencyCode}</dd></div>
      <div><dt className="text-muted-foreground">Selected original</dt><dd className="break-all font-medium">{v.originalTransactionId}</dd></div>
      <div><dt className="text-muted-foreground">Account / machine</dt><dd className="break-all font-medium">{v.accountScope} / {v.providerMachineId}</dd></div>
    </dl>
    {v.attemptBindingKind === 'legacy_manual_portal_observation' && <p className="rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-950">
      Legacy portal record: historical evidence links this claim, original and amount, but does not establish account authorization.
      This receipt records your separate review of the current provider account, machine and full refund. It does not approve or rewrite the historical attempt.
    </p>}
    {machineCorrection && v.receipt?.id === machineCorrection.receiptId && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm leading-6 text-emerald-950">
      Current machine correction saved: {machineContext?.machineLabel || 'the verified machine'}.
      {' '}The historical attempt, customer report and sent notice remain unchanged. Historical candidate factors are not corroboration for this machine.
    </p>}
    {!demo && machineContext && !v.receipt && v.attemptBindingKind === 'legacy_manual_portal_observation' && <div className="space-y-3">
      <Button variant="outline" className="min-h-11 w-full whitespace-normal sm:w-auto" disabled={busy} aria-expanded={correcting}
        onClick={() => { setCorrectionOpen(!correctionOpen); setReviewedPayment(false); setFeedback(''); }}>
        {correcting ? 'Cancel machine correction review' : 'Provider evidence shows a different machine?'}
      </Button>
      {correcting && <RefundMachineCorrectionReview overview={v} context={machineContext} onBusyChange={setBusy} />}
    </div>}
    {!v.receipt ? (!correcting && <div className="space-y-3">
      <Label htmlFor="refund-receipt-reference">Exact Nayax original reference</Label>
      <Input id="refund-receipt-reference" value={reference} onChange={(e) => { setReference(e.target.value); setReviewedPayment(false); }} placeholder={`DTM:NAYAX-${v.originalTransactionId}`} disabled={busy} className="min-h-11" />
      <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6">
        <input type="checkbox" className="mt-1.5 h-4 w-4 shrink-0" checked={reviewedPayment} onChange={(e) => setReviewedPayment(e.target.checked)} disabled={busy} />
        <span>I verified this exact account, machine and original in Nayax: status is Refunded (62), the refunded amount is the full {amount}, and the actual settlement time is unavailable. The sale/update date is not a refund date.</span>
      </label>
      <Button className="min-h-11 w-full whitespace-normal sm:w-auto" disabled={busy || !v.canRecord || !reviewedPayment || reference !== `DTM:NAYAX-${v.originalTransactionId}`} onClick={() => void save('record')}>{busy ? 'Saving evidence…' : 'Record full-refund observation only'}</Button>
    </div>) : <div className="space-y-3">
      <p className="text-sm text-pretty">Observed {new Date(v.receipt.observedAt).toLocaleString()}. This is not the settlement time. Accounting-date review stays with Refund Operations; do not retry payment.</p>
      {v.receipt.noticeAdopted || historicalSavedCaseId === v.caseId ? <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950" role="status">
        <p className="font-medium">{v.receipt.noticeSource === 'current_operator_mailbox' ? 'Customer notified · sent email reviewed in operator mailbox; managers copied'
          : v.receipt.noticeSource === 'historical_owner_mailbox' || historicalSavedCaseId === v.caseId ? historicalOwnerNoticeRecordedLabel : 'Customer already updated · existing notice verified'}</p>
        <p className="mt-1">No second message will be sent.{v.receipt.noticeSource === 'historical_owner_mailbox' || historicalSavedCaseId === v.caseId
          ? ' The original SENT time is preserved. Provider delivery and support-thread ownership were not verified.'
          : v.receipt.managerCcVerified === false ? ' Historical manager CC was not verified; the original message remains unchanged.' : ''}</p>
      </div> : !demo && v.completionNotice?.messageId ? <RefundReceiptCompletionNotice overview={v} onBusyChange={setBusy} /> : <>
        <Label htmlFor="refund-receipt-notice">Review an existing sent notice for this claim</Label>
        <select id="refund-receipt-notice" value={messageId} onChange={(e) => { setMessageId(e.target.value); setReviewedNotice(false); }} disabled={busy} className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Choose a verified sent message</option>
          {v.noticeChoices.map((n) => <option key={n.id} value={n.id}>{new Date(n.sentAt).toLocaleString()} · {n.subject || '(No subject)'}</option>)}
        </select>
        {v.noticeChoices.length === 0 && <p className="text-sm text-muted-foreground">No eligible support-mailbox notice is linked yet. Do not resend to create evidence.</p>}
        {selected && <div className="max-h-72 overflow-y-auto rounded-lg bg-muted/30 p-3 text-sm"><p className="font-medium break-words">{selected.subject}</p><p className="mt-2 whitespace-pre-wrap break-words">{selected.plainBody}</p></div>}
        <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6">
          <input type="checkbox" className="mt-1.5 h-4 w-4 shrink-0" checked={reviewedNotice} onChange={(e) => setReviewedNotice(e.target.checked)} disabled={busy || !selected} />
          <span>I read this sent notice and confirm it states the full {amount} refund for {v.caseReference}, original {v.originalTransactionId}. Another claim in the same thread is not being marked complete.</span>
        </label>
        <Button className="min-h-11 w-full whitespace-normal sm:w-auto" variant="outline" disabled={busy || !selected || !reviewedNotice} onClick={() => void save('adopt')}>{busy ? 'Verifying notice…' : 'Use existing notice · do not send again'}</Button>
        {!demo && v.historicalOwnerNoticeAvailable && <div className="space-y-4 border-t border-border pt-4">
          <Button variant="ghost" className="min-h-11 w-full whitespace-normal sm:w-auto" disabled={busy} aria-expanded={historicalNoticeOpen}
            onClick={() => { setHistoricalNoticeOpen(!historicalNoticeOpen); setReviewedNotice(false); }}>
            {historicalNoticeOpen ? 'Close historical notice review' : 'Already notified from your own mailbox before the cutoff?'}
          </Button>
          {historicalNoticeOpen && <RefundHistoricalOwnerNoticeReview overview={v} onBusyChange={setBusy} onSaved={() => setHistoricalSavedCaseId(v.caseId)} />}
        </div>}
        {!demo && v.completionNotice && <RefundReceiptCompletionNotice overview={v} onBusyChange={setBusy} />}
      </>}
    </div>}
    {feedback && <p role="status" aria-live="polite" className="text-sm text-pretty">{feedback}</p>}
    {!demo && <Button variant="ghost" className="min-h-11" disabled={busy || query.isFetching} onClick={() => { setReviewedPayment(false); setReviewedNotice(false); void query.refetch(); }}>Refresh saved evidence</Button>}
    {demo && <p className="text-xs text-muted-foreground">Synthetic local preview only. No backend requests or real messages.</p>}
  </section>;
}
