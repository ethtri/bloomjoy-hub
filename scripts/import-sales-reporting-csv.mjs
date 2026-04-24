#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
};

const hasFlag = (name) => args.includes(name);

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(value);
      if (row.some((cell) => cell.trim() !== '')) {
        rows.push(row);
      }
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  row.push(value);
  if (row.some((cell) => cell.trim() !== '')) {
    rows.push(row);
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() ?? '']))
  );
};

const normalizePaymentMethod = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized.includes('cash')) return 'cash';
  if (normalized.includes('credit') || normalized.includes('card') || normalized.includes('nayax')) {
    return 'credit';
  }
  if (normalized) return 'other';
  return 'unknown';
};

const parseCents = (row, centsKey, usdKey) => {
  const cents = Number(row[centsKey]);
  if (Number.isFinite(cents) && cents >= 0) {
    return Math.round(cents);
  }

  const usd = Number(String(row[usdKey] ?? '').replace(/[$,]/g, ''));
  if (Number.isFinite(usd) && usd >= 0) {
    return Math.round(usd * 100);
  }

  return 0;
};

const makeHash = (source, row) =>
  createHash('sha256').update(`${source}:${JSON.stringify(row)}`).digest('hex');

const filePath = getArg('--file');
const dryRun = hasFlag('--dry-run');
const source = getArg('--source', 'manual_csv');
const sourceReference = getArg('--source-reference', filePath ?? 'local-sales-csv');
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!filePath) {
  console.error('Usage: npm run reporting:import-sales -- --file <sales.csv> [--dry-run]');
  process.exit(1);
}

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

if (!['manual_csv', 'sunze_browser', 'sample_seed'].includes(source)) {
  console.error(`Invalid source: ${source}`);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const rows = parseCsv(await readFile(filePath, 'utf8'));
let imported = 0;
let skipped = 0;
let runId = null;

if (!dryRun) {
  const { data, error } = await supabase
    .from('sales_import_runs')
    .insert({
      source,
      status: 'running',
      source_reference: sourceReference,
      rows_seen: rows.length,
      meta: { importer: 'scripts/import-sales-reporting-csv.mjs' },
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Unable to create import run.');
  }

  runId = data.id;
}

try {
  for (const row of rows) {
    const saleDate = row.sale_date || row.date || row.SaleDate;
    const machineId = row.machine_id || row.reporting_machine_id;
    const sunzeMachineId = row.sunze_machine_id || row.sunze_id || row.machine_external_id;

    if (!saleDate || (!machineId && !sunzeMachineId)) {
      skipped += 1;
      continue;
    }

    let query = supabase.from('reporting_machines').select('id,location_id').limit(1);
    query = machineId ? query.eq('id', machineId) : query.eq('sunze_machine_id', sunzeMachineId);

    const { data: machines, error: machineError } = await query;
    const machine = machines?.[0];

    if (machineError || !machine) {
      skipped += 1;
      continue;
    }

    const fact = {
      reporting_machine_id: machine.id,
      reporting_location_id: machine.location_id,
      sale_date: saleDate,
      payment_method: normalizePaymentMethod(row.payment_method || row.payment || row.tender),
      net_sales_cents: parseCents(row, 'net_sales_cents', 'net_sales_usd'),
      transaction_count: Math.max(0, Math.round(Number(row.transaction_count || row.transactions || 0))),
      source,
      source_row_hash: makeHash(source, row),
      import_run_id: runId,
      raw_payload: row,
    };

    if (!dryRun) {
      const { error: upsertError } = await supabase
        .from('machine_sales_facts')
        .upsert(fact, { onConflict: 'source,source_row_hash' });

      if (upsertError) {
        throw new Error(upsertError.message);
      }
    }

    imported += 1;
  }

  if (!dryRun && runId) {
    await supabase
      .from('sales_import_runs')
      .update({
        status: 'completed',
        rows_imported: imported,
        rows_skipped: skipped,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId);
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        source,
        rowsSeen: rows.length,
        rowsImported: imported,
        rowsSkipped: skipped,
        importRunId: runId,
      },
      null,
      2
    )
  );
} catch (error) {
  if (!dryRun && runId) {
    await supabase
      .from('sales_import_runs')
      .update({
        status: 'failed',
        rows_imported: imported,
        rows_skipped: skipped,
        error_message: error instanceof Error ? error.message : String(error),
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId);
  }

  throw error;
}
