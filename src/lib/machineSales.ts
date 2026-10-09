import type { ReportingDimension, SalesReportRow } from './reporting';
import { moneyCoverage, type WorkspaceState } from './reportingWorkspace';

export type MachineSalesSort = 'sales' | 'receipts' | 'name' | 'net' | 'transactions';
export function machineSalesRows(rows: SalesReportRow[], dimensions: ReportingDimension[], state: Pick<WorkspaceState, 'companyId' | 'locationId' | 'machineId'>, search = '', sort: MachineSalesSort = 'sales') {
  const authorized = [...new Map(dimensions.filter(d =>
    (state.companyId === 'all' || d.accountId === state.companyId) &&
    (state.locationId === 'all' || d.locationId === state.locationId) &&
    (state.machineId === 'all' || d.machineId === state.machineId)
  ).map(d => [d.machineId, d])).values()];
  const query = search.trim().toLocaleLowerCase();
  return authorized.map(machine => {
    const loaded = rows.filter(row => row.machineId === machine.machineId);
    return { ...machine, rows: loaded, receipts: moneyCoverage(loaded, 'customerReceiptsCents'),
      salesExTax: moneyCoverage(loaded, 'grossSalesCents'), net: moneyCoverage(loaded),
      transactions: loaded.length ? loaded.reduce((sum, row) => sum + row.transactionCount, 0) : null };
  }).filter(machine => `${machine.machineLabel} ${machine.locationName} ${machine.accountName}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => {
      const byName = a.machineLabel.localeCompare(b.machineLabel) || a.machineId.localeCompare(b.machineId);
      if (sort === 'name') return byName;
      const left = sort === 'transactions' ? a.transactions : sort === 'net' ? a.net.withEstimates ?? a.net.displayValue : sort === 'sales' ? a.salesExTax.withEstimates ?? a.salesExTax.displayValue : a.receipts.displayValue;
      const right = sort === 'transactions' ? b.transactions : sort === 'net' ? b.net.withEstimates ?? b.net.displayValue : sort === 'sales' ? b.salesExTax.withEstimates ?? b.salesExTax.displayValue : b.receipts.displayValue;
      return left === null ? right === null ? byName : 1 : right === null ? -1 : right - left || byName;
    });
}

export function machineSalesCsv(machines: ReturnType<typeof machineSalesRows>) {
  const escape = (value: unknown) => {
    let text = String(value ?? '');
    if (typeof value === 'string' && /^[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const headers = ['Machine', 'Location', 'Company', 'Known sales excluding tax (USD cents)', 'Sales amounts incomplete', 'Known net sales (USD cents)', 'Net amounts incomplete', 'Customer receipts including tax (USD cents)', 'Receipt amounts incomplete', 'Recorded transactions', 'Loaded records', 'Machine roster status', 'Provisional estimated sales excluding tax (USD cents)', 'Provisional estimated refund impact excluding tax (USD cents)', 'Provisional estimated net sales (USD cents)', 'Known + provisional sales subtotal (USD cents)', 'Known + provisional net subtotal (USD cents)', 'Estimates are not payout amounts', 'Components still unavailable - sales', 'Components still unavailable - refunds', 'Components still unavailable - net'];
  return [headers, ...machines.map(machine => [machine.machineLabel, machine.locationName, machine.accountName,
    machine.salesExTax.displayValue, machine.salesExTax.status !== 'complete', machine.net.displayValue, machine.net.status !== 'complete',
    machine.receipts.displayValue, machine.receipts.status !== 'complete', machine.transactions, machine.rows.length, machine.managementArchivedAt ? 'Archived - historical reporting' : 'Current roster', machine.salesExTax.estimatedValue, moneyCoverage(machine.rows, 'refundAmountCents').estimatedValue, machine.net.estimatedValue, machine.salesExTax.withEstimates, machine.net.withEstimates, machine.salesExTax.estimatedValue !== null || machine.net.estimatedValue !== null, machine.salesExTax.remainingUnknownComponents, moneyCoverage(machine.rows, 'refundAmountCents').remainingUnknownComponents, machine.net.remainingUnknownComponents])]
    .map(row => row.map(escape).join(',')).join('\r\n');
}

export function machineSalesStatus(machine: ReturnType<typeof machineSalesRows>[number]) {
  if (!machine.rows.length) return 'No loaded records for this period';
  if (machine.salesExTax.estimatedValue !== null || machine.net.estimatedValue !== null) {
    const missing = machine.net.remainingUnknownComponents || machine.salesExTax.remainingUnknownComponents;
    const receiptNote = machine.receipts.noSalesRecorded ? ' Refund records loaded; no sales recorded.' : machine.receipts.status !== 'complete' ? ' Customer payment totals remain incomplete.' : '';
    return `Includes a provisional tax estimate.${missing ? ` ${missing} ${missing === 1 ? 'component is' : 'components are'} still unavailable; this is a subtotal.` : ''}${receiptNote} Verified amounts remain separate; estimates are not payout amounts.`;
  }
  if (machine.receipts.noSalesRecorded) return 'Refund records loaded; no sales recorded';
  if (machine.receipts.status !== 'complete') {
    if (!machine.receipts.knownRows && machine.salesExTax.status === 'complete' && machine.net.status === 'complete') return 'Sales are available; total customer payments were not provided';
    return machine.receipts.knownRows ? 'Known receipts only; some amounts unavailable' : 'Receipt amounts unavailable';
  }
  if (machine.salesExTax.status === 'partial') return 'Customer payments recorded; tax or amount details unavailable';
  if (machine.net.status === 'partial') return 'Sales recorded; refund details unavailable';
  return 'Calculated from loaded records';
}
