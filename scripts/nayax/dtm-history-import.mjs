import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  canonicalNayaxDtmRowHash,
  canonicalNayaxRefundAnnotationHash,
  canonicalNayaxRefundEventHash,
  canonicalNayaxSourceOrderHash,
  normalizedMachineNameHash,
  parseDtmWorkbook,
  summarizeDtmRecords,
} from './dtm-history.mjs';

const POSITIVE_STATUSES = new Set([12, 62, 63]);

const periodFromFilename = (filename) => {
  if (/2025_full_account_stable_ids\.xlsx$/i.test(filename)) {
    return { periodStart: '2025-01-01T00:00:00Z', periodEnd: '2026-01-01T00:00:00Z', partial: false };
  }
  const match = /2026-(\d{2}-\d{2})_to_2026-(\d{2}-\d{2})(?:_partial)?_stable_ids\.xlsx$/i.exec(filename);
  if (!match) throw new Error('nayax_dtm_import_period_unknown');
  const start = `2026-${match[1]}T00:00:00Z`;
  const inclusiveEnd = new Date(`2026-${match[2]}T00:00:00Z`);
  inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() + 1);
  return {
    periodStart: start,
    periodEnd: inclusiveEnd.toISOString(),
    partial: /_partial_stable_ids\.xlsx$/i.test(filename),
  };
};

const providerStatusName = (status) => ({
  12: 'Settled',
  62: 'Refunded',
  63: 'Refund failed',
}[status] ?? 'Unclassified');

const toImportRow = (
  row,
  negativeOriginals,
  stagedMachineNames,
  inactiveHistoricalMachineNames,
  heldRefundIdentityHashes,
) => {
  const positive = POSITIVE_STATUSES.has(row.providerStatus) &&
    (row.settlementAmountCents ?? 0) > 0;
  const nativeRefund = row.providerType === 1 &&
    (row.settlementAmountCents ?? 0) < 0 &&
    row.originalTransactionId !== null;
  const missingNativeRefund = row.providerStatus === 62 &&
    row.isTransactionRefunded === true &&
    row.refundAmountCents === row.settlementAmountCents &&
    row.refundApprovedAt !== null &&
    !negativeOriginals.has(`${row.actorId}\u001f${row.transactionId}`);
  const refundIdentityHash = nativeRefund
    ? canonicalNayaxRefundEventHash(row)
    : missingNativeRefund
      ? canonicalNayaxRefundAnnotationHash(row)
      : null;
  return {
    sourceRowHash: canonicalNayaxDtmRowHash(row),
    sourceOrderHash: positive ? canonicalNayaxSourceOrderHash(row) : null,
    refundIdentityHash,
    refundEvidenceKind: nativeRefund
      ? 'native_event'
      : missingNativeRefund
        ? 'approved_original_annotation'
        : null,
    historicalMappingDisposition: stagedMachineNames.has(row.machineName)
      ? 'relocation_candidate'
      : inactiveHistoricalMachineNames.has(row.machineName)
        ? 'historical_inactive_exact_link'
        : 'canonical',
    financialDisposition: refundIdentityHash && heldRefundIdentityHashes.has(refundIdentityHash)
      ? 'hold_sheet_overlap'
      : 'eligible',
    machineNameHash: normalizedMachineNameHash(row.machineName),
    actorId: row.actorId,
    providerMachineId: row.providerMachineId,
    siteId: row.siteId,
    transactionId: row.transactionId,
    originalTransactionId: row.originalTransactionId,
    currencyCode: row.currencyCode,
    authorizationAmountCents: row.authorizationAmountCents,
    settlementAmountCents: row.settlementAmountCents,
    machineSettledAt: row.machineSettledAt,
    machineSaleDate: row.machineSettledAt?.slice(0, 10) ?? null,
    historyScopeDisposition: row.machineSettledAt?.slice(0, 10) < '2025-01-01'
      ? 'before_history_start'
      : 'in_scope',
    providerSettledAt: row.providerSettledAt,
    providerUpdatedAt: row.updatedAt,
    providerStatus: row.providerStatus,
    providerStatusName: providerStatusName(row.providerStatus),
    providerType: row.providerType,
    refundAmountCents: row.refundAmountCents,
    isTransactionRefunded: row.isTransactionRefunded,
    refundRequestedAt: row.refundRequestedAt,
    refundApprovedAt: row.refundApprovedAt,
  };
};

