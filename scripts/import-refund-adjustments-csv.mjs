#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import {
  buildMachineProfiles,
  extractRefundInput,
  makeSourceRowHash,
  matchRefundToMachine,
  parseCsv,
} from './refunds/refund-adjustment-utils.mjs';

const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
};

const hasFlag = (name) => args.includes(name);

const filePath = getArg('--file');
const dryRun = hasFlag('--dry-run');
const sourceReference = String(
  getArg('--source-reference', filePath ?? 'refund-source-export')
).trim();
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!filePath) {
  console.error('Usage: npm run reporting:import-refunds -- --file <refunds.csv> [--dry-run]');
  process.exit(1);
}

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const requireNoError = (result, message) => {
  if (result.error) {
    throw new Error(`${message}: ${result.error.message}`);
  }
  return result.data;
};

const loadMachineProfiles = async () => {
  const machines = requireNoError(
    await supabase
      .from('reporting_machines')
      .select('id, location_id, machine_label, sunze_machine_id, reporting_locations(name)')
      .eq('status', 'active'),
    'Unable to load reporting machines'
  );
  const aliases = requireNoError(
    await supabase
      .from('reporting_machine_aliases')
      .select('reporting_machine_id, alias')
      .eq('status', 'active'),
    'Unable to load refund matching aliases; apply the refund review migration first'
  );

  return buildMachineProfiles({ machines: machines ?? [], aliases: aliases ?? [] });
};

const loadExistingAdjustmentHashes = async () => {
  const rows = requireNoError(
    await supabase.from('sales_adjustment_facts').select('source_row_hash').eq('source', 'google_sheets'),
    'Unable to load existing refund adjustment hashes'
  );
  return new Set((rows ?? []).map((row) => row.source_row_hash).filter(Boolean));
};

const createImportRun = async (rowsSeen) => {
  if (dryRun) return null;

  const data = requireNoError(
    await supabase
      .from('sales_import_runs')
      .insert({
        source: 'google_sheets_refunds',
        status: 'running',
        source_reference: sourceReference,
        rows_seen: rowsSeen,
        meta: {
          importer: 'scripts/import-refund-adjustments-csv.mjs',
          mode: 'reviewed_refund_adjustment_import',
        },
      })
      .select('id')
      .single(),
    'Unable to create import run'
  );

  return data.id;
};

const updateImportRun = async (runId, payload) => {
  if (dryRun || !runId) return;
  const { error } = await supabase.from('sales_import_runs').update(payload).eq('id', runId);
  if (error) {
    console.error(`Unable to update import run: ${error.message}`);
  }
};

const stageReviewRow = async (payload) => {
  if (dryRun) return { id: null };

  const data = requireNoError(
    await supabase
      .from('refund_adjustment_review_rows')
      .upsert(payload, { onConflict: 'source,source_reference,source_row_reference' })
      .select('id')
      .single(),
    'Unable to stage refund review row'
  );

  return data;
};

const applyAdjustment = async ({
  input,
  sourceRowHash,
  runId,
  reviewRowId,
  matchedMachine,
  matchConfidence,
  row,
}) => {
  if (dryRun) return { id: null };

  const data = requireNoError(
    await supabase
      .from('sales_adjustment_facts')
      .upsert(
        {
          reporting_machine_id: matchedMachine.id,
          reporting_location_id: matchedMachine.locationId,
          adjustment_date: input.refundDate,
          adjustment_type: input.adjustmentType,
          amount_cents: input.amountCents,
          complaint_count: input.complaintCount,
          source: 'google_sheets',
          source_reference: sourceReference,
          source_row_reference: input.sourceRowReference,
          source_row_hash: sourceRowHash,
          import_run_id: runId,
          refund_review_row_id: reviewRowId,
          match_status: 'applied',
          match_confidence: matchConfidence,
          notes: input.reason || null,
          raw_payload: row,
        },
        { onConflict: 'source,source_reference,source_row_reference' }
      )
      .select('id')
      .single(),
    'Unable to apply refund adjustment'
  );

  return data;
};

const rows = parseCsv(await readFile(filePath, 'utf8'));
const machineProfiles = await loadMachineProfiles();
const existingHashes = await loadExistingAdjustmentHashes();
const seenHashes = new Set();
const counts = {
  rowsSeen: rows.length,
  rowsStaged: 0,
  rowsApplied: 0,
  rowsReview: 0,
  rowsDuplicate: 0,
  rowsInvalid: 0,
  rowsAmbiguous: 0,
  rowsUnmatched: 0,
};
const runId = await createImportRun(rows.length);

