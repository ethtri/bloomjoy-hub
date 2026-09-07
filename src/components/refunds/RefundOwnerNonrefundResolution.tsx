import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { buildOwnerResolutionRequest, fetchOwnerResolutionContext, saveOwnerResolution,
  type OwnerResolutionFields } from '@/lib/refundOwnerResolution';
import { createOwnerResolutionSubmission } from '@/lib/ownerResolutionSubmission';

export function RefundOwnerNonrefundResolution({ caseId, onSaved }: { caseId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<OwnerResolutionFields>({ intentId: crypto.randomUUID(), providerMessageId: '',
    providerThreadId: '', originalSentAt: '', exactSentBody: '' });
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [submission] = useState(() => createOwnerResolutionSubmission(saveOwnerResolution));
  const contextQuery = useQuery({ queryKey: ['refund-owner-resolution-context', caseId],
    queryFn: () => fetchOwnerResolutionContext(caseId), enabled: open, retry: false, staleTime: 0 });
  const ready = Boolean(retryAvailable || (contextQuery.data?.canAdopt && /^[a-f0-9]{8,64}$/.test(fields.providerMessageId) &&
    /^[a-f0-9]{8,64}$/.test(fields.providerThreadId) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(fields.originalSentAt) && fields.exactSentBody.trim()));
  const update = (key: keyof OwnerResolutionFields, value: string) => { submission.reset(); setRetryAvailable(false); setFields({ ...fields, [key]: value }); setReviewed(false); setFeedback(''); };
  async function save() {
    if (!reviewed || !ready || busy) return;
    setBusy(true); setFeedback('');
    try {
      await submission.submit(async () => {
        const refreshed = await contextQuery.refetch();
        if (!refreshed.data) throw new Error('Unavailable');
        return await buildOwnerResolutionRequest(refreshed.data, fields);
      });
      setRetryAvailable(false);
      setFeedback('Saved on this case. Nothing was sent and no payment was recorded.');
      onSaved();
    } catch {
      setRetryAvailable(submission.hasRetained());
      setFeedback('The result was not confirmed. Keep this exact review open and check the saved case before trying the same action again. Nothing was sent.');
    } finally { setBusy(false); }
  }
  return <details className="mt-4 border-t border-border pt-4" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}
    data-testid="refund-owner-nonrefund-resolution">
    <summary className="min-h-11 cursor-pointer select-none py-2 text-sm font-medium">Record an already-sent non-refund resolution</summary>
    <div className="mt-3 space-y-4 rounded-lg border border-border bg-muted/30 p-4">
      <div><h4 className="font-semibold">Review the exact message already in your Sent folder</h4>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">Use this only when you already told this customer that Bloomjoy does not operate the machine. This records your observation on the same case. It does not send another message, record a refund, or verify email delivery.</p></div>
      {retryAvailable ? <p role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-950">The first result was uncertain. The action below checks the exact same saved case, source, and intent. It cannot create a new resolution.</p> :
       contextQuery.isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading the current case scope…</p> :
        contextQuery.data ? <dl className="grid min-w-0 gap-2 rounded-md bg-background p-3 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">Case</dt><dd className="font-medium">{contextQuery.data.caseReference}</dd></div>
          <div className="min-w-0"><dt className="text-muted-foreground">Customer</dt><dd className="truncate font-medium">{contextQuery.data.recipientEmail}</dd></div>
          <div className="min-w-0"><dt className="text-muted-foreground">Your verified mailbox</dt><dd className="truncate font-medium">{contextQuery.data.ownerMailboxEmail}</dd></div>
        </dl> : <p role="alert" className="text-sm text-destructive">Current Refund Operations access or an eligible undecided case is required.</p>}
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        {([['providerMessageId','Sent message reference','Lowercase Gmail message ID from the retained source evidence'],
          ['providerThreadId','Sent conversation reference','Lowercase Gmail thread ID from the retained source evidence'],
          ['originalSentAt','Original sent time (UTC)','YYYY-MM-DDTHH:mm:ssZ']] as const).map(([key,label,hint])=><div className="min-w-0 space-y-2" key={key}>
          <Label htmlFor={`owner-resolution-${key}`}>{label}</Label><Input id={`owner-resolution-${key}`} value={fields[key]} disabled={busy}
            autoComplete="off" maxLength={64} className="min-h-11" aria-describedby={`owner-resolution-${key}-hint`}
            onChange={(e)=>update(key,e.target.value)} /><p id={`owner-resolution-${key}-hint`} className="text-xs leading-5 text-muted-foreground">{hint}</p>
        </div>)}
        <div className="min-w-0 space-y-2 sm:col-span-2"><Label htmlFor="owner-resolution-body">Exact sent response</Label>
          <Textarea id="owner-resolution-body" value={fields.exactSentBody} disabled={busy} rows={7} maxLength={12000}
            aria-describedby="owner-resolution-body-hint" onChange={(e)=>update('exactSentBody',e.target.value)} />
          <p id="owner-resolution-body-hint" className="text-xs leading-5 text-muted-foreground">Paste the complete retained sent body. Its fingerprint is computed in this browser; the message text is not uploaded or stored.</p></div>
      </div>
      <label className="flex min-h-11 items-start gap-3 py-2 text-sm leading-6"><input type="checkbox" className="mt-1.5 h-4 w-4 shrink-0"
        checked={reviewed} disabled={busy || !ready} onChange={(e)=>setReviewed(e.target.checked)} /><span>I verified the exact case, customer, Sent message references, original sent time, and complete response. The response says Bloomjoy does not operate the machine. I understand this records my observation, not confirmed delivery.</span></label>
      <Button variant="outline" className="min-h-11 w-full whitespace-normal sm:w-auto" disabled={!reviewed || !ready || busy} onClick={save}>
        {busy ? 'Checking the saved resolution…' : retryAvailable ? 'Check the same saved resolution' : 'Record already-sent resolution'}</Button>
      {feedback && <p role="status" aria-live="polite" className="text-sm leading-6">{feedback}</p>}
    </div>
  </details>;
}
