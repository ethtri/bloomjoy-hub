#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const guideCatalogRows = [
  {
    id: 'e1f10000-7c1b-49f7-a1aa-100000000001',
    title: 'Software Setup Quickstart',
    description:
      'Use this guide when you need fast admin access, Wi-Fi, time zone, and first-login setup.',
    durationSeconds: 9 * 60,
    tags: [
      'Module 1',
      'Audience: Operator',
      'Task: Start Here',
      'Task: Software & Payments',
      'Format: Guide',
      'Admin',
      'Wi-Fi',
      'Time zone',
    ],
    sourceLabel: 'Software setup manual',
    readMinutes: 9,
    storagePath: 'manuals/software-setup.pdf',
    pdfTitle: 'Software setup PDF',
  },
  {
    id: 'e1f10000-7c1b-49f7-a1aa-100000000002',
    title: 'Pricing, Passwords, and Payment Settings',
    description:
      'Configure prices, guest and staff passwords, payment mode, and operator-facing contact details.',
    durationSeconds: 8 * 60,
    tags: [
      'Module 1',
      'Audience: Operator',
      'Task: Software & Payments',
      'Format: Guide',
      'Pricing',
      'Passwords',
      'Payments',
      'Nayax',
    ],
    sourceLabel: 'Software setup manual',
    readMinutes: 8,
    storagePath: 'manuals/software-setup.pdf',
    pdfTitle: 'Software setup PDF',
  },
  {
    id: 'e1f10000-7c1b-49f7-a1aa-100000000003',
    title: 'Alarm and Power Timer Setup',
    description:
      'Set the machine clock, burner auto-start alarm, and approved daily power schedule before service begins.',
    durationSeconds: 6 * 60,
    tags: [
      'Module 1',
      'Audience: Operator',
      'Task: Daily Operation',
      'Task: Software & Payments',
      'Format: Checklist',
      'Alarm',
      'Timer',
      'Scheduling',
    ],
    sourceLabel: 'Software setup manual',
    readMinutes: 7,
    storagePath: 'manuals/software-setup.pdf',
    pdfTitle: 'Software setup PDF',
  },
  {
    id: 'e1f10000-7c1b-49f7-a1aa-100000000004',
    title: 'Maintenance Guide Reference Manual',
    description:
      'Use the maintenance reference to find safe shutdown, daily cleaning hotspots, debug-page checks, and consumable-loading rules.',
    durationSeconds: 14 * 60,
    tags: [
      'Module 1',
      'Audience: Operator',
      'Task: Start Here',
      'Task: Cleaning & Maintenance',
      'Format: Reference',
      'Maintenance',
      'Module map',
    ],
    sourceLabel: 'Cotton Candy Maintenance Guide',
    readMinutes: 14,
    storagePath: 'manuals/cotton-candy-maintenance-guide.pdf',
    pdfTitle: 'Cotton Candy Maintenance Guide PDF',
  },
  {
    id: 'e1f10000-7c1b-49f7-a1aa-100000000005',
    title: 'Cleaning and Hygiene Checklist',
    description:
      'Follow the daily cleaning points for the burner, filter, stick path, and sensor areas that prevent avoidable downtime.',
    durationSeconds: 7 * 60,
    tags: [
      'Module 1',
      'Audience: Operator',
      'Task: Cleaning & Maintenance',
      'Format: Checklist',
      'Maintenance',
      'Daily',
      'Cleaning',
    ],
    sourceLabel: 'Cotton Candy Maintenance Guide',
    readMinutes: 7,
    storagePath: 'manuals/cotton-candy-maintenance-guide.pdf',
    pdfTitle: 'Cotton Candy Maintenance Guide PDF',
  },
  {
    id: 'e1f10000-7c1b-49f7-a1aa-100000000006',
    title: 'Module Function Check Guide',
    description:
      'Run the debug-page inspection steps when the burner, humidification, door, air, cooling, or output modules need verification.',
    durationSeconds: 10 * 60,
    tags: [
      'Module 2',
      'Audience: Operator',
      'Task: Troubleshooting',
      'Task: Cleaning & Maintenance',
      'Format: Guide',
      'Diagnostics',
      'Function check',
    ],
    sourceLabel: 'Cotton Candy Maintenance Guide',
    readMinutes: 10,
    storagePath: 'manuals/cotton-candy-maintenance-guide.pdf',
    pdfTitle: 'Cotton Candy Maintenance Guide PDF',
  },
  {
    id: 'e1f10000-7c1b-49f7-a1aa-100000000007',
    title: 'Consumables Loading and Stick Handling',
    description:
      'Use the manual checks for sugar fill level, cap seal, pipe routing, check-valve direction, and paper-stick handling when output quality drops.',
    durationSeconds: 6 * 60,
    tags: [
      'Module 1',
      'Audience: Operator',
      'Task: Daily Operation',
      'Task: Troubleshooting',
      'Format: Guide',
      'Sugar',
      'Sticks',
      'Consumables',
    ],
    sourceLabel: 'Cotton Candy Maintenance Guide',
    readMinutes: 6,
    storagePath: 'manuals/cotton-candy-maintenance-guide.pdf',
    pdfTitle: 'Cotton Candy Maintenance Guide PDF',
  },
  {
    id: 'e1f10000-7c1b-49f7-a1aa-100000000008',
    title: 'Timer Control Reference',
    description:
      'Use the controller button legend and approved programming order while setting local time and daily schedules.',
    durationSeconds: 3 * 60,
    tags: [
      'Module 1',
      'Audience: Operator',
      'Task: Daily Operation',
      'Task: Software & Payments',
      'Format: Guide',
      'Timer',
      'Controls',
      'Scheduling',
    ],
    sourceLabel: 'Software setup manual',
    readMinutes: 3,
    storagePath: 'manuals/software-setup.pdf',
    pdfTitle: 'Software setup PDF',
  },
  {
    id: 'e1f10000-7c1b-49f7-a1aa-100000000009',
    title: 'Safe Power Off and Cooldown',
    description:
      'Use this shutdown checklist to protect the burner before unplugging or opening the machine.',
    durationSeconds: 4 * 60,
    tags: [
      'Module 1',
      'Audience: Operator',
      'Task: Daily Operation',
      'Task: Cleaning & Maintenance',
      'Format: Checklist',
      'Safety',
      'Shutdown',
      'Cooldown',
    ],
    sourceLabel: 'Cotton Candy Maintenance Guide',
    readMinutes: 4,
    storagePath: 'manuals/cotton-candy-maintenance-guide.pdf',
    pdfTitle: 'Cotton Candy Maintenance Guide PDF',
  },
  {
    id: 'e1f10000-7c1b-49f7-a1aa-100000000010',
    title: 'Daily Cleaning Hotspots',
    description:
      'Use this quick hotspot guide to target the highest-risk residue, debris, and sensor areas during daily cleanup.',
    durationSeconds: 5 * 60,
    tags: [
      'Module 1',
      'Audience: Operator',
      'Task: Cleaning & Maintenance',
      'Format: Checklist',
      'Cleaning',
      'Hotspots',
      'Sensors',
    ],
    sourceLabel: 'Cotton Candy Maintenance Guide',
    readMinutes: 5,
    storagePath: 'manuals/cotton-candy-maintenance-guide.pdf',
    pdfTitle: 'Cotton Candy Maintenance Guide PDF',
  },
  {
    id: 'e1f10000-7c1b-49f7-a1aa-100000000011',
    title: 'Consumables Loading Reference',
    description:
      'Use this quick reference for sugar fill level, cap seal, pipe routing, check-valve direction, and stick loading.',
    durationSeconds: 4 * 60,
    tags: [
      'Module 1',
      'Audience: Operator',
      'Task: Daily Operation',
      'Format: Guide',
      'Consumables',
      'Sugar',
      'Sticks',
    ],
    sourceLabel: 'Cotton Candy Maintenance Guide',
    readMinutes: 4,
    storagePath: 'manuals/cotton-candy-maintenance-guide.pdf',
    pdfTitle: 'Cotton Candy Maintenance Guide PDF',
  },
];

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...loadEnv(args.envFiles), ...process.env };
  const supabaseUrl = requireEnv(env.SUPABASE_URL || env.VITE_SUPABASE_URL, 'SUPABASE_URL');
  const serviceRoleKey = requireEnv(env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ids = guideCatalogRows.map((row) => row.id);
  const titles = guideCatalogRows.map((row) => row.title);
  const [{ data: existingByIdRows, error: existingByIdError }, { data: existingByTitleRows, error: existingByTitleError }] =
    await Promise.all([
      supabase.from('trainings').select('id,title').in('id', ids),
      supabase.from('trainings').select('id,title').in('title', titles),
    ]);

  if (existingByIdError) {
    throw new Error(`Unable to query guide rows by id: ${existingByIdError.message}`);
  }

  if (existingByTitleError) {
    throw new Error(`Unable to query guide rows by title: ${existingByTitleError.message}`);
  }

  const mergedExistingRows = [...(existingByIdRows ?? []), ...(existingByTitleRows ?? [])];
  const existingById = new Map(mergedExistingRows.map((row) => [row.id, row]));
  const existingByTitle = new Map(mergedExistingRows.map((row) => [row.title, row]));
  let inserted = 0;
  let updated = 0;

  for (const row of guideCatalogRows) {
    const existingRow = existingById.get(row.id) ?? existingByTitle.get(row.title);
    const trainingId = existingRow?.id ?? row.id;
    const trainingPayload = {
      id: trainingId,
      title: row.title,
      description: row.description,
      tags: row.tags,
      duration_seconds: row.durationSeconds,
      visibility: 'members_only',
    };

    if (args.dryRun) {
      if (existingRow) {
        updated += 1;
      } else {
        inserted += 1;
      }
      continue;
    }

    const { error: trainingError } = await supabase.from('trainings').upsert(trainingPayload);
    if (trainingError) {
      throw new Error(`Unable to upsert training row for ${row.title}: ${trainingError.message}`);
    }

    if (existingRow) {
      updated += 1;
    } else {
      inserted += 1;
    }

    const { data: existingAssets, error: assetLookupError } = await supabase
      .from('training_assets')
      .select('id,meta')
      .eq('training_id', trainingId)
      .eq('asset_type', 'pdf')
      .limit(1);

    if (assetLookupError) {
      throw new Error(`Unable to query training asset for ${row.title}: ${assetLookupError.message}`);
    }

    const existingAsset = existingAssets?.[0];
    const assetPayload = {
      training_id: trainingId,
      asset_type: 'pdf',
      provider: null,
      provider_video_id: null,
      provider_hash: null,
      embed_url: null,
      download_url: null,
      meta: {
        ...(existingAsset?.meta ?? {}),
        title: row.pdfTitle,
        description: 'Download the original PDF for screenshots and full operating context.',
        action_label: 'Download PDF',
        format_badge: 'PDF',
        read_minutes: row.readMinutes,
        storage_path: row.storagePath,
        source_document_title: row.sourceLabel,
      },
    };

    if (existingAsset) {
      const { error: assetUpdateError } = await supabase
        .from('training_assets')
        .update(assetPayload)
        .eq('id', existingAsset.id);

      if (assetUpdateError) {
        throw new Error(
          `Unable to update PDF asset for ${row.title}: ${assetUpdateError.message}`
        );
      }
    } else {
      const { error: assetInsertError } = await supabase
        .from('training_assets')
        .insert(assetPayload);

      if (assetInsertError) {
        throw new Error(
          `Unable to insert PDF asset for ${row.title}: ${assetInsertError.message}`
        );
      }
    }
  }

  console.log(`Guide rows checked: ${guideCatalogRows.length}`);
  console.log(args.dryRun ? 'Dry run only; no Supabase changes written.' : `Inserted: ${inserted}, updated: ${updated}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
