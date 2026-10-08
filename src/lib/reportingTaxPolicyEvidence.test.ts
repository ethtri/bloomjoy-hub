/// <reference lib="deno.ns" />
import { parseTaxPolicyEvidence, taxPolicyEstimate } from './reportingTaxPolicyEvidence.ts';

const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
const evidence = { status: 'provisional', estimatedSalesExTaxCents: 1000, estimatedRefundExTaxCents: 200, estimatedNetExTaxCents: 800, provisionalSalesComponents: 1, provisionalRefundComponents: 1, provisionalNetComponents: 2 };

Deno.test('Missing estimate stays unavailable while an estimated zero remains zero', () => {
  assert(parseTaxPolicyEvidence(null) === undefined, 'Legacy row has no fabricated evidence');
  assert(taxPolicyEstimate([], 'grossSalesCents').value === null, 'No fabricated zero');
  const zero = parseTaxPolicyEvidence({ ...evidence, estimatedSalesExTaxCents: 0 })!;
  assert(taxPolicyEstimate([{ taxPolicyEvidence: zero }], 'grossSalesCents').value === 0, 'Preserve actual estimated zero');
});

Deno.test('Estimated contribution sums only estimate evidence and never includes receipts or tax', () => {
  const policy = parseTaxPolicyEvidence(evidence)!;
  const rows = [{ taxPolicyEvidence: policy }, {}, { taxPolicyEvidence: { ...policy, estimatedNetExTaxCents: -300 } }];
  assert(taxPolicyEstimate(rows, 'netSalesCents').value === 500, 'Keep signed refund net impact');
  assert(taxPolicyEstimate(rows, 'grossSalesCents').value === 2000, 'Count each contribution once');
  assert(taxPolicyEstimate(rows, 'customerReceiptsCents').value === null, 'Never estimate customer payments from tax assumptions');
  assert(taxPolicyEstimate(rows, 'taxCents').value === null, 'Never replace original transaction tax');
});

Deno.test('Estimate parser rejects false confirmed status and fractional or unsafe money', () => {
  for (const invalid of [{ ...evidence, status: 'confirmed' }, { ...evidence, estimatedSalesExTaxCents: 1.25 }, { ...evidence, estimatedNetExTaxCents: Number.MAX_SAFE_INTEGER + 1 }, { ...evidence, provisionalSalesComponents: -1 }]) {
    let rejected = false; try { parseTaxPolicyEvidence(invalid); } catch { rejected = true; }
    assert(rejected, 'Invalid evidence must fail closed');
  }
});
Deno.test('Estimate completeness requires its exact canonical per-metric counts', () => {
  const counts = { gross_sales_unknown_count: 3, refund_amount_unknown_count: 1, net_sales_unknown_count: 4 };
  assert(parseTaxPolicyEvidence(evidence, counts)?.provisionalNetComponents === 2, 'Keep distinct net component units');
  for (const invalid of [{ ...counts, net_sales_unknown_count: 1 }, { ...counts, net_sales_unknown_count: undefined }]) {
    let rejected = false; try { parseTaxPolicyEvidence(evidence, invalid); } catch { rejected = true; }
    assert(rejected, 'Cannot invent or overrun canonical component coverage');
  }
});
