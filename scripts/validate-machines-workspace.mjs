import { readFile } from 'node:fs/promises';

const [appSource, machinesSource] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/admin/Machines.tsx', import.meta.url), 'utf8'),
]);

const checks = [
  ['machine detail route', appSource.includes('path="/admin/machines/:machineId"')],
  ['dedicated Nayax inventory route', appSource.includes('path="/admin/machines/inventory"')],
  ['single compact machine row', machinesSource.includes('function MachinePortfolioRow')],
  ['attention-first portfolio view', machinesSource.includes("useState<MachineView>(() => parseMachineView(searchParams.get('view')))" )],
  ['task-focused machine workspace', machinesSource.includes("mode === 'page' && machine")],
  ['machine detail tabs', ['overview', 'refunds', 'managers', 'reporting', 'activity'].every((tab) => machinesSource.includes(`value: '${tab}'`))],
  ['explicit Machine Manager save', machinesSource.includes('Save Machine Managers')],
  ['no manager autosave copy', !machinesSource.includes('assignments autosave')],
  ['exceptions-first Nayax review', machinesSource.includes("inventoryView === 'attention'") && machinesSource.includes('No Nayax setup needs attention')],
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
