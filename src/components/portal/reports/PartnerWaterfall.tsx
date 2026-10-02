import type { PartnerDashboardTotals } from '@/lib/partnerDashboardReporting';
import { money } from '@/lib/reportingWorkspace';

/** Shows canonical returned values, without recalculating contract terms. */
export function PartnerWaterfall({ summary, usesSharedSalesBasis }: { summary: PartnerDashboardTotals; usesSharedSalesBasis: boolean }) {
  const steps = [
    { label: usesSharedSalesBasis ? 'Sales before refunds, excluding tax' : 'Gross sales', value: summary.grossSalesCents, type: 'total' },
    { label: 'Refund accounting impact', value: summary.refundAmountCents, type: 'deduction' },
    ...(!usesSharedSalesBasis ? [{ label: 'Tax impact', value: summary.taxCents, type: 'deduction' }] : []),
    { label: 'Configured deductions', value: summary.feeCents, type: 'deduction' },
    { label: 'Additional costs', value: summary.costCents, type: 'deduction' },
    { label: 'Net sales', value: summary.netSalesCents, type: 'total' },
    { label: 'Contract payout basis', value: summary.splitBaseCents, type: 'total' },
    { label: 'Partner Revenue Share', value: summary.amountOwedCents, type: 'share' },
    { label: 'Bloomjoy retained', value: summary.bloomjoyRetainedCents, type: 'total' },
  ];
  const maximum = Math.max(1, ...steps.map(step => Math.abs(step.value ?? 0)));
  return <section aria-label="Sales to partner share" className="mb-2"><h3 className="text-sm font-semibold">Sales to partner share</h3>
    <dl className="mt-3 space-y-3">{steps.map(step => <div key={step.label}><div className="flex items-baseline justify-between gap-4 text-sm"><dt className="text-muted-foreground">{step.label}</dt><dd className="shrink-0 font-medium tabular-nums">{money(step.value)}</dd></div>
      {step.value != null && <div aria-hidden="true" className="mt-1 h-1.5 rounded bg-muted"><div className={`h-1.5 rounded ${step.type === 'share' ? 'bg-[#c44c64]' : step.type === 'deduction' ? 'bg-muted-foreground/40' : 'bg-slate-500'}`} style={{ width: `${Math.abs(step.value) / maximum * 100}%` }}/></div>}</div>)}</dl>
    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Bars show each returned contract amount, not additive steps. Retained amount is not complete profit or proof of remittance. Unavailable fields are not zero.{usesSharedSalesBasis ? ` Separated sales tax: ${money(summary.taxCents)}.` : ''}</p>
  </section>;
}
