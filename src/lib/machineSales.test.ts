import { machineSalesCsv, machineSalesRows, machineSalesStatus } from './machineSales.ts';
import { moneyCoverage } from './reportingWorkspace.ts';
import type { ReportingDimension, SalesReportRow } from './reporting.ts';
/// <reference lib="deno.ns" />
const assert = (condition: unknown, message: string) => { if (!condition) throw Error(message); };
const dimensions: ReportingDimension[] = ['paid', 'partial', 'zero', 'empty', 'foreign'].map((id) => ({
  accountId: id === 'foreign' ? 'other' : 'company', accountName: 'Company', machineId: id, machineLabel: id,
  locationId: 'location', locationName: 'Location', machineType: 'commercial', sunzeMachineId: null, latestSaleDate: null, status: 'active' }));
const row = (machineId: string, patch: Partial<SalesReportRow> = {}): SalesReportRow => ({machineId, machineLabel: machineId,
  locationId: 'location', locationName: 'Location', periodStart: '2026-10-01', paymentMethod: 'credit', calculationVersion: 'shared-sales-basis-v1',
  grossSalesCents: null, netSalesCents: null, taxCents: null, refundAmountCents: 0, transactionCount: 5,
  refundRequestDeductionCents: 0, refundReversalCents: 0, refundLegacyPaidDeductionCents: 0, refundPaidContextCents: 0,
  refundOutstandingContextCents: 0, unresolvedSalesCount: 1, unresolvedSalesCents: 1000, unresolvedRefundCount: 0,
  unresolvedRefundCents: 0, unresolvedPaidContextCount: 0, unresolvedPaidContextCents: 0, ...patch});
const rows = [row('paid', {customerReceiptsCents: 1000, customerReceiptsKnownCents: 1000, customerReceiptsUnknownCount: 0}),
  row('partial', {customerReceiptsCents: null, customerReceiptsKnownCents: 600, customerReceiptsUnknownCount: 1,
    grossSalesKnownCents: 550, grossSalesUnknownCount: 1, netSalesKnownCents: 500, netSalesUnknownCount: 1}),
  row('zero', {customerReceiptsCents: 0, customerReceiptsKnownCents: 0, grossSalesCents: 0, netSalesCents: 0, transactionCount: 0}),
  row('foreign', {customerReceiptsCents: 900000})];
const scope = {companyId: 'company', locationId: 'all', machineId: 'all'};
Deno.test('machine roster preserves no-record machines, supported receipts and true partial component values', () => {
  const result = machineSalesRows(rows, dimensions, scope);
  assert(result.length === 4 && result[0].machineId === 'partial', 'all permitted roster rows, sorted by known sales');
  const paid = result.find(x => x.machineId === 'paid')!;
  assert(paid.receipts.displayValue === 1000 && paid.salesExTax.displayValue === null && paid.transactions === 5, 'tax uncertainty does not hide customer receipts or transactions');
  const partial = result.find(x => x.machineId === 'partial')!;
  assert(partial.receipts.status === 'partial' && partial.receipts.displayValue === 600 && partial.salesExTax.displayValue === 550 && partial.net.displayValue === 500, 'partial amounts survive a null aggregate row');
  const zero = result.find(x => x.machineId === 'zero')!; const empty = result.find(x => x.machineId === 'empty')!;
  assert(zero.receipts.displayValue === 0 && zero.transactions === 0 && empty.receipts.status === 'empty' && empty.receipts.displayValue === null && empty.transactions === null, 'loaded zero differs from absent records');
  assert(!result.some(x => x.machineId === 'foreign'), 'company filter preserves authorization dimensions');
});
Deno.test('machine search, filter, sort and CSV preserve scope and incomplete amounts', () => {
  assert(machineSalesRows(rows, dimensions, scope, 'partial').length === 1, 'search reaches all machines');
  assert(machineSalesRows(rows, dimensions, {...scope, machineId: 'empty'}).length === 1, 'machine filter does not drop no-data record');
  const sorted = machineSalesRows(rows, dimensions, scope, '', 'name');
  assert(sorted[0].machineId === 'empty', 'name sort includes missing-amount machines');
  const csv = machineSalesCsv(sorted);
  assert(csv.includes('Customer receipts including tax') && csv.includes('"550","true","500","true","600","true"'), 'CSV preserves receipt versus exclusive partial basis');
  assert(csv.includes('"empty","Location","Company","","true","","true","","true","","0"'), 'missing records stay blank, incomplete and count0');
  const unsafe = machineSalesRows(rows, dimensions.map(x=>({...x,managementArchivedAt:'2026-10-01T00:00:00Z',machineLabel:'=HYPERLINK("unsafe")'})), scope);
  assert(machineSalesCsv(unsafe).includes('Archived - historical reporting'), 'archived machines stay visible and explicitly marked');
  assert(machineSalesCsv(unsafe).includes("'="), 'CSV neutralizes spreadsheet formula labels');
  assert(moneyCoverage([row('paid')], 'customerReceiptsCents').displayValue === null, 'old API never invents inclusive money from raw/exclusive sales');
});

