import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchRefundReceiptOverview, saveRefundReceiptEvidence } from '@/lib/refundAuthoritativeReceiptApi';
import { refreshRefundReceiptViews, type RefundReceiptOverview } from '@/lib/refundAuthoritativeReceipt';
import { buildHistoricalOwnerNoticeRequest, historicalOwnerNoticeSnapshot, type HistoricalOwnerNoticeFields } from '@/lib/refundHistoricalOwnerNotice';

export const historicalOwnerNoticeRecordedLabel = 'Historical owner-mailbox notice recorded — operator reviewed; no manager CC';
type Props = { overview: RefundReceiptOverview; onBusyChange: (busy: boolean) => void; onSaved: () => void };
export function RefundHistoricalOwnerNoticeReview({ overview: v, onBusyChange, onSaved }: Props) {
  const client = useQueryClient();
  const [fields, setFields] = useState<HistoricalOwnerNoticeFields>({ providerMessageId: '', providerThreadId: '', originalSentAt: '', recipientEmail: '', reviewedMessageDigest: '' });
  const [reviews, setReviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [feedback, setFeedback] = useState('');
  const snapshot = historicalOwnerNoticeSnapshot(v, fields);
  const reviewKeys = ['owned', 'recipient', 'claim'] as const;
  const reviewed = reviewKeys.every((key) => reviews[key] === snapshot);
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: v.currencyCode }).format(v.originalAmountCents / 100);
  let ready = false;
  try { buildHistoricalOwnerNoticeRequest(v, fields, true); ready = true; } catch { /* Incomplete form stays disabled. */ }
  const update = (key: keyof HistoricalOwnerNoticeFields, value: string) => { setFields({ ...fields, [key]: value }); setReviews({}); setFeedback(''); };
  async function save() {
    if (!ready || !reviewed || busy || saved) return;
    setBusy(true); onBusyChange(true); setFeedback('');
    try {
      const fresh = await fetchRefundReceiptOverview(v.caseId);
      if (!fresh || historicalOwnerNoticeSnapshot(fresh, fields) !== snapshot) throw new Error('Changed review');
      await saveRefundReceiptEvidence(buildHistoricalOwnerNoticeRequest(fresh, fields, true));
      setSaved(true); setReviews({}); onSaved();
      try { await refreshRefundReceiptViews((queryKey) => client.invalidateQueries({ queryKey })); }
      catch { setFeedback('Evidence was saved. Refresh the case to load its current progress; do not repeat the action.'); }
    } catch {
      setReviews({});
      setFeedback('The observation was not confirmed. Refresh saved evidence and check current access before reviewing again. Nothing was sent.');
      try { await refreshRefundReceiptViews((queryKey) => client.invalidateQueries({ queryKey })); } catch { /* Keep the failed review unchecked. */ }
    } finally { setBusy(false); onBusyChange(false); }
  }
  return <div className="space-y-4" data-testid="refund-historical-owner-notice-review">
    <div><h4 className="font-semibold">Review a historical notice in your own mailbox</h4>
      <p className="mt-1 text-sm leading-6">For messages already in your Gmail Sent folder by September 2, 2026, 19:51:58 UTC. Your current verified sign-in must own that mailbox. This records your observation, not provider-confirmed delivery or a support-mailbox thread.</p></div>
    {saved ? <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm leading-6 text-emerald-950">{historicalOwnerNoticeRecordedLabel}. Nothing was sent. Delivery and accounting dates remain unverified.</p> : <>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        {([
          ['providerMessageId', 'Gmail message ID', 'Lowercase API message ID, not an RFC Message-ID'],
          ['providerThreadId', 'Gmail thread ID', 'Lowercase API thread ID, not the browser address'],
          ['originalSentAt', 'Original sent time (UTC)', 'YYYY-MM-DDTHH:mm:ssZ'],
          ['recipientEmail', 'Only customer recipient', 'Exact address shown on the original message'],
          ['reviewedMessageDigest', 'Reviewed message fingerprint', '64-character SHA-256 from the private evidence packet'],
        ] as const).map(([key, label, hint]) => <div className={`min-w-0 space-y-2 ${key === 'reviewedMessageDigest' ? 'sm:col-span-2' : ''}`} key={key}>
          <Label htmlFor={`historical-notice-${key}`}>{label}</Label>
          <Input id={`historical-notice-${key}`} value={fields[key]} autoComplete="off" maxLength={key === 'recipientEmail' ? 320 : 64}
            disabled={busy} className="min-h-11" onChange={(e) => update(key, e.target.value)} aria-describedby={`historical-notice-${key}-hint`} />
          <p id={`historical-notice-${key}-hint`} className="text-xs leading-5 text-muted-foreground">{hint}</p>
        </div>)}
      </div>
      {([
        ['owned', 'I opened the original message in the Sent folder of the mailbox owned by my current verified sign-in. I checked the message ID, thread, original sent time and reviewed-message fingerprint.'],
        ['recipient', 'I verified this exact customer is the only recipient. The original message has no CC or BCC, and no manager CC is being claimed.'],
        ['claim', `The notice confirms the full ${amount} for ${v.caseReference}. I reviewed that claim and amount against this confirmed receipt. Any other claim in the thread remains separate; this does not assert the email contained a Nayax transaction number.`],
      ] as const).map(([key, label]) => <label key={key} className="flex min-h-11 items-start gap-3 py-2 text-sm leading-6">
        <input type="checkbox" className="mt-1.5 h-4 w-4 shrink-0" checked={reviews[key] === snapshot} disabled={busy || !ready}
          onChange={(e) => setReviews({ ...reviews, [key]: e.target.checked ? snapshot : '' })} /><span>{label}</span>
      </label>)}
      <Button variant="outline" className="min-h-11 w-full whitespace-normal sm:w-auto" disabled={busy || !ready || !reviewed}
        onClick={save}>{busy ? 'Recording historical evidence…' : 'Record historical notice only'}</Button>
    </>}
    {feedback && <p role="status" aria-live="polite" className="text-sm leading-6">{feedback}</p>}
  </div>;
}
