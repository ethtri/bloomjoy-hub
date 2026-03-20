#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { isCanonicalTrainingVideoId } from '../src/data/trainingCatalogManifest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    envFiles: argv.includes('--env-file')
      ? [argv[argv.indexOf('--env-file') + 1]].filter(Boolean)
      : ['.env', '.env.local'],
  };
}

function parseEnvFile(contents) {
  const result = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function loadEnv(envFiles) {
  const merged = {};

  for (const envFile of envFiles) {
    const absolute = path.resolve(repoRoot, envFile);
    if (!fs.existsSync(absolute)) {
      continue;
    }

    Object.assign(merged, parseEnvFile(fs.readFileSync(absolute, 'utf8')));
  }

  return merged;
}

function requireEnv(value, key) {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable ${key}.`);
  }

  return value.trim();
}

function normalizeTitle(title) {
  return String(title ?? '')
    .trim()
    .toLowerCase();
}

function compareDuplicateCandidates(left, right) {
  const leftCanonicalRank = isCanonicalTrainingVideoId(left.providerVideoId) ? 0 : 1;
  const rightCanonicalRank = isCanonicalTrainingVideoId(right.providerVideoId) ? 0 : 1;
  if (leftCanonicalRank !== rightCanonicalRank) {
    return leftCanonicalRank - rightCanonicalRank;
  }

  const leftVisibilityRank = left.visibility === 'draft' ? 1 : 0;
  const rightVisibilityRank = right.visibility === 'draft' ? 1 : 0;
  if (leftVisibilityRank !== rightVisibilityRank) {
    return leftVisibilityRank - rightVisibilityRank;
  }

  return left.id.localeCompare(right.id);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...loadEnv(args.envFiles), ...process.env };
  const supabaseUrl = requireEnv(env.SUPABASE_URL || env.VITE_SUPABASE_URL, 'SUPABASE_URL');
  const serviceRoleKey = requireEnv(env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from('trainings')
    .select(
      `
        id,
        title,
        visibility,
        training_assets (
          asset_type,
          provider,
          provider_video_id
        )
      `
    );

  if (error) {
    throw new Error(`Unable to query training catalog: ${error.message}`);
  }

  const videoRows = (data ?? [])
    .map((row) => {
      const videoAsset = (row.training_assets ?? []).find(
        (asset) =>
          asset.asset_type === 'video' &&
          asset.provider === 'vimeo' &&
          asset.provider_video_id &&
          asset.provider_video_id.trim().length > 0
      );

      if (!videoAsset) {
        return null;
      }

      return {
        id: row.id,
        title: row.title,
        visibility: row.visibility,
        providerVideoId: videoAsset.provider_video_id,
      };
    })
    .filter(Boolean);

  const byTitle = new Map();
  for (const row of videoRows) {
    const key = normalizeTitle(row.title);
    const bucket = byTitle.get(key) ?? [];
    bucket.push(row);
    byTitle.set(key, bucket);
  }

  const duplicateGroups = [...byTitle.values()].filter((rows) => rows.length > 1);
  const keepRows = [];
  const rowsToDraft = [];

  for (const group of duplicateGroups) {
    const canonicalRows = group.filter((row) => isCanonicalTrainingVideoId(row.providerVideoId));

    const rowsToKeep =
      canonicalRows.length > 0 ? canonicalRows : [[...group].sort(compareDuplicateCandidates)[0]].filter(Boolean);

    const keepIds = new Set(rowsToKeep.map((row) => row.id));
    keepRows.push(...rowsToKeep);

    for (const row of group) {
      if (!keepIds.has(row.id) && row.visibility !== 'draft') {
        rowsToDraft.push(row);
      }
    }
  }

  console.log(`Duplicate title groups: ${duplicateGroups.length}`);
  console.log(`Canonical/kept rows in duplicate groups: ${keepRows.length}`);
  console.log(`Rows to mark draft: ${rowsToDraft.length}`);
  console.log(args.dryRun ? 'Dry run only; no Supabase changes written.' : 'Applying draft updates.');

  if (rowsToDraft.length > 0) {
    console.log('\nRows to mark draft');
    rowsToDraft.forEach((row) =>
      console.log(`- ${row.id} :: ${row.providerVideoId} :: ${row.title}`)
    );
  }

  if (args.dryRun || rowsToDraft.length === 0) {
    return;
  }

  const rowIds = rowsToDraft.map((row) => row.id);
  const { error: updateError } = await supabase
    .from('trainings')
    .update({ visibility: 'draft' })
    .in('id', rowIds);

  if (updateError) {
    throw new Error(`Unable to mark duplicate training rows as draft: ${updateError.message}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
