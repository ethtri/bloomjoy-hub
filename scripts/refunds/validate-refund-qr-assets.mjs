#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import QRCode from 'qrcode';

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');
const [
  assetSource,
  managerSource,
  clientSource,
  migrationSource,
  packageSource,
] = await Promise.all([
  read('src/lib/refundQrAssets.ts'),
  read('src/components/refunds/RefundQrAssetManager.tsx'),
  read('src/lib/refundOperations.ts'),
  read('supabase/migrations/202607260003_refund_machine_qr_asset_management.sql'),
  read('package.json'),
]);

const packageJson = JSON.parse(packageSource);
const normalizedManagerSource = managerSource.replace(/\s+/g, ' ');
assert.equal(typeof packageJson.dependencies?.qrcode, 'string');
assert.equal(typeof packageJson.devDependencies?.jsqr, 'string');
assert.equal(typeof packageJson.devDependencies?.pngjs, 'string');

const syntheticPublicCode = 'refund_qr_asset_validation_public_code_000001';
const expectedUrl =
  `https://app.bloomjoyusa.com/refunds/request?qr=${syntheticPublicCode}`;
const pngBuffer = await QRCode.toBuffer(expectedUrl, {
  type: 'png',
  errorCorrectionLevel: 'H',
  margin: 4,
  width: 720,
});
const png = PNG.sync.read(pngBuffer);
const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);

assert.ok(decoded, 'The generated QR bitmap must decode.');
assert.equal(decoded.data, expectedUrl);
assert.match(decoded.data, /^https:\/\/app\.bloomjoyusa\.com\/refunds\/request\?qr=/);
assert.ok(!decoded.data.includes('93000000-0000-4000-8000-000000000001'));
assert.ok(!decoded.data.includes('nayax'));

assert.match(assetSource, /REFUND_QR_APP_ORIGIN = APP_ORIGIN/);
assert.match(assetSource, /publicQrPathPattern/);
assert.doesNotMatch(assetSource, /window\.location\.origin/);
assert.match(assetSource, /Need refund help\?/);
assert.match(assetSource, /Download print asset|downloadRefundQrPrintAsset/);
assert.match(assetSource, /Version \$\{safeVersion\}/);

for (const requiredCopy of [
  'does not approve a refund or prove failed delivery',
  'Real-phone scan verified',
  'Rotate after loss, damage, or incorrect placement',
  'no Nayax ID, database ID, customer data, or payment data',
]) {
  assert.ok(
    normalizedManagerSource.includes(requiredCopy),
    `QR manager must retain safety copy: ${requiredCopy}`
  );
}

for (const requiredClientContract of [
  'admin_manage_refund_machine_qr',
  'admin_update_refund_qr_rollout',
  "action: 'create' | 'rotate' | 'disable'",
  "'verify_phone'",
]) {
  assert.ok(
    clientSource.includes(requiredClientContract),
    `Refund client contract must include ${requiredClientContract}`
  );
}

for (const requiredSqlContract of [
  'admin_manage_refund_machine_qr',
  'admin_update_refund_qr_rollout',
  "normalized_action not in ('create', 'rotate', 'disable')",
  "status = 'retired'",
  "status = 'disabled'",
  'public_code_redacted',
  'public.can_access_machine',
  'coalesce(public.can_access_machine',
  'public.is_scoped_admin',
  'public.is_super_admin',
  'reporting_machines_disable_refund_qr_with_intake',
  'phone_verified_at',
  'replacement_owner_role',
]) {
  assert.ok(
    migrationSource.includes(requiredSqlContract),
    `QR migration must include ${requiredSqlContract}`
  );
}

assert.doesNotMatch(
  migrationSource,
  /'publicCode'\s*,/,
  'Admin payloads must not expose a standalone public-code field.'
);
assert.doesNotMatch(
  migrationSource,
  /'public_code'\s*,\s*(?:active_qr|result_qr|updated_qr)\.public_code/,
  'Audit objects must never contain the public code.'
);

console.log('Refund QR asset validator passed.');
console.log('- production-origin opaque URL contract');
console.log('- high-error-correction QR generated and decoded');
console.log('- scoped create/rotate/disable and sequential rollout checks');
console.log('- print/mobile safety copy and redacted audit contract');
