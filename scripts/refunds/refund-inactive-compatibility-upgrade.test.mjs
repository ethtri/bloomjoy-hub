import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INACTIVE_GIFT_MIGRATIONS, stageInactiveGiftMigrations, writeInactiveGiftCompatibilityTest } from './refund-inactive-compatibility-upgrade.mjs';

test('production-order staging fixes the baseline through234847 and restores reviewed file bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refund-inactive-order-'));
  try {
    const directory = path.join(root, 'supabase/migrations');
    fs.mkdirSync(directory, { recursive: true });
    const later = '20261001010518_refund_future_synthetic.sql';
    for (const name of [...INACTIVE_GIFT_MIGRATIONS, later, '20260930234847_refund_api_receipt_completion_handoff.sql']) fs.writeFileSync(path.join(directory, name), name);
    const restore = stageInactiveGiftMigrations(root);
    assert.deepEqual(fs.readdirSync(directory), ['20260930234847_refund_api_receipt_completion_handoff.sql']);
    restore();
    for (const name of [...INACTIVE_GIFT_MIGRATIONS, later]) assert.equal(fs.readFileSync(path.join(directory, name), 'utf8'), name);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('compatibility fixture preserves all 81 receipt tests and adds twelve disabled assertions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refund-inactive-fixture-'));
  try {
    fs.mkdirSync(path.join(root, 'supabase/tests'), { recursive: true });
    const fixture = writeInactiveGiftCompatibilityTest(process.cwd(), root);
    const text = fs.readFileSync(fixture.testPath, 'utf8');
    assert.ok(text.includes('select plan(93);'));
    assert.ok(text.includes('No compatibility provider preparation'));
    assert.ok(text.includes('Original thread creator preserved'));
    assert.ok(text.trimEnd().endsWith('rollback;'));
    assert.ok(!text.includes('REFUND_GIFT_CARD_PROVIDER'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
