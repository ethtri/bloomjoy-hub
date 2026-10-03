/** Company identity always comes from domain-authorized canonical machine metadata. */
export type CompanyDimension = {
  machineId: string; locationId: string; accountId?: string | null; accountName?: string | null;
};
export type CompanyOption = { id: string; name: string };
export const companyBasis = 'Grouped by each machine’s current reporting company; historical locations and dates are preserved.';
export function companyOptions(dimensions: { accountId?: string | null; accountName?: string | null }[]): CompanyOption[] {
  return [...new Map(dimensions.filter(row => row.accountId).map(row => [row.accountId!, { id: row.accountId!, name: row.accountName || 'Unnamed company' }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
}
export function resolveCompanyScope<T extends CompanyDimension>(dimensions: T[], companyId: string, locationId = 'all', machineId = 'all') {
  const companies = companyOptions(dimensions);
  const companyRows = dimensions.filter(row => companyId === 'all' || row.accountId === companyId);
  const locations = [...new Set(companyRows.map(row => row.locationId))];
  const machineRows = companyRows.filter(row => locationId === 'all' || row.locationId === locationId);
  const selected = machineRows.filter(row => machineId === 'all' || row.machineId === machineId);
  const invalid = (companyId !== 'all' && !companies.some(row => row.id === companyId))
    || (locationId !== 'all' && !locations.includes(locationId))
    || (machineId !== 'all' && !machineRows.some(row => row.machineId === machineId));
  // [] means an empty intersection, never an all-machines request.
  const machineIds = [...new Set(selected.map(row => row.machineId))];
  return { companies, companyRows, machineRows, machineIds, invalid, empty: machineIds.length === 0 };
}
export function companyChange<T extends CompanyDimension>(dimensions: T[], companyId: string, locationId: string, machineId: string) {
  const rows = dimensions.filter(row => companyId === 'all' || row.accountId === companyId);
  const nextLocation = locationId === 'all' || rows.some(row => row.locationId === locationId) ? locationId : 'all';
  const nextMachine = machineId === 'all' || rows.some(row => row.machineId === machineId && (nextLocation === 'all' || row.locationId === nextLocation)) ? machineId : 'all';
  return { companyId, locationId: nextLocation, machineId: nextMachine };
}
export function groupCompanyRows<T extends { machineId: string }>(rows: T[], dimensions: CompanyDimension[]) {
  const byMachine = new Map(dimensions.map(row => [row.machineId, row]));
  const groups = new Map<string, { id: string; name: string; rows: T[]; machineIds: Set<string> }>();
  for (const machine of dimensions) {
    const id = machine.accountId ?? 'unassigned';
    if (!groups.has(id)) groups.set(id, { id, name: machine.accountName || 'Unassigned company', rows: [], machineIds: new Set<string>() });
  }
  for (const row of rows) {
    const machine = byMachine.get(row.machineId);
    const id = machine?.accountId ?? 'unassigned';
    const group = groups.get(id) ?? { id, name: machine?.accountName || 'Unassigned company', rows: [], machineIds: new Set<string>() };
    group.rows.push(row); group.machineIds.add(row.machineId); groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function assertCompanyExportScope(dimensions: CompanyDimension[], companyId: string, rows: { machineId: string }[], locationId = 'all', machineId = 'all') {
  const scope = resolveCompanyScope(dimensions, companyId, locationId, machineId);
  if (scope.invalid || scope.empty || rows.some(row => !scope.machineIds.includes(row.machineId))) {
    throw new Error('The report scope changed. Refresh the report before exporting.');
  }
  return scope;
}

export const machineCountLabel = (count: number) => `${count} ${count === 1 ? 'machine' : 'machines'}`;
