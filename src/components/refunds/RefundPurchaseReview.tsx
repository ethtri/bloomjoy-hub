import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { NayaxLookupCandidate, RefundCaseRecord, RefundSelectedNayaxTransaction } from '@/lib/refundOperations';
import { getRefundPurchaseTimePresentation } from '@/lib/refundPurchaseTimePresentation';
import {
  getRefundCardNetworkLabel,
  getRefundMachineContextPresentation,
  getRefundReviewEvidence,
  getRefundSelectionPresentation,
} from '@/lib/refundReviewPresentation';
import {
  formatRefundDateTime,
  refundCandidateTimeMeaning,
  refundCandidateTimeSourceDetail,
} from '@/lib/refundTimePresentation';

type Props = {
  refundCase: RefundCaseRecord;
  candidate: NayaxLookupCandidate | null;
  selected: RefundSelectedNayaxTransaction | null;
  timezone: string | null;
  customerTime: string;
  customerTimeConfidence: string;
  customerPayment: string;
  customerDigitsSource: string;
  locallySelected: boolean;
};

const money = (amount: number | null | undefined, currency = 'USD') => {
  if (typeof amount !== 'number') return 'Not available';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency}`;
  }
};

export function RefundPurchaseReview({ refundCase, candidate, selected, timezone, customerTime,
  customerTimeConfidence, customerPayment, customerDigitsSource, locallySelected }: Props) {
  if (!candidate && !selected) return null;
  const evidence = getRefundReviewEvidence({ candidate, selected, customer: refundCase });
  const selection = getRefundSelectionPresentation({
    evidenceSource: selected?.evidenceSource,
    recommendationState: candidate?.recommendationState ?? refundCase.nayaxLookupSummary?.recommendationState,
    locallySelected,
    events: refundCase.events,
  });
  const time = getRefundPurchaseTimePresentation({ candidate, selected, venueTimezone: timezone });
  const timeEvidence = time.evidence;
  const machineClock = time.machineAt;
  const providerTimezone = time.machineTimezone;
  const providerDigits = candidate?.cardLast4 ?? selected?.cardLast4;
  const providerNetwork = candidate?.cardNetwork ?? selected?.cardNetwork;
  const machineContext = candidate ? getRefundMachineContextPresentation(candidate) : null;
  const differences = [...evidence.conflicts, ...evidence.uncertainties];
  const purchaseLabel = selected || locallySelected ? 'Selected purchase' : 'Purchase candidate';
  const rows = [
    { label: 'Amount', customer: money(refundCase.paymentAmountCents), provider: money(candidate?.amountCents ?? selected?.saleAmountCents, candidate?.currencyCode ?? selected?.currencyCode) },
    { label: 'Time', customer: customerTime, customerNote: customerTimeConfidence,
      provider: formatRefundDateTime(time.displayAt, time.displayTimezone), providerNote: time.label },
    { label: 'Card digits', customer: refundCase.cardLast4 ? `Ending ${refundCase.cardLast4}` : 'Not supplied', customerNote: `${customerPayment} · ${customerDigitsSource}`,
      provider: providerDigits ? `Ending ${providerDigits}` : 'Not available', providerNote: candidate?.recognitionMethod || selected?.recognitionMethod || undefined },
    { label: 'Card type', customer: getRefundCardNetworkLabel(refundCase.cardNetwork), provider: providerNetwork === 'other_unknown' ? 'Not identified' : providerNetwork ? getRefundCardNetworkLabel(providerNetwork) : 'Not available' },
    { label: 'Machine', customer: refundCase.machineLabel,
      provider: selected ? selected.machineLabel : candidate?.machineDisplayLabel || refundCase.machineLabel },
  ];

  return <section id="refund-machine-transaction" tabIndex={-1} data-testid="nayax-result-card"
    data-refund-section="match-summary" className="bg-card px-4 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <h4 data-testid="nayax-decision-heading" className="text-base font-semibold">{selected || locallySelected ? selection.title : 'Compare this purchase'}</h4>
    {(selected || locallySelected) && <p className="mt-1 text-sm leading-6 text-muted-foreground">{selection.sourceLabel}</p>}
    <div data-testid="refund-purchase-comparison" className="mt-4 text-sm">
      <div className="hidden grid-cols-[90px_minmax(0,1fr)_minmax(0,1fr)] gap-3 pb-2 text-sm font-medium text-muted-foreground sm:grid">
        <span>Detail</span><span>Customer request</span><span>{purchaseLabel}</span>
      </div>
      {rows.map((row) => <div key={row.label} className="grid gap-2 border-t border-border/70 py-3 sm:grid-cols-[90px_minmax(0,1fr)_minmax(0,1fr)] sm:gap-3">
        <p className="font-medium text-muted-foreground">{row.label}</p>
        <div className="min-w-0 break-words">
          <p className="mb-1 text-xs text-muted-foreground sm:hidden">Customer request</p>
          <p className="font-medium">{row.customer}</p>
          {row.customerNote && <p className="mt-1 text-sm leading-5 text-muted-foreground">{row.customerNote}</p>}
        </div>
        <div className="min-w-0 break-words">
          <p className="mb-1 text-xs text-muted-foreground sm:hidden">{purchaseLabel}</p>
          <p className="font-medium">{row.provider}</p>
          {row.providerNote && <p className="mt-1 text-sm leading-5 text-muted-foreground">{row.providerNote}</p>}
        </div>
      </div>)}
    </div>
    <div className="mt-4 grid gap-5 sm:grid-cols-2" data-testid="refund-purchase-evidence">
      {evidence.supporting.length > 0 && <div>
        <h5 className="text-sm font-semibold">Supports this purchase</h5>
        <ul className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">
          {evidence.supporting.map((fact) => <li key={fact.key}>{fact.label}</li>)}
        </ul>
      </div>}
      {differences.length > 0 && <div>
        <h5 className="text-sm font-semibold">Uncertain or different</h5>
        <ul className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">
          {differences.map((fact) => <li key={fact.key}>{fact.label}</li>)}
        </ul>
      </div>}
    </div>
    <details data-testid="selected-nayax-transaction-evidence-details" className="mt-5 border-t border-border pt-2">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Source details</summary>
      <div className="space-y-4 pb-2 text-sm leading-6 text-muted-foreground">
        {selected && <div className="flex flex-col items-start justify-between gap-2 sm:flex-row">
          <div className="min-w-0"><p className="font-medium text-foreground">Selected Nayax transaction ID</p>
            <code data-testid="selected-nayax-transaction-id" className="block break-all text-sm text-foreground">{selected.transactionId}</code></div>
          <Button data-testid="copy-selected-nayax-transaction-id" variant="outline" size="sm" className="min-h-11 shrink-0"
            aria-label="Copy selected Nayax transaction ID" onClick={() => void navigator.clipboard.writeText(selected.transactionId)
              .then(() => toast.success('Nayax transaction ID copied.'))
              .catch(() => toast.error('Unable to copy the transaction ID. Select the ID and copy it manually.'))}>
            <Copy className="mr-2 h-4 w-4" />Copy ID
          </Button>
        </div>}
        <div><p className="font-medium text-foreground">Provider time</p>
          <p>{refundCandidateTimeSourceDetail(timeEvidence)}</p><p>{refundCandidateTimeMeaning(timeEvidence)}</p>
          {!time.usingSavedMachineTime && <p>Displayed in venue time: {timezone || 'Venue timezone unavailable'}.</p>}
        </div>
        {providerTimezone && machineClock && <div data-testid="refund-provider-clock-diagnostic">
          <p className="font-medium text-foreground">Provider machine clock</p>
          <p>{formatRefundDateTime(machineClock, providerTimezone)} · {providerTimezone}</p>
          {!time.machineTimezoneVerified && <p>Saved timezone; the machine's clock timezone is unverified.</p>}
          {providerTimezone !== timezone && <p>The provider and venue clocks use different timezones. A different clock display alone does not establish a time error.</p>}
        </div>}
        {candidate?.productLabel && <div><p className="font-medium text-foreground">Machine product</p><p>{candidate.productLabel}</p></div>}
        {(selected || locallySelected) && <div><p className="font-medium text-foreground">Selection details</p><p>{selection.rationale || selection.rationaleHint}</p></div>}
        {selection.history && <div><p className="font-medium text-foreground">Selection history</p>
          <p>{selection.history.label} {formatRefundDateTime(selection.history.recordedAt, timezone)}.</p>
        </div>}
        {machineContext && <div>
          <p className="font-medium text-foreground">Machine context</p>
          {machineContext.status && <p>{machineContext.status.label}, observed {formatRefundDateTime(machineContext.status.checkedAt, timezone)}.</p>}
          {machineContext.alerts.map((alert) => <p key={`${alert.category}-${alert.occurredAt}`}>{alert.category} at {formatRefundDateTime(alert.occurredAt, timezone)}</p>)}
          {machineContext.statusNote && <p>{machineContext.statusNote}</p>}{machineContext.alertsNote && <p>{machineContext.alertsNote}</p>}
        </div>}
      </div>
    </details>
  </section>;
}
