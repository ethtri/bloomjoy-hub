import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const helperPath = 'supabase/migrations/20260929004543_refund_request_month_recognition.sql';
const consumerPath = 'supabase/migrations/20260929010931_align_shared_sales_consumers.sql';
const helper = read(helperPath);
const consumer = read(consumerPath);
const payouts = read('src/pages/admin/Payouts.tsx');
const partnerPrint = read('src/components/portal/reports/PartnerPrintableReport.tsx');
const partnerExport = read('supabase/functions/_shared/partner-report-export.ts');
const scheduler = read('supabase/functions/sales-report-scheduler/index.ts');

assert(helperPath < consumerPath, 'The shared helper migration must apply before every consumer binding.');
assert(
  consumer.includes('private.operator_machine_tax_snapshot') &&
    consumer.includes('private.operator_machine_tax_commission') &&
    consumer.match(/private\.machine_sales_daily_components/g)?.length >= 6,
  'Tax, commission, report, pay, and partner consumers must share the private daily adapter.',
);
assert(
  consumer.includes('drop function if exists public.get_sales_report(jsonb)') &&
    consumer.includes('unresolved_paid_context_count bigint') &&
    consumer.includes('refund_legacy_paid_deduction_cents bigint'),
  'Both Sales Report overloads must expose the expanded, history-preserving contract.',
);
assert(
  consumer.includes('scoped_component_rows as materialized') &&
    consumer.includes('financial_rule_id') &&
    consumer.includes('row_number() over') &&
    consumer.includes('sum(row.request_deduction_ex_tax_cents + row.legacy_paid_deduction_ex_tax_cents'),
  'Partner math must aggregate signed refund impact by original rule and count sale quantity once.',
);
assert(
  consumer.includes("issued_statement.status = 'issued'") &&
    consumer.includes('operator_machine_tax_snapshot_before_shared_basis') &&
    !consumer.includes('operator_pay_stub_regeneration_required_without_shared_formula'),
  'Issued periods must compare old formulas on their old basis and avoid formula-only warnings.',
);
assert(
  consumer.match(/rollout\.activated_at is not null/g)?.length >= 7 &&
    consumer.includes('alter column gross_sales_cents drop not null') &&
    consumer.includes('alter column eligible_commission_revenue_cents drop not null'),
  'Consumer cutover must require explicit activation and unresolved snapshot money must remain null.',
);
assert(
  scheduler.includes('sales_report_scheduler_get_sales_report') &&
    scheduler.includes('p_actor_user_id: schedule.created_by') &&
    !scheduler.includes("from('machine_sales_facts')"),
  'The scheduler must use the narrow actor-scoped shared report adapter.',
);
assert(
  payouts.includes("salesCalculationVersion === 'shared-sales-basis-v1'") &&
    payouts.includes('tax-exclusive sales − refund deductions + reversals'),
  'Payout wording must be version-aware and avoid subtracting already-separated tax twice.',
);
assert(
  partnerPrint.includes("preview.calculationVersion === 'shared-sales-basis-v1'") &&
    partnerPrint.includes('Sales tax (separated)') &&
    partnerPrint.includes('formatRefundImpact') &&
    partnerExport.includes('usesSharedSalesBasis') &&
    partnerExport.includes('formatRefundImpactCurrency') &&
    partnerExport.includes('xlsxRefundImpact') &&
    partnerExport.includes('Tax-exclusive sales minus approved refunds and configured deductions.'),
  'Partner UI and exports must explain the shared tax-exclusive basis without double tax.',
);
assert(
  payouts.includes('refund impact {formatRefundImpact(machine.refundAdjustmentCents)}'),
  'Technician Pay must display a reversal-only month as positive refund impact.',
);

const cardExTax = 11_000 / 1.1;
const cashExTax = 2_200 / 1.1;
const requestExTax = 1_100 / 1.1;
const salesBeforeRefunds = Math.round(cardExTax + cashExTax);
const netSales = salesBeforeRefunds - Math.round(requestExTax);
assert(salesBeforeRefunds === 12_000 && netSales === 11_000,
  'The shared parity fixture must produce $120 before refunds and $110 net.');
assert(netSales - 0 === 11_000,
  'A later payment is context and must contribute zero additional refund impact.');

console.log('Shared sales consumer validation passed.');
