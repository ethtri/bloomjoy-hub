#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  getTrainingTrackDefinition,
  resolveTrainingCatalogMetadata,
  stripInternalTrainingTags,
} from '../src/data/trainingCatalogManifest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const VIMEO_API_BASE = 'https://api.vimeo.com';

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

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractVideoId(uri) {
  const match = String(uri || '').match(/\/videos\/(\d+)/);
  return match ? match[1] : null;
}

function buildEmbedParts(embedUrl) {
  const parsed = new URL(embedUrl);
  return {
    embedUrl: parsed.searchParams.get('dnt') ? embedUrl : `${embedUrl}&dnt=1`,
    hash: parsed.searchParams.get('h') ?? null,
  };
}

function pickThumbnailUrl(video) {
  const sizes = Array.isArray(video?.pictures?.sizes) ? video.pictures.sizes : [];
  const preferred = sizes.find((size) => size.width >= 640) ?? sizes[sizes.length - 1];
  return preferred?.link ?? null;
}

async function requestVimeo(pathname, token) {
  const response = await fetch(`${VIMEO_API_BASE}${pathname}`, {
    headers: {
      Accept: 'application/vnd.vimeo.*+json;version=3.4',
      Authorization: `bearer ${token}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
  }

  return response.json();
}

async function fetchAllVimeoVideos(token) {
  const results = [];
  let page = 1;

  while (true) {
    const payload = await requestVimeo(`/me/videos?per_page=100&page=${page}`, token);
    const pageItems = Array.isArray(payload?.data) ? payload.data : [];
    results.push(...pageItems);

    if (!payload?.paging?.next || pageItems.length === 0) {
      break;
    }

    page += 1;
  }

  return results;
}

function buildTrainingTags({ existingTags, vimeoTags, catalogMetadata }) {
  const internalTags = [
    catalogMetadata.moduleLabel,
    'Audience: Operator',
    'Format: Video',
    `Task: ${catalogMetadata.trackLabel}`,
  ];

  const topicTags = uniqueValues([
    ...stripInternalTrainingTags(existingTags ?? []),
    ...stripInternalTrainingTags(vimeoTags ?? []),
  ]).sort((left, right) => left.localeCompare(right));

  return uniqueValues([...internalTags, ...topicTags]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...loadEnv(args.envFiles), ...process.env };
  const supabaseUrl = requireEnv(env.SUPABASE_URL || env.VITE_SUPABASE_URL, 'SUPABASE_URL');
  const serviceRoleKey = requireEnv(env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY');
  const vimeoToken = requireEnv(env.VIMEO_ACCESS_TOKEN, 'VIMEO_ACCESS_TOKEN');
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const videos = await fetchAllVimeoVideos(vimeoToken);
  const { data, error } = await supabase
    .from('trainings')
    .select(
      `
        id,
        title,
        description,
        tags,
        duration_seconds,
        sort_order,
        training_assets (
          id,
          asset_type,
          provider,
          provider_video_id,
          provider_hash,
          embed_url,
          meta
        )
      `
    );

  if (error) {
    throw new Error(`Unable to query Supabase training catalog: ${error.message}`);
  }

  const catalogRows = data ?? [];
  const existingVideoRows = catalogRows.flatMap((row) =>
    (row.training_assets ?? [])
      .filter((asset) => asset.asset_type === 'video' && asset.provider === 'vimeo' && asset.provider_video_id)
      .map((asset) => ({ row, asset }))
  );
  const existingByVideoId = new Map();
  for (const entry of existingVideoRows) {
    const bucket = existingByVideoId.get(entry.asset.provider_video_id) ?? [];
    bucket.push(entry);
    existingByVideoId.set(entry.asset.provider_video_id, bucket);
  }

  const duplicateCatalogRows = [...existingByVideoId.entries()].filter(([, entries]) => entries.length > 1);
  const maxSortOrder = Math.max(0, ...catalogRows.map((row) => row.sort_order ?? 0));
  let nextSortOrder = maxSortOrder + 1;
  let inserted = 0;
  let updated = 0;
  const unmappedUploads = [];
  const derivedMappings = [];
  const modulelessUploads = [];

  for (const video of videos) {
    const videoId = extractVideoId(video.uri);
    if (!videoId || !video.player_embed_url) {
      continue;
    }

    const existingEntries = existingByVideoId.get(videoId) ?? [];
    if (existingEntries.length > 1) {
      continue;
    }

    const vimeoTags = Array.isArray(video.tags) ? video.tags.map((tag) => tag?.tag).filter(Boolean) : [];
    const catalogMetadata = resolveTrainingCatalogMetadata({
      title: video.name,
      tags: vimeoTags,
      format: 'video',
      providerVideoId: videoId,
    });
    const trackDefinition = getTrainingTrackDefinition(catalogMetadata.trackId);
    const nextTags = buildTrainingTags({
      existingTags: existingEntries[0]?.row.tags,
      vimeoTags,
      catalogMetadata,
    });
    const { embedUrl, hash } = buildEmbedParts(video.player_embed_url);
    const thumbnailUrl = pickThumbnailUrl(video);

    if (catalogMetadata.source === 'derived') {
      derivedMappings.push(`${videoId} :: ${video.name}`);
    }
    if (!catalogMetadata.moduleLabel) {
      modulelessUploads.push(`${videoId} :: ${video.name}`);
    }
    if (existingEntries.length === 0) {
      unmappedUploads.push(`${videoId} :: ${video.name}`);
    }

    if (args.dryRun) {
      continue;
    }

    let trainingId = existingEntries[0]?.row.id;
    if (!trainingId) {
      const { data: insertedRow, error: insertError } = await supabase
        .from('trainings')
        .insert({
          title: video.name,
          description: (video.description || `${trackDefinition?.label ?? 'Training'} video for Bloomjoy operators.`).trim(),
          tags: nextTags,
          duration_seconds: video.duration ?? null,
          visibility: 'members_only',
          sort_order: nextSortOrder++,
        })
        .select('id')
        .single();

      if (insertError) {
        throw new Error(`Unable to insert training row for ${video.name}: ${insertError.message}`);
      }

      trainingId = insertedRow.id;
      inserted += 1;
    } else {
      const { error: updateError } = await supabase
        .from('trainings')
        .update({
          title: video.name,
          description: (video.description || existingEntries[0].row.description || '').trim(),
          tags: nextTags,
          duration_seconds: video.duration ?? null,
        })
        .eq('id', trainingId);

      if (updateError) {
        throw new Error(`Unable to update training row for ${video.name}: ${updateError.message}`);
      }

      updated += 1;
    }

    const existingAsset = existingEntries[0]?.asset;
    const assetPayload = {
      training_id: trainingId,
      asset_type: 'video',
      provider: 'vimeo',
      provider_video_id: videoId,
      provider_hash: hash,
      embed_url: embedUrl,
      meta: {
        ...(existingAsset?.meta ?? {}),
        title: video.name,
        thumbnail_url: thumbnailUrl ?? existingAsset?.meta?.thumbnail_url ?? null,
        vimeo_thumbnail_url: thumbnailUrl ?? existingAsset?.meta?.vimeo_thumbnail_url ?? null,
        catalog_track_id: catalogMetadata.trackId,
        module_label: catalogMetadata.moduleLabel ?? null,
        vimeo_tags: vimeoTags,
      },
    };

    if (!existingAsset) {
      const { error: assetInsertError } = await supabase.from('training_assets').insert(assetPayload);
      if (assetInsertError) {
        throw new Error(`Unable to insert training asset for ${video.name}: ${assetInsertError.message}`);
      }
    } else {
      const { error: assetUpdateError } = await supabase
        .from('training_assets')
        .update(assetPayload)
        .eq('id', existingAsset.id);
      if (assetUpdateError) {
        throw new Error(`Unable to update training asset for ${video.name}: ${assetUpdateError.message}`);
      }
    }
  }

  const vimeoVideoIds = new Set(videos.map((video) => extractVideoId(video.uri)).filter(Boolean));
  const staleCatalogRows = existingVideoRows
    .filter((entry) => !vimeoVideoIds.has(entry.asset.provider_video_id))
    .map((entry) => `${entry.asset.provider_video_id} :: ${entry.row.title}`);

  console.log(`Vimeo uploads: ${videos.length}`);
  console.log(`Catalog rows checked: ${catalogRows.length}`);
  console.log(`Duplicate catalog rows: ${duplicateCatalogRows.length}`);
  console.log(`Stale catalog rows: ${staleCatalogRows.length}`);
  console.log(`Unmapped uploads: ${unmappedUploads.length}`);
  console.log(`Derived mappings: ${derivedMappings.length}`);
  console.log(`Uploads missing module labels: ${modulelessUploads.length}`);
  console.log(args.dryRun ? 'Dry run only; no Supabase changes written.' : `Inserted: ${inserted}, updated: ${updated}`);

  if (duplicateCatalogRows.length > 0) {
    console.log('\nDuplicate catalog rows');
    duplicateCatalogRows.forEach(([videoId, entries]) =>
      console.log(`- ${videoId}: ${entries.map((entry) => entry.row.title).join(' | ')}`)
    );
  }

  if (staleCatalogRows.length > 0) {
    console.log('\nStale catalog rows');
    staleCatalogRows.forEach((row) => console.log(`- ${row}`));
  }

  if (unmappedUploads.length > 0) {
    console.log('\nUnmapped uploads');
    unmappedUploads.forEach((row) => console.log(`- ${row}`));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
