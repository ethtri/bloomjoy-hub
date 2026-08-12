import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const migration = read('supabase/migrations/20260812160000_refund_case_manager_assignment.sql');
const pgTap = read('supabase/tests/refund_case_manager_assignment.sql');
const portalUat = read('scripts/refunds/validate-refund-portal-uat.mjs');
const decisions = read('Docs/DECISIONS.md');

assert.match(
  migration,
  /before insert on public\.refund_cases[\s\S]*assign_refund_case_manager_on_machine_binding\(\)/i,
  'Direct inserts must use the database manager-assignment boundary.',
);
assert.match(
  migration,
  /before update of reporting_machine_id on public\.refund_cases[\s\S]*reporting_machine_id is distinct from old\.reporting_machine_id/i,
  'Only a changed machine binding may implicitly reconsider an existing assignment.',
);
assert.match(
  migration,
  /pg_advisory_xact_lock\([\s\S]*machine_manager:/i,
  'Case binding must serialize with Admin Machines mapping changes.',
);
assert.match(
  migration,
  /when count\(\*\) = 1[\s\S]*assigned_sole_current_manager/i,
  'Automatic assignment must require exactly one current active mapping.',
);
assert.match(
  migration,
  /admin_review_no_current_manager[\s\S]*admin_review_multiple_current_managers/i,
  'Zero and multiple mappings must remain explicit admin-review states.',
);
assert.match(
  migration,
  /service_backfill_open_refund_case_manager_assignments[\s\S]*manager_assignment_backfilled[\s\S]*payload_redacted[\s\S]*official_action/i,
  'Eligible existing open cases must be repaired with redacted non-official audit evidence.',
);
assert.doesNotMatch(
  migration,
  /grant execute on function public\.service_backfill_open_refund_case_manager_assignments\(\)/i,
  'The one-time repair must not leave a runtime mutation grant.',
);
assert.match(
  migration,
  /revoke execute on function public\.service_backfill_open_refund_case_manager_assignments\(\)[\s\S]*from service_role/i,
  'The migration must explicitly remove service-role repair access after the one-time run.',
);
assert.match(
  pgTap,
  /Email-linked form completion assigns the sole current mapped manager atomically/i,
  'pgTAP must execute the private email-context RPC and prove mapped ownership.',
);
assert.match(
  pgTap,
  /Direct intake assigns the sole current manager/i,
  'pgTAP must prove the direct website insert uses the same rule.',
);
assert.match(
  pgTap,
  /A deliberate current owner can be selected when multiple managers exist/i,
  'pgTAP must prove explicit current ownership survives at insert time.',
);
assert.match(
  pgTap,
  /Changing machines clears a stale explicit owner and assigns the new sole current manager/i,
  'pgTAP must prove stale ownership cannot survive a machine change.',
);
assert.match(
  pgTap,
  /CC resolution includes the complete current mapping set independently of ownership assignment/i,
  'pgTAP must prove customer CC resolution remains independent and complete.',
);
assert.match(
  portalUat,
  /\/refunds\/request\?emailContext=/i,
  'Browser UAT must retain the private email-context journey.',
);
assert.match(
  portalUat,
  /submission\.emailContextToken === journey\.expectedEmailContextToken/i,
  'Browser UAT must prove the opaque email context reaches intake unchanged.',
);
assert.match(
  decisions,
  /Exactly one current mapping is assigned automatically/i,
  'The deterministic ownership rule must remain documented.',
);

console.log('Refund case manager assignment boundary validated.');
