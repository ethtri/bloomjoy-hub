import { financeRpcResponse } from './finance-reporting-fixtures.mjs';
import { domainDimensions } from './reporting-workspace-fixtures.mjs';
import { operatorDimensions, fixedNowIso } from './validate-reporting-uat.mjs';

export const sampleCompanies = [
  { id: '17190000-0000-4000-8000-000000000001', name: 'Sample North Company' },
  { id: '17190000-0000-4000-8000-000000000002', name: 'Sample South Company with a long reporting name' },
];
export const companyDimensions = domainDimensions.map((row, index) => ({ ...row, accountId: sampleCompanies[index % 2].id, accountName: sampleCompanies[index % 2].name }));
export function companyRpcResponse(name, persona, body = {}, freshness = 'fresh') {
  if (name === 'get_sales_report_complete') return companyRpcResponse(body.p_company_id ? 'get_company_sales_report' : 'get_sales_report', persona, body, freshness);
  if (name === 'get_reporting_dimensions') return persona.hasReportingAccess ? operatorDimensions.map((row, index) => ({ ...row, account_id: sampleCompanies[index % 2].id, account_name: sampleCompanies[index % 2].name })) : [];
  if (name === 'get_refund_analytics_access') return { hasAccess: persona.isSuperAdmin, dimensions: persona.isSuperAdmin ? companyDimensions : [] };
  if (name === 'get_refund_portal_queue_projection') {
    const items = companyDimensions.map((row, index) => ({ accountId: row.accountId, accountName: row.accountName, caseId: `sample-case-${index}`, publicReference: `RF-SAMPLE-${index}`, amountCents: 700, currencyCode: 'USD', machineLabel: row.machineLabel, locationName: row.locationName, createdAt: fixedNowIso, view: index ? 'waiting_on_customer' : 'decisions', isOpen: true, decisionReady: !index, nextWorkActor: index ? 'customer' : 'manager', nextWorkActionCode: index ? 'wait_for_customer_reply' : 'review', nextWorkActionLabel: index ? 'Waiting for a reply' : 'Review the request', payloadRedacted: true }));
    return { schemaVersion: 'refund_portal_queue_v1', observedAt: fixedNowIso, refundOperationsAccess: false, payloadRedacted: true, items, counts: { allOpen: items.length, decisions: 1, waitingOnCustomer: items.length - 1, completed: 0, internalTest: 0 } };
  }
  if (name.startsWith('get_company_')) {
    const selected = companyDimensions.filter(row => row.accountId === body.p_company_id && (!body.p_machine_ids || body.p_machine_ids.includes(row.machineId)) && (!body.p_location_ids || body.p_location_ids.includes(row.locationId)));
    if (!selected.length) throw new Error('Unavailable sample company scope');
    return companyRpcResponse(name.replace('get_company_', 'get_'), persona, { ...body, p_machine_ids: [...new Set(selected.map(row => row.machineId))] }, freshness);
  }
  const result = financeRpcResponse(name, persona, body, freshness, { dimensions: companyDimensions });
  if (name === 'get_refund_analytics') {
    const selected = companyDimensions.filter(row => (!body.p_machine_ids || body.p_machine_ids.includes(row.machineId)) && (!body.p_location_ids || body.p_location_ids.includes(row.locationId)));
    const machines = result.machines.map(row => ({ ...row, ...selected.find(machine => machine.machineId === row.machineId) }));
    return { ...result, machines, cohort: { ...result.cohort, requestCount: machines.reduce((sum, row) => sum + row.requestCount, 0), requestedCents: machines.reduce((sum, row) => sum + row.requestedCents, 0) }, asOf: { ...result.asOf, outstandingCents: machines.reduce((sum, row) => sum + row.outstandingCents, 0) } };
  }
  return result;
}
