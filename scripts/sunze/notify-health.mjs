#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
};

const loadEnvFile = async (filePath) => {
  if (!filePath || !existsSync(filePath)) return;

  const text = await readFile(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

    const [name, ...rest] = trimmed.split('=');
    let value = rest.join('=').trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[name.trim()] ??= value;
  }
};

await loadEnvFile(getArg('--env-file'));
await loadEnvFile(resolve(process.cwd(), '.env.local'));
await loadEnvFile(resolve(process.cwd(), '.env'));

const ingestUrl = process.env.REPORTING_INGEST_URL;
const ingestToken = process.env.REPORTING_INGEST_TOKEN;
const event = getArg('--event', 'freshness_check');
const message = getArg('--message', '');
const staleHours = Number(
  getArg('--stale-hours', process.env.PROVIDER_SYNC_STALE_HOURS ?? process.env.SUNZE_SYNC_STALE_HOURS ?? '30')
);
const githubRunUrl =
  process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

if (!ingestUrl) {
  throw new Error('Missing required environment variable: REPORTING_INGEST_URL');
}

if (!ingestToken) {
  throw new Error('Missing required environment variable: REPORTING_INGEST_TOKEN');
}

const response = await fetch(ingestUrl, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${ingestToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    action: 'sync_health_check',
    event,
    message,
    staleHours: Number.isFinite(staleHours) ? staleHours : 30,
    meta: {
      worker: 'scripts/sunze/notify-health.mjs',
      githubRunId: process.env.GITHUB_RUN_ID ?? null,
      githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      githubWorkflow: process.env.GITHUB_WORKFLOW ?? null,
      githubRunUrl,
    },
  }),
});

const responseBody = await response.json().catch(() => ({}));

if (!response.ok) {
  throw new Error(
    typeof responseBody.error === 'string'
      ? responseBody.error
      : `Sales import health check failed with HTTP ${response.status}`
  );
}

console.log(JSON.stringify(responseBody, null, 2));
