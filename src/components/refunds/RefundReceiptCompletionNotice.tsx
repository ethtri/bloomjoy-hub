import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { buildReceiptCompletionRequest, refundReceiptReviewSnapshot, refreshRefundReceiptViews, type RefundReceiptOverview } from '@/lib/refundAuthoritativeReceipt';
import { queueRefundReceiptCompletion } from '@/lib/refundAuthoritativeReceiptApi';

export function RefundReceiptCompletionNotice({ overview, onBusyChange }: {
  overview: RefundReceiptOverview; onBusyChange: (busy: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [reviewedSnapshot, setReviewedSnapshot] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [intentId] = useState(() => crypto.randomUUID());
  const notice = overview.completionNotice;
  if (!notice) return null;
  const snapshot = refundReceiptReviewSnapshot(overview);
  const reviewed = reviewedSnapshot === snapshot;
  const deliveryLabels = {
    unknown: 'Completion delivery needs review', sent: 'Completion sent in the customer thread',
    accepted: 'Completion accepted by the email provider', deferred: 'Completion email delayed',
    delivered: 'Completion email delivered', failed: 'Completion delivery failed',
    bounced: 'Completion email bounced', complained: 'Completion email reported as unwanted',
  };
  const label = notice.state === 'queued' || notice.state === 'claimed' ? 'Completion queued for delivery'
    : notice.state === 'delivery_unknown' ? 'Completion delivery needs review'
    : notice.state === 'failed' ? deliveryLabels[notice.deliveryState] === deliveryLabels.unknown
      ? 'Completion delivery failed' : deliveryLabels[notice.deliveryState]
    : deliveryLabels[notice.deliveryState];
  async function queue() {
    if (busy || !reviewed) return;
    setBusy(true); onBusyChange(true); setFeedback('');
    try {
      await queueRefundReceiptCompletion(buildReceiptCompletionRequest(overview, intentId, reviewed));
      setReviewedSnapshot('');
      await refreshRefundReceiptViews((queryKey) => queryClient.invalidateQueries({ queryKey }));
      setFeedback('The completion message is saved in the delivery queue. The refund will not be repeated.');
    } catch {
      setReviewedSnapshot('');
      setFeedback('Reload the saved message state before trying again. An interrupted response may already have queued this completion.');
    } finally { setBusy(false); onBusyChange(false); }
  }
  return <section className="space-y-3 border-t border-border pt-4" data-testid="refund-receipt-completion-notice" aria-label="Confirmed-refund customer message">
    <h4 className="font-medium">{notice.messageId ? label : 'Customer still needs a refund confirmation?'}</h4>
    {notice.messageId ? <p role="status" className="text-sm leading-6">This refund has one saved completion message. Review its delivery record if needed. Accounting-date review continues separately.</p> : <>
      <p className="text-sm leading-6">First review the customer thread and any earlier sent notices above. Use an existing confirmation when this exact refund was already communicated.</p>
      <div className="rounded-lg bg-muted/30 p-3 text-sm leading-6">
        <p className="break-all">To: {notice.recipientEmail}</p>
        <p className="mt-2 font-medium">{notice.subject}</p>
        <p className="mt-2 whitespace-pre-wrap break-words">{notice.body}</p>
      </div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6">
        <input type="checkbox" className="mt-1.5 h-4 w-4 shrink-0" checked={reviewed} disabled={busy || !notice.canQueue}
          onChange={(event) => setReviewedSnapshot(event.target.checked ? snapshot : '')} />
        <span>I reviewed the sent correspondence for {overview.caseReference}. This exact refund has no prior completion notice, and I approve the message shown above. Other operators will not send a separate confirmation.</span>
      </label>
      <Button className="min-h-11 w-full whitespace-normal sm:w-auto" disabled={busy || !notice.canQueue || !reviewed} onClick={() => void queue()}>
        {busy ? 'Saving completion message…' : 'Send refund confirmation'}
      </Button>
      {!notice.canQueue && <p className="text-sm text-muted-foreground">An existing notice or unresolved message needs review first.</p>}
    </>}
    {feedback && <p role="status" className="text-sm leading-6">{feedback}</p>}
  </section>;
}
