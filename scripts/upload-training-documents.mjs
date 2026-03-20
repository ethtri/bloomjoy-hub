#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const DEFAULT_SOURCE_ROOT = 'I:/Shared drives/Bloomjoy Training/CottonCandy';
const DEFAULT_BUCKET = 'training-documents';

function parseArgs(argv) {
  const parsed = {
    bucket: DEFAULT_BUCKET,
    sourceRoot: DEFAULT_SOURCE_ROOT,
    envFiles: ['.env', '.env.local'],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--bucket' && next) {
      parsed.bucket = next;
      index += 1;
      continue;
    }

    if (arg === '--source-root' && next) {
      parsed.sourceRoot = next;
      index += 1;
      continue;
    }

    if (arg === '--env-file' && next) {
      parsed.envFiles = [next];
      index += 1;
    }
  }

  return parsed;
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

  const uploads = [
    {
      localPath: path.resolve(args.sourceRoot, 'Software setup.pdf'),
      storagePath: 'manuals/software-setup.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.resolve(args.sourceRoot, 'Cotton Candy Maintenance Guide.pdf'),
      storagePath: 'manuals/cotton-candy-maintenance-guide.pdf',
      contentType: 'application/pdf',
    },
  ];

  for (const upload of uploads) {
    if (!fs.existsSync(upload.localPath)) {
      throw new Error(`Training document not found: ${upload.localPath}`);
    }

    const fileBuffer = fs.readFileSync(upload.localPath);
    const { error } = await supabase.storage
      .from(args.bucket)
      .upload(upload.storagePath, fileBuffer, {
        upsert: true,
        contentType: upload.contentType,
      });

    if (error) {
      throw new Error(`Upload failed for ${upload.storagePath}: ${error.message}`);
    }

    console.log(`Uploaded ${upload.localPath} -> ${args.bucket}/${upload.storagePath}`);
  }

  console.log('Training document upload complete.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
