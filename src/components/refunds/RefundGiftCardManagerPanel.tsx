import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { RefundGiftCardTerms } from './RefundGiftCardTerms';
import { fetchRefundGiftCardManagerContext, decideRefundGiftCard, resendRefundGiftCard } from '@/lib/refundGiftCardApi';
import { giftCardAmount, giftCardExpiry, giftCardStatusCopy } from '@/lib/refundGiftCard';
import type { RefundCaseRecord } from '@/lib/refundOperations';
import { parseManagerRefundAmount, roundedManagerGiftAmount } from '@/lib/refundManagerAmount';

export function RefundGiftCardManagerPanel({ refundCase }: { refundCase: RefundCaseRecord }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['refund-gift-card-manager', refundCase.id],
    queryFn: () => fetchRefundGiftCardManagerContext(refundCase.id), refetchInterval: 15000 });
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [decided, setDecided] = useState(false);
  const [recipient, setRecipient] = useState<string | null>(null);
  const [resendIntent, setResendIntent] = useState(() => crypto.randomUUID());
  const [resent, setResent] = useState(false);
  const [amountDraft, setAmountDraft] = useState<string | null>(null);
  const amountValue = amountDraft ?? ((query.data?.affected_amount ?? refundCase.paymentAmountCents) / 100).toFixed(2);
  const affectedAmountCents = parseManagerRefundAmount(amountValue);
  const proposedValue = affectedAmountCents ? roundedManagerGiftAmount(affectedAmountCents) : null;
  const resend = async () => {
    if (pending || query.data?.can_resend !== true) return;
    const email = (recipient ?? query.data.customer_email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Enter a valid customer email.'); return; }
    setPending(true); setError(''); setResent(false);
    try {
      await resendRefundGiftCard(refundCase.id, resendIntent, email);
      setResent(true); setResendIntent(crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: ['refund-gift-card-manager', refundCase.id] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to resend this gift card.'); }
    finally { setPending(false); }
  };
  const decide = async (approve: boolean) => {
    if (pending || decided || query.data?.can_decide !== true || (approve && !affectedAmountCents)) return;
    setPending(true); setError('');
    try {
      await decideRefundGiftCard(refundCase.id, approve, notes.trim(), approve ? affectedAmountCents! : undefined);
      setDecided(true);
      await queryClient.invalidateQueries({ queryKey: ['refund-gift-card-manager', refundCase.id] });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['admin-refund-operations-overview'] }), queryClient.invalidateQueries({ queryKey: ['refund-portal-queue-projection'] }), queryClient.invalidateQueries({ queryKey: ['refund-manager-work-projection'] })]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save this decision.'); }
    finally { setPending(false); }
  };
  const card = query.data;
  return <section data-testid="refund-gift-card-manager" className="space-y-5 rounded-xl border border-border bg-card p-4 sm:p-5">
    <h3 className="text-xl font-semibold">{card?.state === 'manager_review' ? 'Review gift card request' : 'Gift card request'}</h3>
    <div>
      <p className="text-sm font-medium">{refundCase.publicReference} · {refundCase.customerName || refundCase.customerEmail}</p>
      <p className="mt-2 whitespace-pre-line break-words text-sm leading-6">{refundCase.issueSummary || 'No additional comments.'}</p>
      <p className="mt-2 text-sm text-muted-foreground">Purchase: {giftCardAmount(refundCase.paymentAmountCents, 'USD')} · {refundCase.locationName} · {refundCase.paymentMethod}</p>
    </div>
    {query.isPending && <p role="status">Loading the gift card and previous issuance…</p>}
    {(query.error || error) && <p role="alert" className="text-sm text-destructive">{error || (query.error as Error).message} <Button variant="link" onClick={() => void query.refetch()}>Refresh review</Button></p>}
    {card && <>
      {card.review_reasons?.length > 0 && <div className="rounded-lg bg-pink-50 p-3 text-sm leading-6">
        <p className="font-semibold">Review reasons</p>
        <ul className="list-inside list-disc">{card.review_reasons.map((reason) => <li key={reason}>{({ partial_items: 'Customer received fewer items', expected_cash_change: 'Customer expected cash change', high_value: 'Gift card exceeds $25', repeat_request: 'Previous gift card request', repeat_customer: 'Previous gift card request' } as Record<string, string>)[reason] ?? reason.replace(/_/g, ' ')}</li>)}</ul>
      </div>}
      {card.cash_inserted_amount != null && <p className="text-sm leading-6">Cash inserted: {giftCardAmount(card.cash_inserted_amount, card.currency)} · Expected change: {giftCardAmount(card.expected_change_amount ?? 0, card.currency)}</p>}
      <div className="border-t border-border pt-4">
        <h4 className="mb-2 text-sm font-semibold">{card.can_decide ? 'Proposed gift card value' : 'Gift card terms'}</h4>
        {card.can_decide ? <>
          <p className="text-xl font-semibold">{proposedValue ? giftCardAmount(proposedValue, card.currency) : 'Enter a valid gift amount'}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">This previews the value only. Approval verifies an available gift card and its locations and expiry before assigning it. Verified terms appear here after the decision.</p>
        </> : <RefundGiftCardTerms offer={card} />}
      </div>
      <div className="border-t border-border pt-4 text-sm leading-6">
        <h4 className="font-semibold">Previous gift cards in the last 12 months</h4>
        <p>{card.prior_issued_count} issued{card.latest_issued_at ? ` · Latest: ${giftCardExpiry(card.latest_issued_at)}` : ''}</p>
        {card.previous_issuance && <p>{giftCardAmount(card.previous_issuance.value, card.previous_issuance.currency)} · {card.previous_issuance.public_reference} · {card.previous_issuance.eligible_locations.join(', ')}</p>}
      </div>
      {card.can_decide && !decided ? <div className="space-y-3 border-t border-border pt-4">
        <Label htmlFor="gift-card-affected-amount">Affected purchase or courtesy amount (USD)</Label>
        <Input id="gift-card-affected-amount" inputMode="decimal" value={amountValue} disabled={pending}
          onChange={(event) => setAmountDraft(event.target.value)} aria-invalid={!affectedAmountCents} aria-describedby="gift-card-amount-help" />
        <p id="gift-card-amount-help" className="text-sm leading-6 text-muted-foreground">The gift card rounds up to the next $5. The preview and approval below show the final gift card value. One decision covers all review reasons.</p>
        {!affectedAmountCents && <p role="alert" className="text-sm text-destructive">Enter a positive amount with at most two decimal places.</p>}
        <Label htmlFor="gift-card-decision-notes">Decision note (required if denying)</Label>
        <Textarea id="gift-card-decision-notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={800} />
        <p className="text-sm text-muted-foreground">Approval assigns the gift card and sends its email automatically.</p>
        <div className="flex flex-wrap gap-3">
          <Button className="min-h-11" disabled={pending || !proposedValue} onClick={() => void decide(true)}>{pending ? 'Saving decision…' : proposedValue ? `Approve ${giftCardAmount(proposedValue, card.currency)} gift card` : 'Enter a valid gift amount'}</Button>
          <Button variant="outline" className="min-h-11" disabled={pending || !notes.trim()} onClick={() => void decide(false)}>Deny request</Button>
        </div>
      </div> : <p role="status" className="border-t border-border pt-4 text-sm leading-6">{decided ? 'Decision saved. The system will finish automatically.' : giftCardStatusCopy(card).next}</p>}
      {card.state === 'issued' && card.can_resend && <div className="space-y-3 border-t border-border pt-4">
        <Label htmlFor="gift-card-recipient">Customer email</Label>
        <Input id="gift-card-recipient" type="email" value={recipient ?? card.customer_email} disabled={pending}
          onChange={(event) => { setRecipient(event.target.value); setResendIntent(crypto.randomUUID()); setResent(false); }} />
        <p className="text-sm text-muted-foreground">Send the same gift card again, or correct the email. This does not issue another card.</p>
        <Button className="min-h-11" variant="outline" disabled={pending} onClick={() => void resend()}>{pending ? 'Sending…' : 'Resend gift card email'}</Button>
        {resent && <p role="status" className="text-sm">The same gift card email is queued.</p>}
      </div>}
    </>}
  </section>;
}
