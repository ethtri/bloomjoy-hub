import type { RefundReportFreshness } from '@/lib/refundReportFreshness';

export function RefundReportFreshnessAdvisory({ freshness }: { freshness: RefundReportFreshness | null | undefined }) {
  if (!freshness || freshness.status === 'recent' ||
    (freshness.schemaVersion === 'refund_report_health_v2' && !freshness.attentionRequired)) return null;
  const healthV2 = freshness.schemaVersion === 'refund_report_health_v2';
  const title = healthV2
    ? freshness.attentionReason === 'report_ingest_failed'
      ? 'A Nayax report could not be processed'
      : freshness.attentionReason === 'provider_run_failed'
      ? 'Nayax recorded a failed report run'
      : 'A sent Nayax report has not been processed'
    : freshness.status === 'unobserved'
    ? 'Scheduled report has not been recorded yet'
    : 'Scheduled report needs review';
  return (
    <aside aria-label="Scheduled report delivery review" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-semibold">{title}</p>
      <p className="mt-1">
        {freshness.lastReceivedAt ? <>Last received {new Date(freshness.lastReceivedAt).toLocaleString()}. </> : null}
        {healthV2
          ? <>This report issue affects{freshness.affectedCaseCount ? <> {freshness.affectedCaseCount} unresolved {freshness.affectedCaseCount === 1 ? 'case' : 'cases'}</> : ' the refund queue'}.</>
          : <>The report is configured hourly. Bloomjoy flags a two-hour gap for internal review; the provider’s exact delivery timing is not confirmed.</>}
      </p>
      <p className="mt-2">Check the mailbox and saved Nayax report. Missing report data never confirms a refund or authorizes another payment.</p>
    </aside>
  );
}
