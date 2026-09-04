import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL(
    '../../supabase/migrations/20260904203000_refund_mall_of_louisiana_location_repair.sql',
    import.meta.url
  ),
  'utf8'
);
const publicLabelHotfix = fs.readFileSync(
  new URL(
    '../../supabase/migrations/20260904210000_refund_location_binding_public_label_hotfix.sql',
    import.meta.url
  ),
  'utf8'
);
const fixture = fs.readFileSync(
  new URL(
    '../../supabase/tests/refund_mall_of_louisiana_location_repair.sql',
    import.meta.url
  ),
  'utf8'
);

function extractFunction(source, name) {
  const start = source.search(
    new RegExp(`create(?: or replace)? function public\\.${name}\\(`, 'u')
  );
  assert.notEqual(start, -1, `${name} definition must exist`);
  const end = source.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} definition must terminate`);
  return source.slice(start, end + 4);
}

test('production case and source identifiers stay out of repository artifacts', () => {
  for (const source of [migration, publicLabelHotfix, fixture]) {
    assert.doesNotMatch(source, /RF-[A-F0-9]{8}\b/u);
    assert.doesNotMatch(source, /customer_[a-z0-9.+-]*@bloomjoy/u);
  }
});

test('forward hotfix binds source eligibility to the reviewed public label', () => {
  assert.match(
    publicLabelHotfix,
    /source_machine\.refund_public_display_label = 'Gonzales Tanger Outlet'/u
  );
  assert.match(
    publicLabelHotfix,
    /source_machine\.refund_public_display_label is distinct from 'Gonzales Tanger Outlet'/u
  );
  assert.doesNotMatch(
    publicLabelHotfix,
    /source_machine\.machine_label (?:=|is distinct from) 'Gonzales Tanger Outlet'/u
  );
  assert.match(
    publicLabelHotfix,
    /create or replace function public\.service_refund_location_binding_correction_context/u
  );
  assert.match(
    publicLabelHotfix,
    /create or replace function public\.service_correct_refund_location_binding/u
  );

  const contextName = 'service_refund_location_binding_correction_context';
  const expectedContext = extractFunction(migration, contextName)
    .replace('create function', 'create or replace function')
    .replace(
      "source_machine.machine_label = 'Gonzales Tanger Outlet'",
      "source_machine.refund_public_display_label = 'Gonzales Tanger Outlet'"
    );
  assert.equal(extractFunction(publicLabelHotfix, contextName), expectedContext);

  const correctionName = 'service_correct_refund_location_binding';
  const expectedCorrection = extractFunction(migration, correctionName)
    .replace('create function', 'create or replace function')
    .replace(
      "source_machine.machine_label is distinct from 'Gonzales Tanger Outlet'",
      "source_machine.refund_public_display_label is distinct from 'Gonzales Tanger Outlet'"
    );
  assert.equal(extractFunction(publicLabelHotfix, correctionName), expectedCorrection);
});

test('catalog repair keeps provider and source identities absent', () => {
  assert.match(migration, /sunze_machine_id,[\s\S]*?null,[\s\S]*?'active'/u);
  assert.match(migration, /nayax_machine_id is null/u);
  assert.match(migration, /nayax_account_key is null/u);
  assert.match(migration, /nayax_refunds_enabled is distinct from false/u);
  assert.match(migration, /'sourceMappingChanged', false/u);
  assert.doesNotMatch(migration, /sunze_machine_id\s*=\s*'[^']+'/u);
  assert.doesNotMatch(migration, /nayax_machine_id\s*=\s*'[^']+'/u);
  assert.doesNotMatch(migration, /nayax_account_key\s*=\s*'[^']+'/u);
});

test('case mutation is private, digest-bound, same-case, and side-effect checked', () => {
  assert.match(
    migration,
    /grant execute on function public\.service_correct_refund_location_binding\([\s\S]*?to service_role;/u
  );
  assert.match(
    migration,
    /revoke all on function public\.service_correct_refund_location_binding\([\s\S]*?from public, anon, authenticated;/u
  );
  assert.match(migration, /refund_location_binding_case_digest\(case_row\.id\)/u);
  assert.match(migration, /updated_case\.id is distinct from case_row\.id/u);
  assert.match(migration, /updated_case\.public_reference is distinct from case_row\.public_reference/u);
  assert.match(migration, /updated_case\.issue_summary is distinct from case_row\.issue_summary/u);
  assert.match(migration, /updated_case\.deterministic_fact_version <> case_row\.deterministic_fact_version \+ 1/u);
  assert.match(migration, /nayax_lookup_status is distinct from 'not_started'/u);
  assert.match(migration, /Location correction created an unauthorized side effect/u);
  for (const flag of [
    'customerMessageCreated',
    'providerCallMade',
    'refundAttemptCreated',
    'receiptCreated',
    'adjustmentCreated',
    'paymentAction',
  ]) {
    assert.match(migration, new RegExp(`'${flag}', false`, 'u'));
  }
});

test('database fixture covers catalog visibility, stale guards, lookup invalidation, and replay', () => {
  for (const phrase of [
    'The customer selector exposes one unique exact Mall of Louisiana choice',
    'Private context accepts the exact reviewed public label when its internal operational label differs',
    'A stale or unrelated case digest fails before mutation',
    'A wrong expected source machine ID still fails before mutation',
    'A wrong public display label still fails before mutation',
    'Existing fact-version recovery increments once and invalidates the stale lookup',
    'No message, candidate, attempt, receipt, adjustment, decision, completion, or payment is created',
    'An exact replay returns the original safe outcome without a second mutation',
    'Case correction leaves the pending sales source and historical row unbound and unpromoted',
  ]) {
    assert.match(fixture, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
});
