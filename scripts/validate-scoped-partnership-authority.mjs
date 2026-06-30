import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const migrationPath = path.join(
  repoRoot,
  'supabase',
  'migrations',
  '202606290001_scoped_admin_partnership_authority.sql'
);
const decisionsPath = path.join(repoRoot, 'Docs', 'DECISIONS.md');

const fail = (message) => {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
};

const pass = (message) => {
  console.log(`PASS ${message}`);
};

const assertIncludes = (content, needle, message) => {
  if (content.includes(needle)) {
    pass(message);
    return;
  }

  fail(`${message} - missing ${needle}`);
};

const assertRegex = (content, pattern, message) => {
  if (pattern.test(content)) {
    pass(message);
    return;
  }

  fail(`${message} - missing pattern ${pattern}`);
};

const migration = await readFile(migrationPath, 'utf8');
const decisions = await readFile(decisionsPath, 'utf8');

[
  'public.admin_can_manage_scoped_partnership(',
  'public.admin_can_manage_scoped_reporting_partner(',
  'public.admin_can_manage_scoped_partnership_machine(',
  'public.admin_get_partnership_reporting_setup()',
  'public.admin_upsert_reporting_partnership(',
  'public.admin_upsert_reporting_machine_assignment(',
  'public.admin_upsert_reporting_partnership_party(',
  'public.admin_remove_reporting_partnership_party(',
  'public.admin_upsert_reporting_financial_rule(',
  'public.admin_archive_reporting_partnership(',
].forEach((needle) => assertIncludes(migration, needle, `${needle} is defined or granted`));

assertIncludes(
  migration,
  "array['access', 'reporting_access', 'refunds', 'partnerships']",
  'Scoped Admin context exposes partnerships without wildcard access'
);
assertIncludes(
  migration,
  'public.admin_can_manage_scoped_partnership(actor_user_id, partnership.id)',
  'Setup listing filters partnerships through scoped partnership helper'
);
assertIncludes(
  migration,
  'public.admin_can_manage_scoped_partnership_machine(actor_user_id, p_machine_id)',
  'Machine assignment RPC checks scoped machine authority'
);
assertIncludes(
  migration,
  "after_row.status = 'active'",
  'Machine assignment post-save guard applies to active assignments'
);
assertIncludes(
  migration,
  'Scoped Admin can assign only machines inside assigned machine scope',
  'Out-of-scope machine assignment fails closed with clear error'
);
assertIncludes(
  migration,
  'Scoped Admin can manage only partnerships wholly inside assigned machine scope',
  'Out-of-scope partnership update fails closed with clear error'
);
assertIncludes(
  migration,
  'Scoped Admin can archive only partnerships wholly inside assigned machine scope',
  'Out-of-scope partnership archive fails closed with clear error'
);
assertRegex(
  migration,
  /'actorAuthority', case when actor_is_super_admin then 'super_admin' else 'scoped_admin' end/g,
  'Scoped mutations audit actor authority'
);
assertRegex(
  migration,
  /grant execute on function public\.admin_(get_partnership_reporting_setup|upsert_reporting_partnership|upsert_reporting_machine_assignment|upsert_reporting_partnership_party|remove_reporting_partnership_party|upsert_reporting_financial_rule|archive_reporting_partnership)/g,
  'Changed partnership RPCs keep authenticated execute grants'
);

assertIncludes(
  decisions,
  "Scoped Admins may manage partnership setup only when the partnership's current primary-reporting machines are wholly inside their active machine grant.",
  'Decision log documents scoped partnership machine-scope rule'
);
assertIncludes(
  decisions,
  'Scoped Admin partnership authority does not grant global Partner Records',
  'Decision log documents global-surface exclusions'
);

if (process.exitCode) {
  console.error('\nScoped partnership authority validation failed.');
  process.exit(process.exitCode);
}

console.log('\nScoped partnership authority validation passed.');
