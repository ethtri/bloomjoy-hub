#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index < 0 ? null : args[index + 1] ?? null;
};
const bundlePath = valueAfter('--bundle');
const replayCount = args.includes('--replay') ? 2 : 1;
const batchSize = 500;

if (!bundlePath) {
  console.error('Usage: node scripts/nayax/apply-dtm-history-import.mjs --bundle <private.json> [--replay]');
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error('nayax_dtm_service_environment_required');

const bundle = JSON.parse(await readFile(path.resolve(bundlePath), 'utf8'));
if (!Array.isArray(bundle) || bundle.length === 0) throw new Error('nayax_dtm_bundle_invalid');
const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const rpc = async (name, body) => {
  const { data, error } = await client.rpc(name, body);
  if (error) throw new Error(`${name}:${error.code ?? 'unknown'}:${error.message}`);
  return data;
};

const summaries = [];
for (let pass = 1; pass <= replayCount; pass += 1) {
  for (const file of bundle) {
    const begun = await rpc('service_begin_nayax_dtm_history_import', {
      p_receipt: file.receipt,
    });
    let rowsRecorded = 0;
    let factsLinked = 0;
    let adjustmentsLinked = 0;
    if (!begun.completed) {
      for (let offset = 0; offset < file.rows.length; offset += batchSize) {
        const result = await rpc('service_ingest_nayax_dtm_history_rows', {
          p_file_digest: file.receipt.fileDigest,
          p_rows: file.rows.slice(offset, offset + batchSize),
        });
        rowsRecorded += result.rowsRecorded;
        factsLinked += result.factsLinked;
        adjustmentsLinked += result.adjustmentsLinked;
      }
    }
    const finalized = await rpc('service_finalize_nayax_dtm_history_import', {
      p_file_digest: file.receipt.fileDigest,
    });
    summaries.push({
      pass,
      duplicate: begun.duplicate,
      sourceRows: file.receipt.rowCount,
      rowsRecorded: begun.duplicate ? finalized.rowsRecorded : rowsRecorded,
      factsLinked: begun.duplicate ? finalized.factsLinked : factsLinked,
      adjustmentsLinked: begun.duplicate ? finalized.adjustmentsLinked : adjustmentsLinked,
      pendingRows: finalized.pendingRows,
      heldRows: finalized.heldRows,
    });
  }
}

console.log(JSON.stringify({ files: bundle.length, passes: replayCount, summaries }, null, 2));
