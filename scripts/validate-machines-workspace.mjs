import { readFile } from 'node:fs/promises';

const [appSource, machinesSource, machineUatSource] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/admin/Machines.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./refunds/validate-machine-manager-uat.mjs', import.meta.url), 'utf8'),
]);

const checks = [
  ['machine detail route', appSource.includes('path="/admin/machines/:machineId"')],
  ['dedicated Nayax inventory route', appSource.includes('path="/admin/machines/inventory"')],
  ['single compact machine row', machinesSource.includes('function MachinePortfolioRow')],
  ['attention-first portfolio view', machinesSource.includes("useState<MachineView>(() => parseMachineView(searchParams.get('view')))" )],
  ['task-focused machine workspace', machinesSource.includes("mode === 'page' && machine")],
  ['machine detail tabs', ['overview', 'refunds', 'managers', 'reporting', 'activity'].every((tab) => machinesSource.includes(`value: '${tab}'`))],
  ['explicit Machine Manager save and cancel', machinesSource.includes('Save managers') && machinesSource.includes('cancelMachineManagerChanges')],
  ['manager assignment and invitation are separate', machinesSource.includes("managerFlow === 'assign'") && machinesSource.includes("managerFlow === 'invite'")],
  ['detail uses unfiltered machine data', machinesSource.includes('allMachineRows.find((row) => row.machine.id === routeMachineId)')],
  ['sort persists in the URL', machinesSource.includes("nextParams.set('sort', nextSort)")],
  ['long portfolios load incrementally', machinesSource.includes('Load 20 more')],
  ['initial tax history starts at the reporting baseline', machinesSource.includes("effectiveStartDate: taxRate ? today() : initialReportingTaxStartDate")],
  ['Scoped Admin tax actions are hidden', machinesSource.includes('canEditMachineIdentity && (') && machinesSource.includes("'Change tax rate' : 'Set tax rate'")],
  ['no manager autosave copy', !machinesSource.includes('assignments autosave')],
  ['exceptions-first Nayax review', machinesSource.includes("inventoryView === 'attention'") && machinesSource.includes('No Nayax setup needs attention')],
  ['UAT waits for asynchronous field hydration', machineUatSource.includes('if (await predicate()) return;')],
  ['production PPV skips local-only demo assertions', machineUatSource.includes("if (arg === '--skip-demo')") && machineUatSource.includes('Production PPV skips local-only demo assertions')],
];

const failures = checks.filter(([, passed]) => !passed);

for (const [label, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`);
}

if (failures.length > 0) {
  process.exitCode = 1;
  throw new Error(`${failures.length} Machines workspace contract check(s) failed.`);
}

console.log('Machines workspace contract checks passed.');
