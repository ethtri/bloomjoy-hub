import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareCorrectionMigrationWindowsRegression } from '../validate-supabase-migrations.mjs';

const migrationName = '20260903200000_refund_correction_message_delivery.sql';
const actualMigration = fs.readFileSync(new URL(`../../supabase/migrations/${migrationName}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const oneManagerMigrationName = '20260906230000_refund_one_manager_decision.sql';
const actualOneManagerMigration = fs.readFileSync(
  new URL(`../../supabase/migrations/${oneManagerMigrationName}`, import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');
const liveManagerReservationDefinition = fs.readFileSync(
  new URL('./fixtures/service-reserve-nayax-refund-manager-action.production.sql', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');
const liveManagerReservationDefinitionSha256 = '2d1200d2698c22d9d2487b647b78fe0edb98b93eef462ddaed0f054fcac185c5';

const extractDollarQuotedAssignment = (source, name, tag) => {
  const prefix = `${name} text := $${tag}$`;
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, `${name} declaration is required`);
  const valueStart = start + prefix.length;
  const suffix = `$${tag}$;`;
  const end = source.indexOf(suffix, valueStart);
  assert.notEqual(end, -1, `${name} closing tag is required`);
  return source.slice(valueStart, end);
};

const countOccurrences = (source, needle) => source.split(needle).length - 1;

function removeFixture(root) {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('refund-correction-crlf-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}

test('disposable apply receives the complete actual correction migration as CRLF from either checkout', () => {
  for (const checkoutSource of [actualMigration, actualMigration.replaceAll('\n', '\r\n')]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refund-correction-crlf-'));
    try {
      fs.mkdirSync(path.join(root, 'migrations'));
      const target = path.join(root, 'migrations', migrationName);
      fs.writeFileSync(target, checkoutSource);
      const adoptionName = '20260904182000_refund_owner_nonrefund_adoption.sql';
      const adoptionSource = fs.readFileSync(new URL(`../../supabase/migrations/${adoptionName}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
      fs.writeFileSync(path.join(root, 'migrations', adoptionName), adoptionSource);
      fs.writeFileSync(path.join(root, 'migrations', oneManagerMigrationName), actualOneManagerMigration);
      prepareCorrectionMigrationWindowsRegression(root);
      const prepared = fs.readFileSync(target, 'utf8');
      const preparedOneManager = fs.readFileSync(
        path.join(root, 'migrations', oneManagerMigrationName),
        'utf8',
      );
      assert.equal(fs.readFileSync(path.join(root, 'migrations', adoptionName), 'utf8'), adoptionSource.replaceAll('\n', '\r\n'));
      assert.equal(prepared, actualMigration.replaceAll('\n', '\r\n'));
      assert.equal(prepared.replaceAll('\r\n', '\n'), actualMigration, 'all SQL and exact-match guards remain unchanged');
      assert.equal(preparedOneManager, actualOneManagerMigration.replaceAll('\n', '\r\n'));
      assert.ok(prepared.includes('$legacy_fields$'));
      assert.ok(!/(?<!\r)\n/u.test(prepared), 'the real dollar-quoted needle reaches PostgreSQL with CRLF');
      assert.ok(!/(?<!\r)\n/u.test(preparedOneManager), 'the one-manager anchors reach PostgreSQL with CRLF');
    } finally {
      removeFixture(root);
    }
  }
});

test('one-manager reservation rewrites normalize Windows anchors before matching the observed production definition', () => {
  assert.equal(
    crypto.createHash('sha256').update(liveManagerReservationDefinition).digest('hex'),
    liveManagerReservationDefinitionSha256,
    'the read-only production function-definition fixture must remain exact',
  );
  const windowsMigration = actualOneManagerMigration.replaceAll('\n', '\r\n');
  const replacements = [
    ['decision_actor_anchor', 'decision_actor_replacement'],
    ['version_anchor', 'version_replacement'],
    ['approval_event_anchor', 'approval_event_replacement'],
  ];
  let rewritten = liveManagerReservationDefinition;

  for (const [anchorName, replacementName] of replacements) {
    const windowsAnchor = extractDollarQuotedAssignment(windowsMigration, anchorName, 'anchor');
    const normalizedAnchor = windowsAnchor.replaceAll('\r\n', '\n');
    const normalizedReplacement = extractDollarQuotedAssignment(
      windowsMigration,
      replacementName,
      'replacement',
    ).replaceAll('\r\n', '\n');
    assert.equal(countOccurrences(liveManagerReservationDefinition, windowsAnchor), 0);
    assert.equal(countOccurrences(rewritten, normalizedAnchor), 1, `${anchorName} must match exactly once`);
    rewritten = rewritten.split(normalizedAnchor).join(normalizedReplacement);
  }

  for (const variable of [
    'decision_actor_anchor',
    'decision_actor_replacement',
    'version_anchor',
    'version_replacement',
    'approval_event_anchor',
    'approval_event_replacement',
    'readiness_anchor',
    'readiness_replacement',
    'reservation_anchor',
    'reservation_replacement',
    'anchor',
    'replacement',
  ]) {
    assert.ok(
      actualOneManagerMigration.includes(`${variable} := replace(${variable}, E'\\r\\n', E'\\n');`),
      `${variable} must be normalized before use`,
    );
  }

  assert.match(rewritten, /Saved Nayax approval changed before execution; reload for review/);
  assert.match(rewritten, /business_approval_reused/);
  assert.match(rewritten, /refund_nayax_current_manager_approval_pending/);
  assert.match(rewritten, /can_perform_refund_official_action/);
  assert.match(rewritten, /This Nayax transaction is already linked to another refund case/);
});

test('missing actual migration fails instead of silently dropping Windows application coverage', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refund-correction-crlf-'));
  try {
    assert.throws(() => prepareCorrectionMigrationWindowsRegression(root), { code: 'ENOENT' });
  } finally {
    removeFixture(root);
  }
});