Deno.test('receipt coverage excludes refund-only groups and preserves unknown versus known zero', () => {
  const refundOnly = row('paid', { customerReceiptsCents: null, customerReceiptsKnownCents: null, customerReceiptsUnknownCount: 0, transactionCount: 0 });
  const loaded = moneyCoverage([refundOnly, rows[0]], 'customerReceiptsCents');
  assert(loaded.status === 'complete' && loaded.value === 1000, 'refund-only groups do not make receipts partial');
  const onlyRefund = moneyCoverage([refundOnly], 'customerReceiptsCents');
  assert(onlyRefund.noSalesRecorded && onlyRefund.displayValue === null && onlyRefund.status !== 'empty', 'loaded refund is no sales recorded');
  const unknown = moneyCoverage([row('paid', {customerReceiptsCents: null, customerReceiptsKnownCents: null, customerReceiptsUnknownCount: 1})], 'customerReceiptsCents');
  assert(unknown.displayValue === null && unknown.status === 'partial' && !unknown.noSalesRecorded, 'unresolved remains unavailable');
  const partialZero = moneyCoverage([row('paid', {customerReceiptsCents: null, customerReceiptsKnownCents: 0, customerReceiptsUnknownCount: 1})], 'customerReceiptsCents');
  assert(partialZero.displayValue === 0 && partialZero.status === 'partial', 'known zero remains partial');
});

Deno.test('tax-exclusive source keeps available sales and explains absent customer payment total', () => {
  const source = row('paid', { customerReceiptsCents: null, customerReceiptsKnownCents: null, customerReceiptsUnknownCount: 59, grossSalesCents: 174640, grossSalesKnownCents: 174640, grossSalesUnknownCount: 0, netSalesCents: 174640, netSalesKnownCents: 174640, netSalesUnknownCount: 0, taxCents: 0, unresolvedSalesCount: 0 });
  const machine = machineSalesRows([source], dimensions, {...scope, machineId: 'paid'})[0];
  assert(machine.receipts.displayValue === null && machine.salesExTax.displayValue === 174640 && machine.net.displayValue === 174640, 'source sales must not be invented inclusive receipts');
  const ranked = machineSalesRows([source, row('partial', {customerReceiptsCents: 1000, grossSalesCents: 900, netSalesCents: 900})], dimensions, scope);
  assert(ranked[0].machineId === 'paid' && machineSalesRows([source, row('partial', {customerReceiptsCents: 1000, grossSalesCents: 900})], dimensions, scope, '', 'receipts')[0].machineId === 'partial', 'default ranks known sales, inclusive receipts remains optional');
  assert(machineSalesStatus(machine) === 'Sales are available; total customer payments were not provided', 'plain source capability explanation');
  assert(machineSalesCsv([machine]).includes('"174640","false","174640","false","","true"'), 'CSV keeps usable sales independently of receipt uncertainty');
});

Deno.test('Machine CSV separates confirmed and estimated cents without counting a known subtotal twice', () => {
  const mixed = row('paid', { grossSalesKnownCents: 500, netSalesKnownCents: 400, refundAmountKnownCents: 100, taxPolicyEvidence: { status: 'provisional', estimatedSalesExTaxCents: 1000, estimatedRefundExTaxCents: 200, estimatedNetExTaxCents: 800, provisionalSalesComponents: 1, provisionalRefundComponents: 1, provisionalNetComponents: 2 } });
  const machine = machineSalesRows([mixed], dimensions, { ...scope, machineId: 'paid' })[0];
  assert(machine.salesExTax.displayValue === 500 && machine.salesExTax.withEstimates === 1500 && machine.net.withEstimates === 1200, 'Keep known and estimated contributions separate');
  const csv = machineSalesCsv([machine]);
  assert(csv.includes('Provisional estimated sales excluding tax') && csv.includes('Estimates are not payout amounts'), 'Explicit estimate headers');
  assert(csv.includes('"1000","200","800","1500","1200","true"'), 'CSV known+estimate parity');
  assert(machineSalesStatus(machine).includes('provisional tax estimate'), 'Visible estimation status');
});
Deno.test('Machine estimate status and CSV retain remaining missing components and the receipt gap', () => {
  const mixed = row('paid', { grossSalesKnownCents: 0, grossSalesUnknownCount: 3, netSalesKnownCents: 0, netSalesUnknownCount: 4, refundAmountCents: null, refundAmountKnownCents: 0, refundAmountUnknownCount: 1, customerReceiptsCents: null, customerReceiptsKnownCents: null, customerReceiptsUnknownCount: 1, taxPolicyEvidence: { status: 'provisional', estimatedSalesExTaxCents: 0, estimatedRefundExTaxCents: 200, estimatedNetExTaxCents: -200, provisionalSalesComponents: 1, provisionalRefundComponents: 1, provisionalNetComponents: 2 } });
  const machine = machineSalesRows([mixed], dimensions, { ...scope, machineId: 'paid' })[0];
  assert(machine.net.withEstimates === -200 && machine.net.remainingUnknownComponents === 2, 'Negative estimate remains partial');
  assert(machineSalesStatus(machine).includes('2 components are still unavailable') && machineSalesStatus(machine).includes('Customer payment totals remain incomplete'), 'Neither gap is hidden by estimate');
  assert(machineSalesCsv([machine]).includes('Components still unavailable'), 'CSV preserves unresolved completeness');
});
