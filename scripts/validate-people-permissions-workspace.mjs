import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const [consoleSource, payoutSource, directorySource, migrationSource, machinePickerSource] = await Promise.all([
  readFile(new URL('../src/pages/admin/accessPersonConsole.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/admin/Payouts.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/adminPeopleDirectory.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260913080054_people_permissions_directory.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/technicians/TechnicianMachineAssignmentPicker.tsx', import.meta.url), 'utf8'),
]);

for (const expected of [
  'Search by name or email',
  'Needs attention',
  'All accounts',
  'All machines',
  'Edit permissions',
  'Technician pay setup',
  'sm:max-w-[clamp(720px,60vw,900px)]',
  'Open full screen',
  'Machine assignments',
  'Manage machines',
  'Active permissions',
  'Add access type',
  'Revoke Technician access',
  'Additional access details',
]) assert.ok(consoleSource.includes(expected), `missing people workspace contract: ${expected}`);

const newWorkspaceSource = consoleSource.slice(consoleSource.indexOf('function AdminPersonAccessConsoleInner'), consoleSource.indexOf('function LegacyAdminPersonAccessConsoleInner'));
assert.ok(!newWorkspaceSource.includes('Refresh sales'), 'new workspace must not expose a manual sales refresh');
assert.ok(!newWorkspaceSource.includes('<CustomerContextCard'), 'new workspace must not expose customer context');
assert.match(newWorkspaceSource, /showActivity && <PersonActivityPanel/, 'activity must load only when expanded');
assert.match(newWorkspaceSource, /layout.*full/, 'expanded detail state must survive URL synchronization');
assert.match(consoleSource, /label="Scope after save"[\s\S]*?selectedFirst/, 'machine editor must put current assignments before available machines');
assert.ok(machinePickerSource.includes("locationName: 'Current assignments'"), 'machine picker must label current assignments');
assert.ok(machinePickerSource.includes("locationName: 'Available machines'"), 'machine picker must label available machines');
assert.match(consoleSource, /next\.toString\(\) !== searchParams\.toString\(\)/, 'directory URL state must not restart unchanged reads');
assert.match(payoutSource, /searchParams\.get\('technician'\)/, 'pay report must accept technician deep links');
assert.match(directorySource, /admin_list_access_people/, 'directory client must use the scoped roster RPC');
assert.match(migrationSource, /security definer[\s\S]*set search_path = ''/, 'directory definer must use an empty search path');
assert.match(migrationSource, /not public\.is_admin\(actor_user_id\)/, 'directory must enforce the admin boundary');
assert.match(migrationSource, /public\.scoped_admin_machine_ids\(actor_user_id\)/, 'directory must scope non-global admins');
assert.match(migrationSource, /revoke all on function public\.admin_list_access_people[\s\S]*from public, anon/, 'directory RPC must not be public or anonymous');

console.log('People & Permissions workspace contract passed.');
