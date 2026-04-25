#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { parseSunzeOrderWorkbook } from './sunze-orders.mjs';

const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
};

const hasFlag = (name) => args.includes(name);

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

const dryRun = hasFlag('--dry-run');
const keepDownload = hasFlag('--keep-download');
const headful = hasFlag('--headful');
const parseFilePath = getArg('--parse-file');
const datePreset = getArg('--date-preset', 'Last 3 Days');
const downloadDirArg = getArg('--download-dir');
const loginUrl = process.env.SUNZE_LOGIN_URL;
const email = process.env.SUNZE_REPORTING_EMAIL;
const password = process.env.SUNZE_REPORTING_PASSWORD;
const ingestUrl = process.env.REPORTING_INGEST_URL;
const ingestToken = process.env.REPORTING_INGEST_TOKEN;

const required = (value, name) => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const jsonLog = (payload) => console.log(JSON.stringify(payload, null, 2));

const assertAllowedSunzeRoute = (page) => {
  const url = new URL(page.url());
  const allowedHashes = ['#/login', '#/home', '#/orderCenter'];
  const isAllowed = allowedHashes.some((hash) => url.hash.startsWith(hash));

  if (!isAllowed) {
    throw new Error(`Unexpected Sunze route during reporting sync: ${url.origin}${url.pathname}${url.hash}`);
  }
};

const openOrdersPage = async (page) => {
  const baseUrl = required(loginUrl, 'SUNZE_LOGIN_URL').split('#')[0];

  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  assertAllowedSunzeRoute(page);
  await page.getByText(/Password/i).first().click().catch(() => {});
  await page
    .getByPlaceholder(/Username|Email/i)
    .fill(required(email, 'SUNZE_REPORTING_EMAIL'))
    .catch(async () => {
      await page.locator('input').nth(0).fill(required(email, 'SUNZE_REPORTING_EMAIL'));
    });
  await page
    .getByPlaceholder(/Password/i)
    .fill(required(password, 'SUNZE_REPORTING_PASSWORD'))
    .catch(async () => {
      await page.locator('input[type="password"]').first().fill(required(password, 'SUNZE_REPORTING_PASSWORD'));
    });
  await page
    .getByRole('button', { name: /login/i })
    .click()
    .catch(async () => {
      await page.locator('button').filter({ hasText: /login/i }).first().click();
    });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);

  await page.goto(`${baseUrl}#/orderCenter`, { waitUntil: 'domcontentloaded' });
  assertAllowedSunzeRoute(page);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);
};

const selectDatePreset = async (page, preset) => {
  await page.getByText('Today').first().click();
  await page.waitForTimeout(500);
  await page.getByText(preset, { exact: true }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
};

const exportOrdersWorkbook = async () => {
  const downloadRoot = downloadDirArg
    ? resolve(downloadDirArg)
    : await mkdtemp(join(tmpdir(), 'bloomjoy-sunze-orders-'));
  await mkdir(downloadRoot, { recursive: true });

  const browser = await chromium.launch({ headless: !headful });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  try {
    await openOrdersPage(page);
    await selectDatePreset(page, datePreset);

    const downloadPromise = page.waitForEvent('download');
    await page.getByText('Export', { exact: true }).click();
    const download = await downloadPromise;
    const filename = basename(await download.suggestedFilename());
    const filePath = join(downloadRoot, filename);
    await download.saveAs(filePath);

    return {
      filePath,
      cleanupPath: downloadDirArg ? filePath : downloadRoot,
      cleanupMode: downloadDirArg ? 'file' : 'directory',
    };
  } finally {
    await browser.close();
  }
};

const postIngestPayload = async (payload) => {
  required(ingestUrl, 'REPORTING_INGEST_URL');
  required(ingestToken, 'REPORTING_INGEST_TOKEN');

  const response = await fetch(ingestUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ingestToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const responseBody = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      typeof responseBody.error === 'string'
        ? responseBody.error
        : `Sunze ingest failed with HTTP ${response.status}`
    );
  }

  return responseBody;
};

let cleanupTarget = null;

try {
  const source = parseFilePath
    ? { filePath: resolve(parseFilePath), cleanupPath: null, cleanupMode: null }
    : await exportOrdersWorkbook();

  cleanupTarget = source.cleanupPath
    ? { path: source.cleanupPath, mode: source.cleanupMode }
    : null;
  const rows = await parseSunzeOrderWorkbook(source.filePath);
  const dates = rows.map((row) => row.saleDate).sort();
  const machineCount = new Set(rows.map((row) => row.machineCode)).size;
  const payload = {
    source: 'sunze_browser',
    sourceReference: `sunze-orders:${datePreset}:${new Date().toISOString()}`,
    datePreset,
    windowStart: dates[0] ?? null,
    windowEnd: dates[dates.length - 1] ?? null,
    generatedAt: new Date().toISOString(),
    rows,
    meta: {
      worker: 'scripts/sunze/sync-orders.mjs',
      githubRunId: process.env.GITHUB_RUN_ID ?? null,
      githubWorkflow: process.env.GITHUB_WORKFLOW ?? null,
      parseFileMode: Boolean(parseFilePath),
      datePreset,
    },
  };

  if (dryRun) {
    jsonLog({
      ok: true,
      dryRun: true,
      rowsParsed: rows.length,
      machineCount,
      windowStart: payload.windowStart,
      windowEnd: payload.windowEnd,
      datePreset,
    });
  } else {
    const result = await postIngestPayload(payload);
    jsonLog({
      ok: true,
      rowsParsed: rows.length,
      machineCount,
      windowStart: payload.windowStart,
      windowEnd: payload.windowEnd,
      importRunId: result.importRunId ?? null,
      rowsImported: result.rowsImported ?? null,
    });
  }
} finally {
  if (cleanupTarget && !keepDownload) {
    await rm(cleanupTarget.path, {
      recursive: cleanupTarget.mode === 'directory',
      force: true,
    });
  }
}
