/// <reference lib="deno.ns" />
import { getEffectiveReportingTaxTreatment, parseReportingTaxTreatments } from './reportingTaxTreatment.ts';
import type { ReportingTaxTreatment } from './reportingTaxTreatment.ts';

const equal = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const rule = (patch: Partial<ReportingTaxTreatment> = {}): ReportingTaxTreatment => ({
  id: 'rule', machineId: 'machine', tender: 'card', amountBasis: 'tax_inclusive',
  taxablePortionPercent: 33, effectiveStartDate: '2026-09-01', effectiveEndDate: '2026-09-30',
  createdAt: '2026-09-01T00:00:00Z', createdBy: null, ...patch,
});
Deno.test('unconfigured tender preserves source defaults without borrowing another machine or tender', () => {
  const rules = [rule(), rule({ machineId: 'another', tender: 'cash', taxablePortionPercent: 0 })];
  equal(getEffectiveReportingTaxTreatment(rules, 'machine', 'cash', '2026-09-20'),
    { amountBasis: 'source_default', taxablePortionPercent: 100 });
  equal(getEffectiveReportingTaxTreatment([], 'machine', 'card', '2026-09-20'),
    { amountBasis: 'source_default', taxablePortionPercent: 100 });
});
Deno.test('lookup uses inclusive effective boundaries and the original purchase date', () => {
  const rules = [rule({ effectiveStartDate: '2026-10-01', effectiveEndDate: null,
    amountBasis: 'tax_exclusive', taxablePortionPercent: 100 }), rule()];
  for (const date of ['2026-09-01', '2026-09-30']) {
    equal(getEffectiveReportingTaxTreatment(rules, 'machine', 'card', date),
      { amountBasis: 'tax_inclusive', taxablePortionPercent: 33 });
  }
  equal(getEffectiveReportingTaxTreatment(rules, 'machine', 'card', '2026-10-01'),
    { amountBasis: 'tax_exclusive', taxablePortionPercent: 100 });
  equal(getEffectiveReportingTaxTreatment(rules, 'machine', 'card', '2026-08-31'),
    { amountBasis: 'source_default', taxablePortionPercent: 100 });
});
Deno.test('lookup preserves explicit zero taxable portion and does not mutate history', () => {
  const rules = [rule({ taxablePortionPercent: 0 }), rule({ machineId: 'another' })];
  const before = JSON.stringify(rules);
  equal(getEffectiveReportingTaxTreatment(rules, 'machine', 'card', '2026-09-20'),
    { amountBasis: 'tax_inclusive', taxablePortionPercent: 0 });
  equal(JSON.stringify(rules), before);
});
const rawRule = { id: 'rule', machine_id: 'machine', tender: 'card', amount_basis: 'tax_inclusive',
  taxable_portion_percent: '33', effective_start_date: '2026-09-01', effective_end_date: null,
  created_at: '2026-09-01T00:00:00Z', created_by: null };
Deno.test('parser handles SQL numeric serialization and explicit empty histories', () => {
  equal(parseReportingTaxTreatments([rawRule])[0].taxablePortionPercent, 33);
  equal(parseReportingTaxTreatments([]), []);
});
Deno.test('parser rejects unsupported responses and malformed rules rather than resetting defaults', () => {
  const malformed = [null, {}, { treatments: [] }, [null], [{ ...rawRule, amount_basis: 'unknown' }],
    [{ ...rawRule, taxable_portion_percent: null }], [{ ...rawRule, taxable_portion_percent: 101 }],
    [{ ...rawRule, taxable_portion_percent: false }], [{ ...rawRule, taxable_portion_percent: ' ' }],
    [{ ...rawRule, effective_start_date: '2026-02-31' }],
    [{ ...rawRule, effective_end_date: '2026-08-31' }], [{ ...rawRule, machine_id: undefined }]];
  for (const payload of malformed) {
    let threw = false;
    try { parseReportingTaxTreatments(payload); } catch { threw = true; }
    if (!threw) throw new Error(`Malformed response accepted: ${JSON.stringify(payload)}`);
  }
});
