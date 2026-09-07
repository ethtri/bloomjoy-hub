import type { RefundReportFreshness } from '@/lib/refundReportFreshness';

export function RefundReportFreshnessAdvisory({ freshness }: { freshness: RefundReportFreshness | null | undefined }) {
  if (!freshness || freshness.status === 'recent') return null;
  return (
    <aside aria-label="Scheduled report delivery review" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-semibold">{freshness.status === 'unobserved' ? 'Scheduled report has not been recorded yet' : 'Scheduled report needs review'}</p>
      <p className="mt-1">
        {freshness.lastReceivedAt ? <>Last received {new Date(freshness.lastReceivedAt).toLocaleString()}. </> : null}
        The report is configured hourly. Bloomjoy flags a two-hour gap for internal review; the provider’s exact delivery timing is not confirmed.
      </p>
      <p className="mt-2">Refund Operations: review the mailbox and saved report evidence, then continue the existing Nayax support case if needed. Use exact provider evidence for refunds while delivery is checked.</p>
    </aside>
  );
}
