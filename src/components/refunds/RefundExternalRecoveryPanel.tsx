import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabaseClient } from '@/lib/supabaseClient';
import { refreshRefundReceiptViews } from '@/lib/refundAuthoritativeReceipt';
import { buildExternalRecoveryEvidence, emptyExternalRecoveryForm, parseExternalRecoveryOptions,
  type ExternalRecoveryForm } from '@/lib/refundExternalRecovery';

export function RefundExternalRecoveryPanel({ caseId, onReviewChange }: { caseId: string; onReviewChange: (active: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyExternalRecoveryForm });
  const [reviews, setReviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [feedback, setFeedback] = useState('');
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['refund-external-recovery', caseId], enabled: open,
    queryFn: async () => {
      const { data, error } = await supabaseClient.rpc('admin_get_refund_external_recovery_options', { p_case_id: caseId });
      if (error) throw error;
      return parseExternalRecoveryOptions(data);
    }, retry: false, staleTime: 0, gcTime: 0 });
  const v = query.data;
  const snapshot = JSON.stringify([v, form]);
  const reviewed = [0, 1, 2].every(index => reviews[index] === snapshot);
  useEffect(() => { onReviewChange(open || saved); return () => onReviewChange(false); }, [open, saved, onReviewChange]);
  const change = (key: keyof ExternalRecoveryForm, value: string) => { setForm(f => ({ ...f, [key]: value })); setReviews([]); setFeedback(''); };
  let valid = false;
  try { if (v) { buildExternalRecoveryEvidence(v, form, reviewed); valid = true; } } catch { /* incomplete form */ }
  async function save() {
    if (!v || busy || saved) return;
    setBusy(true); setFeedback('');
    let committed = false;
    try {
      const evidence = buildExternalRecoveryEvidence(v, form, reviewed);
      const { data, error } = await supabaseClient.rpc('admin_reconcile_external_refund_and_notice', { p_case_id: caseId, p_evidence: evidence });
      if (error || !data || !['recorded', 'already_recorded'].includes(data.status) || data.paymentConfirmed !== true ||
        data.noticeAdopted !== true || data.customerMessageSent !== false || data.providerCallMade !== false || data.payloadRedacted !== true)
        throw new Error('Review could not be confirmed.');
      setSaved(true);
      committed = true;
      setFeedback('Refund and existing email recorded. Managers were copied. Accounting-date review remains internal.');
      await refreshRefundReceiptViews(key => queryClient.invalidateQueries({ queryKey: key }));
      await query.refetch();
    } catch {
      setFeedback(committed ? 'Evidence is saved. Reload the case to see its current status.' :
        'The result could not be confirmed. Reload this review before another action; no new refund or email is sent by this form.');
    } finally { setBusy(false); }
  }
  const field = (key: keyof ExternalRecoveryForm, label: string, placeholder?: string) => <div className="min-w-0 space-y-1.5" key={key}>
    <Label htmlFor={`external-refund-${key}`}>{label}</Label>
    <Input id={`external-refund-${key}`} value={form[key]} onChange={e => change(key, e.target.value)} placeholder={placeholder}
      disabled={busy} className="min-h-11" autoComplete="off" />
  </div>;
  return <section className="mt-4 space-y-4 border-t border-border pt-4" data-testid="refund-external-recovery">
    {!saved && !v?.recorded && <Button variant="outline" className="min-h-11 w-full whitespace-normal sm:w-auto" aria-expanded={open}
      disabled={busy} onClick={() => { setOpen(!open); setReviews([]); }}>{open ? 'Close existing-refund review' : 'Already refunded on a different machine?'}</Button>}
    {(saved || v?.recorded) ? <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm leading-6 text-emerald-950">
      Customer notified. Existing refund and operator-mailbox sent message are recorded, with managers copied. The original report is preserved.
    </p> : open && <>
      <p className="text-sm leading-6 text-muted-foreground">Record the refund and email you already verified. This updates the case without sending money or another message.</p>
      {query.isLoading ? <p role="status" className="text-sm">Loading current case and machine choices…</p> : query.isError ? <div role="alert" className="space-y-2 text-sm">
        <p>Recovery review is unavailable. Check your current machine access and reload.</p>
        <Button variant="outline" onClick={() => void query.refetch()}>Reload review</Button>
      </div> : !v?.available ? <p className="text-sm">This case is not eligible for this recovery. Review its existing payment and machine evidence in Refund Operations.</p> : <>
        <p className="text-sm font-medium">{v.caseReference} · {v.customerEmail}</p>
        <div className="space-y-1.5"><Label htmlFor="external-refund-machine">Verified purchase machine</Label>
          <select id="external-refund-machine" className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
            value={form.targetMachineId} disabled={busy} onChange={e => change('targetMachineId', e.target.value)}>
            <option value="">Choose the machine shown in Nayax</option>
            {v.targets?.map(t => <option key={t.machineId} value={t.machineId}>{t.machineLabel}</option>)}
          </select>
        </div>
        <fieldset className="space-y-3"><legend className="mb-2 text-sm font-semibold">Verified full refund</legend>
          <div className="grid gap-3 sm:grid-cols-2">{field('transactionId', 'Original transaction number')}{field('siteId', 'Nayax site number')}
            {field('machineTime', 'Purchase time shown on machine', 'YYYY-MM-DDTHH:MM:SS')}{field('amount', 'Full amount refunded (USD)', '32.10')}</div>
        </fieldset>
        <fieldset className="space-y-3"><legend className="mb-2 text-sm font-semibold">Existing sent email</legend>
          <p className="text-sm text-muted-foreground">Use the original message in your own mailbox. From and Reply-To must be Info; the recipient must be this customer.</p>
          <div className="grid gap-3 sm:grid-cols-2">{field('providerMessageId', 'Gmail message ID')}{field('providerThreadId', 'Gmail conversation ID')}
            {field('rfcMessageId', 'Original Message-ID header', '<message@example.com>')}{field('sentAt', 'Original sent time with time zone', 'YYYY-MM-DDTHH:MM:SSZ')}</div>
          {field('ccEmails', 'CC addresses on the sent email')}{field('subject', 'Original subject')}
          <div className="space-y-1.5"><Label htmlFor="external-refund-body">Original message text</Label>
            <Textarea id="external-refund-body" value={form.plainBody} onChange={e => change('plainBody', e.target.value)} disabled={busy} rows={7} /></div>
        </fieldset>
        <div className="space-y-1">{[
          'I verified Nayax shows Refunded (62) for the full amount on this original transaction.',
          'I verified the machine, card digits and purchase time against this customer’s report.',
          'I reviewed this original SENT email in my own mailbox: it confirms this case and full refund, and its CC includes every current machine manager.',
        ].map((label, index) => <label className="flex min-h-11 items-start gap-3 py-2 text-sm leading-6" key={label}>
          <input type="checkbox" className="mt-1.5 h-4 w-4 shrink-0" disabled={busy} checked={reviews[index] === snapshot}
            onChange={e => setReviews(old => { const next = [...old]; next[index] = e.target.checked ? snapshot : ''; return next; })} />{label}
        </label>)}</div>
        <Button disabled={busy || !valid} className="min-h-11 w-full whitespace-normal sm:w-auto" onClick={() => void save()}>
          {busy ? 'Recording verified evidence…' : 'Record existing refund and notice'}</Button>
      </>}
    </>}
    {feedback && <p role="status" className="text-sm leading-6">{feedback}</p>}
  </section>;
}
