import { readFile } from 'node:fs/promises';

const files = {
  migration: 'supabase/migrations/20260908163758_automatic_contractor_pay_stubs.sql',
  pdf: 'supabase/functions/_shared/pay-stub-pdf.ts',
  generator: 'supabase/functions/pay-stub-generator/index.ts',
  manager: 'src/pages/admin/Payouts.tsx',
  technician: 'src/pages/portal/Time.tsx',
  databaseTest: 'supabase/tests/manager_time_pay_report_contract.sql',
};

const content = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await readFile(file, 'utf8')]))
);

const required = [
  ['migration', "'commissionFormula', '(sales - refunds - tax) x commission rate'"],
  ['migration', 'reporting_machine_tax_rates'],
  ['migration', 'tax_cents integer not null default 0'],
  ['migration', 'pay_stub_generation_requests'],
  ['migration', "statement.status = 'issued'"],
  ['migration', 'service_enqueue_automatic_pay_stubs'],
  ['migration', 'operator_time_entry_cutoff_at(period.period_end_date)'],
  ['migration', "'schemaVersion', 'operator-pay-stub-v2'"],
  ['migration', "'payment_execution', false"],
  ['pdf', 'Commission appendix'],
  ['pdf', 'Sales - refunds - estimated sales tax = commissionable sales'],
  ['generator', 'upsert: false'],
  ['generator', 'service_complete_pay_stub'],
  ['manager', 'Publish Pay Stub'],
  ['manager', 'estimated sales tax'],
  ['technician', 'await downloadOperatorPayStatementHtml'],
  ['databaseTest', "10.0000, '2026-01-01', 'active'"],
  ['databaseTest', "'1000:1000'"],
  ['databaseTest', "'false:false:true'"],
];

const missing = required.filter(([file, marker]) => !content[file].includes(marker));
if (missing.length) {
  console.error('Automatic Pay Stub validation failed:');
  missing.forEach(([file, marker]) => console.error(`- ${files[file]} is missing ${marker}`));
  process.exit(1);
}

const forbidden = [
  ['migration', "profile.user_id = p_user_id\n            and statement.status in ('issued', 'revised')"],
  ['generator', 'upsert: true'],
  ['migration', "coalesce(daily.commission_rate ->> 'ruleId', 'missing')"],
];
const violations = forbidden.filter(([file, marker]) => content[file].includes(marker));
if (violations.length) {
  console.error('Automatic Pay Stub safety validation failed:');
  violations.forEach(([file, marker]) => console.error(`- ${files[file]} contains forbidden marker ${marker}`));
  process.exit(1);
}

console.log('Automatic Pay Stub contract validation passed.');
