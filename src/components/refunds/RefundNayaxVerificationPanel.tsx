import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabaseClient } from '@/lib/supabaseClient';

type VerificationView = {
  visible: boolean; caseId: string; caseVersion: number; originalTransactionId: string;
  accountScope: string; providerMachineId: string; siteId: number;
  machineAuthorizationTimeRaw: string | null; originalAmountCents: number;
  currencyCode: string; verificationId: string | null; expiresAt: string | null;
};

export function RefundNayaxVerificationPanel({ caseId, onSaved }: {
  caseId: string; onSaved: () => Promise<unknown>;
}) {
  const [rawTime, setRawTime] = useState('');
  const [remaining, setRemaining] = useState('');
  const [reviewedSnapshot, setReviewedSnapshot] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [now, setNow] = useState(Date.now());
  const query = useQuery({ queryKey: ['refund-nayax-verification', caseId], staleTime: 0, retry: false,
    queryFn: async () => {
      const { data, error } = await supabaseClient.rpc('admin_get_refund_nayax_execution_verification', { p_case_id: caseId });
      if (error || !data || typeof data.visible !== 'boolean' || data.payloadRedacted !== true) throw new Error('Verification unavailable');
      if (data.visible && (data.caseId !== caseId || !Number.isSafeInteger(data.caseVersion) ||
        !Number.isSafeInteger(data.originalAmountCents) || data.originalAmountCents <= 0 || data.currencyCode !== 'USD')) throw new Error('Verification unavailable');
      return data as VerificationView;
    } });
  const v = query.data;
  useEffect(() => {
    setRawTime(v?.machineAuthorizationTimeRaw ?? ''); setRemaining(''); setReviewedSnapshot('');
  }, [caseId, v?.caseVersion, v?.machineAuthorizationTimeRaw]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 10_000); return () => window.clearInterval(timer); }, []);
  const snapshot = v ? JSON.stringify([v.caseId, v.caseVersion, v.originalTransactionId, v.accountScope,
    v.providerMachineId, v.siteId, v.originalAmountCents, rawTime, remaining]) : '';
  const reviewed = Boolean(snapshot) && reviewedSnapshot === snapshot;
  const remainingCents = /^\d+(?:\.\d{1,2})?$/.test(remaining) ? Math.round(Number(remaining) * 100) : null;
  const verified = Boolean(v?.verificationId && v.expiresAt && Date.parse(v.expiresAt) > now);
  async function save() {
    if (!v || busy || !reviewed || remainingCents !== v.originalAmountCents || !rawTime) return;
    setBusy(true); setFeedback('');
    try {
      const { data, error } = await supabaseClient.rpc('admin_record_refund_nayax_execution_verification', {
        p_case_id: v.caseId, p_expected_case_version: v.caseVersion, p_original_transaction_id: v.originalTransactionId,
        p_account_scope: v.accountScope, p_provider_machine_id: v.providerMachineId, p_site_id: v.siteId,
        p_machine_auth_time_raw: rawTime, p_original_amount_cents: v.originalAmountCents,
        p_refunded_amount_cents: 0, p_remaining_amount_cents: remainingCents, p_currency_code: v.currencyCode,
        p_evidence_reference: `DTM:NAYAX-${v.originalTransactionId}`,
        p_no_pending_refund_reviewed: true, p_exclusive_execution_reviewed: true,
      });
      if (error || data?.status !== 'recorded' || data.paymentSent !== false || data.customerMessageSent !== false) throw new Error('Not verified');
      setReviewedSnapshot(''); setNow(Date.now());
      await query.refetch(); await onSaved();
      setFeedback('Purchase check saved. Use the Refund action to confirm the payment.');
    } catch {
      setReviewedSnapshot('');
      setFeedback('The current purchase could not be verified. Refresh this case and check the purchase in Nayax again.');
    } finally { setBusy(false); }
  }
  if (query.isLoading) return <p role="status" className="mt-4 text-sm">Loading purchase verification…</p>;
  if (query.isError) return <div className="mt-4 text-sm" role="alert">
    <p>Purchase verification is unavailable.</p>
    <Button variant="outline" className="mt-2 min-h-11" onClick={() => void query.refetch()}>Reload purchase check</Button>
  </div>;
  if (!v?.visible) return null;
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: v.currencyCode }).format(v.originalAmountCents / 100);
  return <section aria-label="Current Nayax purchase check" className="mt-4 space-y-3 border-t border-border pt-4 text-sm">
    <h3 className="font-semibold">{verified ? 'Purchase verified for this refund' : 'Check the purchase in Nayax'}</h3>
    {verified ? <p role="status">The check expires at {new Date(v.expiresAt!).toLocaleTimeString()}. Complete the existing Refund confirmation while it is current.</p> : <>
      <p className="max-w-prose leading-6">Open this purchase and its refund history in Nayax now. Confirm it still has the full {amount} available to refund. An hourly report cannot establish the current balance.</p>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Original purchase</dt><dd className="break-all font-medium">{v.originalTransactionId}</dd></div>
        <div><dt className="text-muted-foreground">Account / machine / site</dt><dd className="break-all">{v.accountScope} / {v.providerMachineId} / {v.siteId}</dd></div>
      </dl>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="nayax-current-machine-time">Machine AuTime in Nayax</Label>
          <Input id="nayax-current-machine-time" value={rawTime} onChange={(e) => setRawTime(e.target.value)} disabled={busy} className="min-h-11" placeholder="YYYY-MM-DDTHH:mm:ss.sss" />
          <p className="text-xs leading-5 text-muted-foreground">Copy the machine authorization time exactly, including decimals. Use the Machine AuTime field.</p>
        </div>
        <div className="space-y-1"><Label htmlFor="nayax-current-remaining">Amount still refundable ({v.currencyCode})</Label>
          <Input id="nayax-current-remaining" inputMode="decimal" value={remaining} onChange={(e) => setRemaining(e.target.value)} disabled={busy} className="min-h-11" placeholder={(v.originalAmountCents / 100).toFixed(2)} />
          {remaining && remainingCents !== v.originalAmountCents && <p role="alert" className="text-sm text-destructive">This purchase needs a refund-history review before the full refund can proceed.</p>}
        </div>
      </div>
      <label className="flex min-h-11 items-start gap-3 py-2 leading-6">
        <input type="checkbox" className="mt-1.5 h-4 w-4 shrink-0" checked={reviewed} disabled={busy} onChange={(e) => setReviewedSnapshot(e.target.checked ? snapshot : '')} />
        <span>I just checked this exact account, machine and purchase: no amount has already been refunded and no refund is pending. I have coordinated with anyone using Nayax so they will not refund this purchase during this action.</span>
      </label>
      <Button variant="outline" className="min-h-11 w-full whitespace-normal sm:w-auto" disabled={busy || !reviewed || !rawTime || remainingCents !== v.originalAmountCents} onClick={() => void save()}>{busy ? 'Saving purchase check…' : 'Save purchase check'}</Button>
      <p className="text-xs leading-5 text-muted-foreground">Valid for five minutes. Bloomjoy cannot lock actions made directly in Nayax.</p>
    </>}
    {feedback && <p role="status" aria-live="polite">{feedback}</p>}
  </section>;
}
