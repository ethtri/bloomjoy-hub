#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseDtmWorkbook, summarizeDtmRecords } from './dtm-history.mjs';

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index < 0 ? null : args[index + 1] ?? null;
};

const manifestPath = valueAfter('--manifest');
if (!manifestPath) {
  console.error('Usage: node scripts/nayax/reconcile-dtm-history.mjs --manifest <private-manifest.json>');
  process.exit(1);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (!Array.isArray(manifest.exports)) throw new Error('nayax_dtm_manifest_invalid');

// Monthly files are validation samples that overlap the annual source. They are
// checked against the annual controls but never returned as import candidates.
const imports = manifest.exports.filter((entry) =>
  /2025_full_account\.xlsx$/i.test(entry.file) ||
  /2026-01-01_to_2026-09-27_full_account\.xlsx$/i.test(entry.file)
);
if (imports.length !== 2) throw new Error('nayax_dtm_manifest_import_set_invalid');

const root = path.dirname(path.resolve(manifestPath));
const files = [];
for (const entry of manifest.exports) {
  const parsed = parseDtmWorkbook(await readFile(path.join(root, entry.file)));
  const summary = summarizeDtmRecords(parsed.records);
  const controls = {
    rows: summary.rowCount === Number(entry.rows),
    authorization: summary.authorizationCents === Math.round(Number(entry.authorization_total) * 100),
    settlement: summary.settlementCents === Math.round(Number(entry.settlement_total) * 100),
    refundAnnotation: summary.refundCents === Math.round(Number(entry.refund_total) * 100),
  };
  if (Object.values(controls).some((passed) => !passed)) {
    throw new Error('nayax_dtm_manifest_control_mismatch');
  }
  // Status 12 is Nayax's successful/settled state. Settlement Value is the
  // captured revenue basis and may legitimately differ from authorization.
  const settledSaleRows = parsed.records.filter((row) =>
    row.providerStatus === 12 && (row.settlementAmountCents ?? 0) > 0
  );
  // Status 62/63 originals carry refund annotations, while the export also
  // contains distinct negative event rows. Keep both sides out of recognized
  // revenue until their once-only event identity can be reconciled.
  const refundedOriginalRows = parsed.records.filter((row) =>
    [62, 63].includes(row.providerStatus) && (row.settlementAmountCents ?? 0) > 0
  );
  const refundEventCandidates = parsed.records.filter((row) =>
    row.providerStatus === null && row.providerType === 1 &&
    (row.authorizationAmountCents ?? 0) < 0 &&
    row.authorizationAmountCents === row.settlementAmountCents
  );
  files.push({
    period: entry.period,
    role: imports.includes(entry) ? 'import_candidate' : 'overlap_control_only',
    controls,
    source: summary,
    classified: {
      settledSaleRows: settledSaleRows.length,
      settledSaleSettlementCents: settledSaleRows.reduce(
        (total, row) => total + row.settlementAmountCents,
        0,
      ),
      settledAuthorizationDiffersRows: settledSaleRows.filter((row) =>
        row.authorizationAmountCents !== row.settlementAmountCents
      ).length,
      refundedOriginalRows: refundedOriginalRows.length,
      refundedOriginalSettlementCents: refundedOriginalRows.reduce(
        (total, row) => total + row.settlementAmountCents,
        0,
      ),
      refundedOriginalProjection: 'held_with_negative_event_pending_exact_dedup',
      refundEventCandidateRows: refundEventCandidates.length,
      refundEventCandidateCents: refundEventCandidates.reduce(
        (total, row) => total - row.settlementAmountCents,
        0,
      ),
      refundProjection: 'held_pending_exact_dedup',
      refundAmountColumn: 'control_only_do_not_subtract',
    },
  });
}

console.log(JSON.stringify({
  source: 'nayax_manual_dtm_export',
  currency: manifest.currency_interpretation,
  importFiles: imports.length,
  overlapControlFiles: manifest.exports.length - imports.length,
  files,
}, null, 2));