try {
  for (const { row, rowNumber } of rows) {
    const input = extractRefundInput(row, `row-${rowNumber}`);
    const sourceRowHash = makeSourceRowHash(input);
    const duplicate = seenHashes.has(sourceRowHash) || existingHashes.has(sourceRowHash);
    seenHashes.add(sourceRowHash);

    const match = duplicate
      ? {
          matchStatus: 'duplicate',
          matchConfidence: 0,
          matchReason: 'duplicate_source_row_hash',
          candidateMachineIds: [],
          matchedMachine: null,
        }
      : matchRefundToMachine(input, machineProfiles);
    const canApply = match.matchStatus === 'matched' && match.matchedMachine;
    const reviewStatus = canApply ? 'approved' : 'unresolved';
    const staged = await stageReviewRow({
      import_run_id: runId,
      source: 'sheet_export',
      source_reference: sourceReference,
      source_row_reference: input.sourceRowReference,
      source_row_hash: sourceRowHash,
      source_location: input.sourceLocation || null,
      refund_date: input.refundDate || null,
      original_order_date: input.originalOrderDate || null,
      amount_cents: input.amountCents,
      adjustment_type: input.adjustmentType,
      complaint_count: input.complaintCount,
      reason: input.reason || null,
      source_status: input.sourceStatus || null,
      raw_payload: row,
      match_status: canApply ? 'matched' : match.matchStatus,
      match_confidence: match.matchConfidence,
      match_reason: match.matchReason,
      candidate_machine_ids: match.candidateMachineIds,
      matched_machine_id: match.matchedMachine?.id ?? null,
      matched_location_id: match.matchedMachine?.locationId ?? null,
      resolution_status: reviewStatus,
    });
    counts.rowsStaged += 1;

    if (canApply && match.matchedMachine) {
      const adjustment = await applyAdjustment({
        input,
        sourceRowHash,
        runId,
        reviewRowId: staged.id,
        matchedMachine: match.matchedMachine,
        matchConfidence: match.matchConfidence,
        row,
      });
      if (!dryRun && staged.id && adjustment.id) {
        requireNoError(
          await supabase
            .from('refund_adjustment_review_rows')
            .update({
              match_status: 'applied',
              applied_adjustment_id: adjustment.id,
              resolution_status: 'approved',
            })
            .eq('id', staged.id),
          'Unable to mark refund review row applied'
        );
      }
      existingHashes.add(sourceRowHash);
      counts.rowsApplied += 1;
      continue;
    }

    counts.rowsReview += 1;
    if (match.matchStatus === 'duplicate') counts.rowsDuplicate += 1;
    if (match.matchStatus === 'invalid') counts.rowsInvalid += 1;
    if (match.matchStatus === 'ambiguous') counts.rowsAmbiguous += 1;
    if (match.matchStatus === 'unmatched') counts.rowsUnmatched += 1;
  }

  await updateImportRun(runId, {
    status: 'completed',
    rows_imported: counts.rowsApplied,
    rows_skipped: counts.rowsSeen - counts.rowsApplied,
    meta: {
      importer: 'scripts/import-refund-adjustments-csv.mjs',
      mode: 'reviewed_refund_adjustment_import',
      rows_staged: counts.rowsStaged,
      rows_review: counts.rowsReview,
      rows_duplicate: counts.rowsDuplicate,
      rows_invalid: counts.rowsInvalid,
      rows_ambiguous: counts.rowsAmbiguous,
      rows_unmatched: counts.rowsUnmatched,
    },
    completed_at: new Date().toISOString(),
  });

  console.log(
    JSON.stringify(
      {
        dryRun,
        source: 'refund_adjustments',
        ...counts,
        importRunId: runId,
      },
      null,
      2
    )
  );
} catch (error) {
  await updateImportRun(runId, {
    status: 'failed',
    rows_imported: counts.rowsApplied,
    rows_skipped: counts.rowsSeen - counts.rowsApplied,
    error_message: error instanceof Error ? error.message : String(error),
    completed_at: new Date().toISOString(),
  });

  throw error;
}