export async function buildDtmHistoryImport(
  files,
  { stagedMachineNames = [], inactiveHistoricalMachineNames = [], heldRefundIdentityHashes = [] } = {},
) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('nayax_dtm_import_files_required');
  const parsedFiles = [];
  for (const filename of files) {
    const bytes = await readFile(filename);
    const parsed = parseDtmWorkbook(bytes);
    parsedFiles.push({ filename, bytes, parsed, summary: summarizeDtmRecords(parsed.records) });
  }
  const negativeOriginals = new Set(parsedFiles.flatMap(({ parsed }) => parsed.records)
    .filter((row) => row.providerType === 1 && (row.settlementAmountCents ?? 0) < 0)
    .map((row) => `${row.actorId}\u001f${row.originalTransactionId}`));
  const staged = new Set(stagedMachineNames);
  const inactiveHistorical = new Set(inactiveHistoricalMachineNames);
  const heldRefunds = new Set(heldRefundIdentityHashes);
  return parsedFiles.map(({ filename, bytes, parsed, summary }) => {
    const period = periodFromFilename(path.basename(filename));
    return {
      receipt: {
        fileDigest: parsed.fileDigest,
        byteCount: bytes.length,
        rowCount: summary.rowCount,
        authorizationCents: summary.authorizationCents,
        settlementCents: summary.settlementCents,
        refundAnnotationCents: summary.refundCents,
        currencyCode: 'USD',
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        partial: period.partial,
        origin: 'manual_dtm_export',
      },
      rows: parsed.records.map((row) => toImportRow(
        row,
        negativeOriginals,
        staged,
        inactiveHistorical,
        heldRefunds,
      )),
    };
  });
}

const args = process.argv.slice(2);
if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) {
  const outputIndex = args.indexOf('--output');
  const stageIndex = args.indexOf('--stage-machine-names');
  const heldRefundsIndex = args.indexOf('--hold-refund-identities');
  const inactiveIndex = args.indexOf('--include-inactive-machine-names');
  const fileIndexes = args.flatMap((value, index) => value === '--file' ? [index + 1] : []);
  if (outputIndex < 0 || fileIndexes.length === 0) {
    console.error('Usage: node scripts/nayax/dtm-history-import.mjs --file <private.xlsx> [--file ...] --output <private.json> [--stage-machine-names <private.json>] [--include-inactive-machine-names <private.json>] [--hold-refund-identities <private.json>]');
    process.exit(1);
  }
  const output = path.resolve(args[outputIndex + 1]);
  const stagedMachineNames = stageIndex < 0
    ? []
    : JSON.parse(await readFile(path.resolve(args[stageIndex + 1]), 'utf8'));
  const heldRefundIdentityHashes = heldRefundsIndex < 0
    ? []
    : JSON.parse(await readFile(path.resolve(args[heldRefundsIndex + 1]), 'utf8'));
  const inactiveHistoricalMachineNames = inactiveIndex < 0
    ? []
    : JSON.parse(await readFile(path.resolve(args[inactiveIndex + 1]), 'utf8'));
  const bundle = await buildDtmHistoryImport(fileIndexes.map((index) => path.resolve(args[index])), {
    stagedMachineNames,
    inactiveHistoricalMachineNames,
    heldRefundIdentityHashes,
  });
  await writeFile(output, JSON.stringify(bundle), { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify({ files: bundle.length, rows: bundle.reduce((sum, file) => sum + file.rows.length, 0) }));
}
