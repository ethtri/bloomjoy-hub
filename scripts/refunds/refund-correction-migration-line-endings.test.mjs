import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareCorrectionMigrationWindowsRegression } from '../validate-supabase-migrations.mjs';

const migrationName = '20260903200000_refund_correction_message_delivery.sql';
const actualMigration = fs.readFileSync(new URL(`../../supabase/migrations/${migrationName}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');

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
      prepareCorrectionMigrationWindowsRegression(root);
      const prepared = fs.readFileSync(target, 'utf8');
      assert.equal(fs.readFileSync(path.join(root, 'migrations', adoptionName), 'utf8'), adoptionSource.replaceAll('\n', '\r\n'));
      assert.equal(prepared, actualMigration.replaceAll('\n', '\r\n'));
      assert.equal(prepared.replaceAll('\r\n', '\n'), actualMigration, 'all SQL and exact-match guards remain unchanged');
      assert.ok(prepared.includes('$legacy_fields$'));
      assert.ok(!/(?<!\r)\n/u.test(prepared), 'the real dollar-quoted needle reaches PostgreSQL with CRLF');
    } finally {
      removeFixture(root);
    }
  }
});

test('missing actual migration fails instead of silently dropping Windows application coverage', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refund-correction-crlf-'));
  try {
    assert.throws(() => prepareCorrectionMigrationWindowsRegression(root), { code: 'ENOENT' });
  } finally {
    removeFixture(root);
  }
});
