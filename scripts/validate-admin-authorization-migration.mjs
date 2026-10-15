#!/usr/bin/env node
// Disposable database only. All catalogue changes stay inside a rolled-back transaction.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';

const port = Number(process.argv[2]);
assert(Number.isInteger(port) && port > 0 && port < 65536,
  'Usage: node scripts/validate-admin-authorization-migration.mjs <disposable-db-port>');
const root = new URL('../supabase/migrations/', import.meta.url);
const migration = fs.readFileSync(new URL('20261012184650_admin_authorization_baseline.sql', root), 'utf8');
assert.equal((migration.match(/^begin;$/gmi) ?? []).length, 1);
assert.equal((migration.match(/^commit;$/gmi) ?? []).length, 1);
// Use a savepoint around the exact migration body to keep the catalogue disposable.
const body = migration.replace(/^(?:begin|commit);\s*$/gmi, '');
const historicalHelper = fs.readFileSync(new URL('202605070001_partner_report_scheduler_pdf_export.sql', root), 'utf8')
  .match(/create or replace function public\.is_super_admin\(uid uuid\)[\s\S]*?\$\$;/)[0];
const signatures = [...migration.matchAll(/'((?:public\.admin_)[^']+\))'/g)].map(match => match[1]);
assert.equal(signatures.length, 9);
const targets = new Set(['public.is_super_admin(uuid)', ...signatures]);
const client = new pg.Client({host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres'});
const snapshot = async () => (await client.query(`
 select p.oid::regprocedure::text identity, pg_get_functiondef(p.oid) definition,
   to_jsonb(p) - 'prosrc' contract
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.prokind='f'
 order by p.oid
`)).rows;
const restore = async rows => {
  for (const row of rows.filter(row => targets.has(row.identity))) await client.query(row.definition);
};
await client.connect();
try {
  await client.query("begin; set local lock_timeout='5s'; set local statement_timeout='30s'");
  // regprocedure text omits public with the default search path; qualify it for comparisons.
  await client.query("set local search_path = pg_catalog");
  const repaired = await snapshot();
  assert.equal(repaired.filter(row => targets.has(row.identity)).length, 10);
  // Reconstruct the immediately preceding entry guards without reverting later business logic.
  for (const row of repaired.filter(row => signatures.includes(row.identity))) {
    const original = row.definition
      .replace('if actor_user_id is null or public.is_super_admin(actor_user_id) is not true then',
        'if actor_user_id is null or not public.is_super_admin(actor_user_id) then')
      .replace('if auth.uid() is null or public.is_super_admin(auth.uid()) is not true then',
        'if not public.is_super_admin(auth.uid()) then');
    assert.notEqual(original, row.definition, `Expected repaired entry guard: ${row.identity}`);
    await client.query(original);
  }
  await client.query(historicalHelper);
  const baseline = await snapshot();
  await client.query('savepoint forward_check');
  await client.query(body);
  const forward = await snapshot();
  assert.equal(forward.length, baseline.length);
  for (let i = 0; i < baseline.length; i++) {
    assert.deepEqual(forward[i].contract, baseline[i].contract,
      `Function contract/owner/ACL/config must survive: ${baseline[i].identity}`);
    if (!targets.has(baseline[i].identity)) assert.equal(forward[i].definition, baseline[i].definition);
  }
  assert.deepEqual(forward, repaired, 'Forward migration exactly matches the reviewed catalogue');
  await client.query('rollback to savepoint forward_check');
  assert.deepEqual(await snapshot(), baseline, 'Transaction rollback restores every definition and contract');
  // Make the final expected RPC drift, so the migration must undo earlier replacements too.
  const last = signatures.at(-1);
  const drifted = baseline.find(row => row.identity === last).definition
    .replace('if actor_user_id is null or not public.is_super_admin(actor_user_id) then',
      'if actor_user_id is null or public.is_super_admin(actor_user_id) is not true then');
  await client.query(drifted);
  const driftSnapshot = await snapshot();
  await client.query('savepoint catalogue_failure');
  await assert.rejects(client.query(body), /Unexpected administration RPC catalogue/);
  await client.query('rollback to savepoint catalogue_failure');
  assert.deepEqual(await snapshot(), driftSnapshot, 'Catalogue mismatch leaves no partial repair');
  // Exercise the release rollback plan: restore exact captured pre-change definitions.
  await restore(baseline);
  await client.query(body);
  await restore(baseline);
  assert.deepEqual(await snapshot(), baseline, 'Captured-definition rollback restores all ten functions');
  console.log('PASS: ten function contracts preserved; unrelated catalogue unchanged; forward, atomic failure and captured-definition rollback verified.');
} finally {
  await client.query('rollback');
  await client.end();
}
