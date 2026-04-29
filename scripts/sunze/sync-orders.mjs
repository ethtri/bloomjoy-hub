#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import {
  assertSunzeOrderRowsWithinWindow,
  parseSunzeOrderWorkbook,
  summarizeSunzeOrderRows,
} from './sunze-orders.mjs';

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
const headful = hasFlag('--headful');
const parseFilePath = getArg('--parse-file');
const datePreset = getArg('--date-preset', 'Last 7 Days');
const dateStartArg = getArg('--date-start');
const dateEndArg = getArg('--date-end');
const downloadDirArg = getArg('--download-dir');
const summaryMachineCodesArg =
  getArg('--summary-machine-codes') ||
  process.env.PROVIDER_SUMMARY_MACHINE_CODES ||
  process.env.SUNZE_SUMMARY_MACHINE_CODES ||
  '';
const DEFAULT_INGEST_CHUNK_SIZE = 1000;
const MAX_INGEST_CHUNK_SIZE = 10000;
const parsePositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const ingestChunkSize = Math.min(
  MAX_INGEST_CHUNK_SIZE,
  parsePositiveInteger(
    process.env.PROVIDER_INGEST_CHUNK_SIZE ?? process.env.SUNZE_INGEST_CHUNK_SIZE,
    DEFAULT_INGEST_CHUNK_SIZE
  )
);
const exportTaskTimeoutMs = parsePositiveInteger(
  process.env.PROVIDER_EXPORT_TASK_TIMEOUT_MS ?? process.env.SUNZE_EXPORT_TASK_TIMEOUT_MS,
  5 * 60 * 1000
);
const exportDownloadTimeoutMs = parsePositiveInteger(
  process.env.PROVIDER_EXPORT_DOWNLOAD_TIMEOUT_MS ?? process.env.SUNZE_EXPORT_DOWNLOAD_TIMEOUT_MS,
  2 * 60 * 1000
);
const supportedDatePresets = new Set([
  'Today',
  'Yesterday',
  'Last 3 Days',
  'Last 7 Days',
  'Last Month',
  'Last 3 Months',
]);
const expectedVisibleMachineCountEnv =
  process.env.PROVIDER_EXPECTED_MACHINE_COUNT ?? process.env.SUNZE_EXPECTED_MACHINE_COUNT;
const expectedVisibleMachineCount = expectedVisibleMachineCountEnv
  ? Number(expectedVisibleMachineCountEnv)
  : null;
const reportingTimezone =
  process.env.PROVIDER_REPORTING_TIMEZONE || process.env.SUNZE_REPORTING_TIMEZONE || 'America/Los_Angeles';
const loginUrl = process.env.PROVIDER_LOGIN_URL ?? process.env.SUNZE_LOGIN_URL;
const email = process.env.PROVIDER_REPORTING_EMAIL ?? process.env.SUNZE_REPORTING_EMAIL;
const password = process.env.PROVIDER_REPORTING_PASSWORD ?? process.env.SUNZE_REPORTING_PASSWORD;
const ingestUrl = process.env.REPORTING_INGEST_URL;
const ingestToken = process.env.REPORTING_INGEST_TOKEN;

const required = (value, name) => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const jsonLog = (payload) => console.log(JSON.stringify(payload, null, 2));

const dateTokenPattern =
  /(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]20\d{2})/g;

const normalizeDate = (value) => {
  const text = String(value ?? '').trim();
  const yearFirst = text.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const monthFirst = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})$/);
  const parts = yearFirst
    ? { year: yearFirst[1], month: yearFirst[2], day: yearFirst[3] }
    : monthFirst
      ? { year: monthFirst[3], month: monthFirst[1], day: monthFirst[2] }
      : null;

  if (!parts) return null;

  const month = Number(parts.month);
  const day = Number(parts.day);
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return `${parts.year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const getLocalDateKey = (date = new Date(), timezone = reportingTimezone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
};

const addDays = (dateKey, days) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
};

const daysBetweenInclusive = (startDateKey, endDateKey) => {
  const [startYear, startMonth, startDay] = startDateKey.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDateKey.split('-').map(Number);
  const startDate = Date.UTC(startYear, startMonth - 1, startDay);
  const endDate = Date.UTC(endYear, endMonth - 1, endDay);
  return Math.floor((endDate - startDate) / 86400000) + 1;
};

const customDateStart = dateStartArg ? normalizeDate(dateStartArg) : null;
const customDateEnd = dateEndArg ? normalizeDate(dateEndArg) : null;
const hasCustomDateRange = Boolean(customDateStart || customDateEnd);

if (dateStartArg && !customDateStart) {
  throw new Error(`Invalid provider custom date start: ${dateStartArg}. Expected YYYY-MM-DD.`);
}

if (dateEndArg && !customDateEnd) {
  throw new Error(`Invalid provider custom date end: ${dateEndArg}. Expected YYYY-MM-DD.`);
}

if (Boolean(customDateStart) !== Boolean(customDateEnd)) {
  throw new Error('Provider custom date exports require both --date-start and --date-end.');
}

if (customDateStart && customDateEnd && customDateStart > customDateEnd) {
  throw new Error(`Provider custom date start must be before or equal to date end: ${customDateStart} > ${customDateEnd}.`);
}

if (customDateStart && customDateEnd && daysBetweenInclusive(customDateStart, customDateEnd) > 31) {
  throw new Error(
    `Provider custom date exports must be requested in monthly chunks of 31 days or less: ${customDateStart} to ${customDateEnd}.`
  );
}

if (!hasCustomDateRange && !supportedDatePresets.has(datePreset)) {
  throw new Error(
    `Unsupported provider date preset: ${datePreset}. Supported presets: ${[...supportedDatePresets].join(', ')}. Use --date-start and --date-end for approved custom-range exports.`
  );
}

const exportDateLabel = hasCustomDateRange ? `Custom Range:${customDateStart}:${customDateEnd}` : datePreset;

const deriveWindowFromPreset = (preset) => {
  const normalizedPreset = String(preset ?? '').trim().toLowerCase();
  const today = getLocalDateKey();

  if (normalizedPreset === 'today') {
    return {
      uiWindowStart: today,
      uiWindowEnd: today,
      uiWindowSource: 'preset',
      selectedPreset: preset,
    };
  }

  if (normalizedPreset === 'yesterday') {
    const yesterday = addDays(today, -1);
    return {
      uiWindowStart: yesterday,
      uiWindowEnd: yesterday,
      uiWindowSource: 'preset',
      selectedPreset: preset,
    };
  }

  const dayMatch = normalizedPreset.match(/^last\s+(\d+)\s+days?$/);
  if (dayMatch) {
    const dayCount = Number(dayMatch[1]);
    if (Number.isInteger(dayCount) && dayCount > 0 && dayCount <= 31) {
      return {
        uiWindowStart: addDays(today, -(dayCount - 1)),
        uiWindowEnd: today,
        uiWindowSource: 'preset',
        selectedPreset: preset,
      };
    }
  }

  if (normalizedPreset === 'last month') {
    return {
      uiWindowStart: addDays(today, -62),
      uiWindowEnd: today,
      uiWindowSource: 'preset_guardrail',
      selectedPreset: preset,
    };
  }

  if (normalizedPreset === 'last 3 months') {
    return {
      uiWindowStart: addDays(today, -124),
      uiWindowEnd: today,
      uiWindowSource: 'preset_guardrail',
      selectedPreset: preset,
    };
  }

  return null;
};

const deriveSelectedWindow = () =>
  hasCustomDateRange
    ? {
        uiWindowStart: customDateStart,
        uiWindowEnd: customDateEnd,
        uiWindowSource: 'custom_range',
        selectedPreset: 'Custom Range',
      }
    : deriveWindowFromPreset(datePreset);

const parseRevenueCandidateCents = (value) => {
  const text = String(value ?? '').replace(/\s+/g, ' ');
  const patterns = [
    /(?:\$|USD)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d{1,2})?|[0-9]+(?:\.\d{1,2})?)/gi,
    /\b([0-9]{1,3}(?:,[0-9]{3})+\.\d{1,2}|[0-9]+\.\d{1,2})\b/g,
  ];
  const values = [];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const amount = Number(match[1].replace(/,/g, ''));
      if (Number.isFinite(amount)) values.push(Math.round(amount * 100));
    }
  }

  return values;
};

const parseInteger = (value) => {
  const match = String(value ?? '').match(/([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{1,6})/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ''));
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const extractRevenueCandidatesCents = (lines) => {
  const candidates = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^Revenue\b/i.test(lines[index])) continue;

    for (let offset = 0; offset <= 24; offset += 1) {
      for (const parsed of parseRevenueCandidateCents(lines[index + offset] ?? '')) {
        candidates.add(parsed);
      }
    }
  }

  return [...candidates].sort((left, right) => left - right);
};

const extractRecordCount = (text) => {
  const patterns = [
    /\bshowing\s+[0-9,]+\s*(?:-|\u2013)\s*[0-9,]+\s+of\s+([0-9,]+)\b/i,
    /\btotal\D{0,20}([0-9,]+)\D{0,20}(?:items?|records?|orders?)\b/i,
    /\b([0-9,]+)\s*(?:items?|records?|orders?)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const parsed = parseInteger(match[1]);
      if (parsed !== null) return parsed;
    }
  }

  return null;
};

const collectVisibleTexts = async (page) =>
  page.evaluate(() => {
    const selectors = [
      'input',
      'button',
      '[role="button"]',
      '[aria-label]',
      '[placeholder]',
      '[title]',
      '.ant-picker',
      '.ant-picker-input',
      '.ant-radio-button-wrapper',
      '.ant-select-selection-item',
      '.ant-select-selection-placeholder',
      '.ant-statistic',
      '.ant-pagination-total-text',
      '.custom-date-trigger',
      '.van-picker',
      '.van-calendar',
    ];
    return Array.from(document.querySelectorAll(selectors.join(',')))
      .flatMap((element) => {
        const values = [];
        if (element instanceof HTMLInputElement) {
          values.push(element.value, element.placeholder);
        }
        values.push(
          element.textContent || '',
          element.getAttribute('aria-label') || '',
          element.getAttribute('title') || '',
          element.getAttribute('placeholder') || ''
        );
        return values;
      })
      .map((text) => text.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 500);
  });

const sanitizeDiagnosticText = (value) =>
  String(value ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b\d{6,}\b/g, '[number]')
    .slice(0, 120);

const buildUiSummaryDiagnostic = (texts) =>
  [
    ...new Set(
      texts
        .filter(
          (text) =>
            /(last|day|date|time|range|today|yesterday|revenue|record|total|export|search|order)/i.test(
              text
            ) || Boolean(text.match(dateTokenPattern))
        )
        .map(sanitizeDiagnosticText)
    ),
  ]
    .slice(0, 20)
    .join(' | ');

const extractSelectedWindow = (texts) => {
  for (const text of texts) {
    const dates = Array.from(text.matchAll(dateTokenPattern))
      .map((match) => normalizeDate(match[0]))
      .filter(Boolean);

    if (dates.length >= 1) {
      return {
        uiWindowStart: dates[0],
        uiWindowEnd: dates[1] ?? dates[0],
        uiWindowSource: 'visible_dates',
        selectedPreset: null,
      };
    }
  }

  return null;
};

const readOrdersUiSummary = async (page) => {
  const bodyText = await page.locator('body').innerText();
  const lines = bodyText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const visibleTexts = await collectVisibleTexts(page);
  const combinedText = [...visibleTexts, bodyText].join('\n');
  const selectedWindow = extractSelectedWindow(visibleTexts) ?? deriveSelectedWindow();
  const uiRevenueCandidatesCents = extractRevenueCandidatesCents(lines);
  const uiRevenueCents = uiRevenueCandidatesCents.length > 0 ? Math.max(...uiRevenueCandidatesCents) : null;
  const uiRecordCount = extractRecordCount(combinedText);

  if (!selectedWindow?.uiWindowStart || !selectedWindow?.uiWindowEnd) {
    const diagnostic = buildUiSummaryDiagnostic(visibleTexts);
    throw new Error(
      diagnostic
        ? `Unable to verify the selected provider order date range. Visible filter controls: ${diagnostic}`
        : 'Unable to verify the selected provider order date range.'
    );
  }

  if (uiRevenueCents === null) {
    throw new Error('Unable to verify the provider order revenue total.');
  }

  if (uiRecordCount === null) {
    throw new Error('Unable to verify the provider order record count.');
  }

  return {
    ...selectedWindow,
    uiRevenueCents,
    uiRevenueCandidatesCents,
    uiRecordCount,
  };
};

const uiSummaryMatchesExport = (summary, uiSummary) =>
  (summary.orderAmountCents === uiSummary.uiRevenueCents ||
    uiSummary.uiRevenueCandidatesCents?.includes(summary.orderAmountCents)) &&
  (!summary.windowStart ||
    (summary.windowStart >= uiSummary.uiWindowStart && summary.windowStart <= uiSummary.uiWindowEnd)) &&
  (!summary.windowEnd ||
    (summary.windowEnd >= uiSummary.uiWindowStart && summary.windowEnd <= uiSummary.uiWindowEnd));

const assertExportMatchesUi = (summary, uiSummaries) => {
  const matchedSummary = uiSummaries.find((uiSummary) => uiSummaryMatchesExport(summary, uiSummary));
  if (matchedSummary) {
    return {
      ...matchedSummary,
      uiRevenueCents: summary.orderAmountCents,
      uiRecordCountMatched: summary.rowCount === matchedSummary.uiRecordCount,
    };
  }

  const uiDiagnostic = uiSummaries
    .map(
      (uiSummary, index) =>
        `snapshot ${index + 1}: ${uiSummary.uiRecordCount} rows/${uiSummary.uiRevenueCents} cents/${uiSummary.uiWindowStart} to ${uiSummary.uiWindowEnd}; revenue candidates ${uiSummary.uiRevenueCandidatesCents?.join(',') || 'none'}`
    )
    .join('; ');

  throw new Error(
    `Provider export mismatch: workbook parsed ${summary.rowCount} rows/${summary.orderAmountCents} cents/${summary.windowStart} to ${summary.windowEnd}; UI ${uiDiagnostic}.`
  );
};

const sanitizeMachineCode = (value) => {
  const text = String(value ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/.test(text)) return null;
  return text;
};

const extractMachineCodesFromText = (text) => {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const codes = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const inlineMatch = lines[index].match(/Machine\s*ID\s*(?::|\uFF1A)?\s*([A-Za-z0-9][A-Za-z0-9._-]{1,79})/i);
    const inlineCode = sanitizeMachineCode(inlineMatch?.[1]);
    if (inlineCode) codes.add(inlineCode);

    if (/^Machine\s*ID\s*(?::|\uFF1A)?$/i.test(lines[index])) {
      const nextCode = sanitizeMachineCode(lines[index + 1]);
      if (nextCode) codes.add(nextCode);
    }
  }

  return [...codes].sort();
};

const summaryMachineCodes = [
  ...new Set(
    summaryMachineCodesArg
      .split(',')
      .map(sanitizeMachineCode)
      .filter(Boolean)
  ),
].sort();

const summarizeRowsByDate = (rows, machineCodes = []) => {
  const summaryMachineCodeSet = new Set(machineCodes);
  const byDate = new Map();

  for (const row of rows) {
    if (!byDate.has(row.saleDate)) {
      byDate.set(row.saleDate, {
        date: row.saleDate,
        rowCount: 0,
        machineCounts: Object.fromEntries(machineCodes.map((machineCode) => [machineCode, 0])),
      });
    }

    const dateSummary = byDate.get(row.saleDate);
    dateSummary.rowCount += 1;
    if (summaryMachineCodeSet.has(row.machineCode)) {
      dateSummary.machineCounts[row.machineCode] += 1;
    }
  }

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
};

const clickNextMachineListPage = async (page) =>
  page.evaluate(() => {
    const next =
      document.querySelector('.ant-pagination-next') ||
      document.querySelector('[title="Next Page"]') ||
      document.querySelector('[aria-label="Next Page"]');
    if (
      !next ||
      next.classList.contains('ant-pagination-disabled') ||
      next.getAttribute('aria-disabled') === 'true' ||
      next.hasAttribute('disabled')
    ) {
      return false;
    }

    const target = next.querySelector('button,a') || next;
    if (!(target instanceof HTMLElement)) return false;
    target.click();
    return true;
  });

const scrollTopLevelMachineList = async (page) =>
  page.evaluate(() => {
    const candidates = [
      document.scrollingElement,
      document.documentElement,
      document.body,
      ...Array.from(
        document.querySelectorAll(
          '.ant-table-body,.ant-table-content,.ant-list,.ant-card-body,main,[class*="scroll"],[class*="table"]'
        )
      ),
    ].filter(Boolean);

    let moved = false;
    for (const element of candidates) {
      if (!(element instanceof HTMLElement)) continue;
      const beforeTop = element.scrollTop;
      const beforeLeft = element.scrollLeft;
      element.scrollTop = element.scrollHeight;
      element.scrollLeft = element.scrollLeft;
      if (element.scrollTop !== beforeTop || element.scrollLeft !== beforeLeft) {
        moved = true;
      }
    }

    const beforeY = window.scrollY;
    window.scrollTo(0, document.body.scrollHeight);
    return moved || window.scrollY !== beforeY;
  });

const readMachineListDiagnostic = async (page) =>
  page.evaluate(() => {
    const selectors = [
      '.ant-pagination',
      '.ant-table-pagination',
      '.ant-pagination-total-text',
      '[class*="pagination"]',
    ];
    return Array.from(document.querySelectorAll(selectors.join(',')))
      .map((element) => (element.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 5);
  });

const readVisibleSunzeMachineCodes = async (page, baseUrl) => {
  await page.goto(`${baseUrl}#/device`, { waitUntil: 'domcontentloaded' });
  assertAllowedSunzeRoute(page);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);

  const visibleMachineCodes = new Set();
  let pagesScanned = 0;
  let nextClicks = 0;
  let scrollAttempts = 0;

  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    pagesScanned += 1;
    const bodyText = await page.locator('body').innerText();
    for (const machineCode of extractMachineCodesFromText(bodyText)) {
      visibleMachineCodes.add(machineCode);
    }

    for (let scrollIndex = 0; scrollIndex < 10; scrollIndex += 1) {
      const beforeScrollCount = visibleMachineCodes.size;
      const scrolled = await scrollTopLevelMachineList(page);
      if (!scrolled) break;

      scrollAttempts += 1;
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(1000);

      const scrolledBodyText = await page.locator('body').innerText();
      for (const machineCode of extractMachineCodesFromText(scrolledBodyText)) {
        visibleMachineCodes.add(machineCode);
      }

      if (visibleMachineCodes.size === beforeScrollCount) break;
    }

    const clickedNextPage = await clickNextMachineListPage(page);
    if (!clickedNextPage) break;

    nextClicks += 1;
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
  }

  const machineCodes = [...visibleMachineCodes].sort();
  const paginationDiagnostic = (await readMachineListDiagnostic(page))
    .map(sanitizeDiagnosticText)
    .join(' | ');

  if (machineCodes.length === 0) {
    throw new Error('Unable to verify source machine coverage from the top-level machine list.');
  }

  if (
    expectedVisibleMachineCount !== null &&
    Number.isSafeInteger(expectedVisibleMachineCount) &&
    machineCodes.length !== expectedVisibleMachineCount
  ) {
    console.warn(
      `Visible source machine count changed: expected ${expectedVisibleMachineCount}, observed ${machineCodes.length}. Scanned ${pagesScanned} top-level page(s), clicked next ${nextClicks} time(s), scrolled ${scrollAttempts} time(s). Pagination controls: ${paginationDiagnostic || 'none'}.`
    );
  }

  return machineCodes;
};

const assertAllowedSunzeRoute = (page) => {
  const url = new URL(page.url());
  const allowedHashes = ['#/login', '#/home', '#/orderCenter', '#/taskExportList', '#/device'];
  const isAllowed = allowedHashes.some((hash) => url.hash.startsWith(hash));

  if (!isAllowed) {
    throw new Error(`Unexpected provider route during reporting sync: ${url.origin}${url.pathname}${url.hash}`);
  }
};

const openOrdersPage = async (page) => {
  const baseUrl = required(loginUrl, 'PROVIDER_LOGIN_URL').split('#')[0];

  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  assertAllowedSunzeRoute(page);
  await page.getByText(/Password/i).first().click().catch(() => {});
  await page
    .getByPlaceholder(/Username|Email/i)
    .fill(required(email, 'PROVIDER_REPORTING_EMAIL'))
    .catch(async () => {
      await page.locator('input').nth(0).fill(required(email, 'PROVIDER_REPORTING_EMAIL'));
    });
  await page
    .getByPlaceholder(/Password/i)
    .fill(required(password, 'PROVIDER_REPORTING_PASSWORD'))
    .catch(async () => {
      await page.locator('input[type="password"]').first().fill(required(password, 'PROVIDER_REPORTING_PASSWORD'));
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

  return baseUrl;
};

const selectDatePreset = async (page, preset) => {
  await page.getByText('Today').first().click();
  await page.waitForTimeout(500);
  await page.getByText(preset, { exact: true }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
};

const formatProviderDate = (dateKey) => dateKey.replace(/-/g, '/');

const clickFirstVisibleText = async (page, textPattern) => {
  const locator = page.getByText(textPattern).first();
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  await locator.click();
};

const clickVisibleTextIfPresent = async (page, textPattern, timeout = 2000) => {
  const locator = page.getByText(textPattern).first();
  try {
    await locator.waitFor({ state: 'visible', timeout });
    await locator.click();
    return true;
  } catch {
    return false;
  }
};

const clickDateFilter = async (page) => {
  const activeDateChip = page.locator('.filter-chip.active').first();

  if ((await activeDateChip.count()) > 0 && (await activeDateChip.isVisible().catch(() => false))) {
    await activeDateChip.click();
  } else {
    await page.getByText('Today').first().click().catch(async () => {
      await clickFirstVisibleText(page, /Today|Yesterday|Last \d+ Days|Last Month|Custom Range/i);
    });
  }

  await page.waitForTimeout(500);
};

const scrollFilterPanels = async (page) => {
  await page
    .evaluate(() => {
      const candidates = [
        ...Array.from(
          document.querySelectorAll(
            '.ant-dropdown, .ant-select-dropdown, .ant-picker-dropdown, .nut-popup, .nut-popover, [class*="dropdown"], [class*="popup"], [class*="filter"], [class*="Filter"]'
          )
        ),
        document.scrollingElement,
      ].filter(Boolean);

      for (const element of candidates) {
        if (!(element instanceof HTMLElement)) continue;
        element.scrollTop = element.scrollHeight;
      }
    })
    .catch(() => {});
  await page.waitForTimeout(500);
};

const openMoreFilters = async (page) => {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);

  let opened =
    (await clickVisibleTextIfPresent(page, /^More$/i, 5000)) ||
    (await page
      .locator('button, [role="button"], div, span')
      .filter({ hasText: /^More$/i })
      .first()
      .click()
      .then(() => true)
      .catch(() => false));

  if (!opened) {
    await page.getByText('Today').first().click().catch(() => {});
    await page.waitForTimeout(300);
    opened =
      (await clickVisibleTextIfPresent(page, /^More$/i, 5000)) ||
      (await page
        .locator('button, [role="button"], div, span')
        .filter({ hasText: /^More$/i })
        .first()
        .click()
        .then(() => true)
        .catch(() => false));
  }

  if (!opened) {
    throw new Error('Unable to open provider advanced filters.');
  }

  await page.waitForTimeout(750);
};

const clickOptionalDateConfirm = async (page) => {
  const labels = [/^Confirm$/i, /^OK$/i, /^Apply$/i, /^Done$/i];

  for (const label of labels) {
    const button = page.getByRole('button', { name: label }).first();
    if ((await button.count()) > 0 && (await button.isVisible().catch(() => false))) {
      await button.click();
      return true;
    }
  }

  for (const label of labels) {
    const text = page.getByText(label).first();
    if ((await text.count()) > 0 && (await text.isVisible().catch(() => false))) {
      await text.click();
      return true;
    }
  }

  return false;
};

const fillVisibleDateInputs = async (page, startDate, endDate) => {
  const formattedStart = formatProviderDate(startDate);
  const formattedEnd = formatProviderDate(endDate);
  const inputGroups = [page.locator('.ant-picker input:visible'), page.locator('input:visible')];

  for (const inputs of inputGroups) {
    const count = await inputs.count();
    if (count < 2) continue;

    await inputs.nth(0).fill(formattedStart);
    await inputs.nth(1).fill(formattedEnd);
    await inputs.nth(1).press('Enter').catch(() => {});
    return true;
  }

  return false;
};

const isVantCalendarVisible = async (page) =>
  page
    .locator('.van-calendar:visible')
    .first()
    .waitFor({ state: 'visible', timeout: 1000 })
    .then(() => true)
    .catch(() => false);

const openCustomRangeCalendar = async (page) => {
  await clickDateFilter(page);

  const customTrigger = page.locator('.custom-date-trigger:visible').first();
  let openedCustomFlow = false;

  if ((await customTrigger.count()) > 0 && (await customTrigger.isVisible().catch(() => false))) {
    await customTrigger.click();
    openedCustomFlow = true;
  } else {
    openedCustomFlow =
      (await clickVisibleTextIfPresent(page, /Custom Date Range/i, 2000)) ||
      (await clickVisibleTextIfPresent(page, /^Custom Range$/i, 2000)) ||
      (await clickVisibleTextIfPresent(page, /^Custom$/i, 2000)) ||
      (await clickVisibleTextIfPresent(page, /Custom Range|Custom/i, 2000));
  }

  if (!openedCustomFlow) {
    const diagnostic = buildUiSummaryDiagnostic(await collectVisibleTexts(page));
    throw new Error(
      diagnostic
        ? `Unable to open provider custom date control. Visible controls: ${diagnostic}`
        : 'Unable to open provider custom date control.'
    );
  }

  await page.waitForTimeout(500);

  if (!(await isVantCalendarVisible(page))) {
    await page
      .locator('.van-picker:visible')
      .getByText(/Day|Daily|By Day/i)
      .first()
      .click({ timeout: 1000 })
      .catch(() => {});
    await clickOptionalDateConfirm(page);
  }

  await page.locator('.van-calendar:visible').first().waitFor({ state: 'visible', timeout: 10000 });
};

const clickVantCalendarDate = async (page, dateKey) => {
  const result = await page.evaluate(async (targetDateKey) => {
    const [year, month, day] = targetDateKey.split('-').map(Number);
    const delay = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));
    const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const calendar = Array.from(document.querySelectorAll('.van-calendar')).find(isVisible);

    if (!calendar) {
      return { ok: false, reason: 'calendar_not_visible' };
    }

    const body =
      calendar.querySelector('.van-calendar__body') ||
      calendar.querySelector('[class*="calendar__body"]') ||
      calendar;
    const paddedMonth = String(month).padStart(2, '0');
    const targetMonthIndex = (year - 2022) * 12 + (month - 1);
    const current = new Date();
    const approximateMonthCount = Math.max(1, (current.getFullYear() - 2022) * 12 + current.getMonth() + 1);
    const monthMatches = (text) => {
      const normalized = normalizeText(text);
      return (
        new RegExp(`${year}\\D+0?${month}(?:\\D|$)`).test(normalized) ||
        normalized.includes(`${year}/${paddedMonth}`) ||
        normalized.includes(`${year}-${paddedMonth}`) ||
        normalized.includes(`${year}.${paddedMonth}`)
      );
    };
    const getMonths = () =>
      Array.from(calendar.querySelectorAll('.van-calendar-month, [class*="calendar-month"]')).filter(
        (element) =>
          element instanceof HTMLElement &&
          (element.matches('.van-calendar-month') ||
            element.querySelector('[role="grid"], .van-calendar-day, [class*="calendar-day"]'))
      );
    const getMonthTitle = (monthElement) =>
      normalizeText(
        (
          monthElement.querySelector(
            '.van-calendar-month__month-title, [class*="calendar-month"][class*="month-title"], [class*="month-title"]'
          ) || monthElement
        ).textContent
      );
    const findMonth = () => getMonths().find((monthElement) => monthMatches(getMonthTitle(monthElement)));

    let monthElement = findMonth();

    if (!monthElement && body instanceof HTMLElement) {
      const monthCount = Math.max(getMonths().length, approximateMonthCount);
      const scrollIndexes = [
        targetMonthIndex,
        targetMonthIndex - 1,
        targetMonthIndex + 1,
        targetMonthIndex - 2,
        targetMonthIndex + 2,
      ].filter((index) => index >= 0 && index < monthCount);

      for (const index of scrollIndexes) {
        body.scrollTop = Math.max(0, Math.min(body.scrollHeight, (body.scrollHeight / monthCount) * index));
        body.dispatchEvent(new Event('scroll', { bubbles: true }));
        await delay(250);
        monthElement = findMonth();
        if (monthElement) break;
      }
    }

    if (!monthElement) {
      const visibleTitles = getMonths().map(getMonthTitle).filter(Boolean).slice(-12);
      return {
        ok: false,
        reason: 'month_not_found',
        target: `${year}/${paddedMonth}`,
        visibleTitles,
      };
    }

    if (body instanceof HTMLElement && monthElement instanceof HTMLElement) {
      body.scrollTop = Math.max(0, monthElement.offsetTop - Math.floor(body.clientHeight / 3));
      body.dispatchEvent(new Event('scroll', { bubbles: true }));
    } else {
      monthElement.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    await delay(500);

    const findDayElements = () =>
      Array.from(monthElement.querySelectorAll('[role="gridcell"], .van-calendar-day, [class*="calendar-day"]')).filter(
        (element) => element instanceof HTMLElement && !/\bdisabled\b/i.test(element.className)
      );
    const findDayElement = () =>
      findDayElements().find((element) => {
        const text = normalizeText(element.textContent)
          .replace(/\b(Start|End)\b/gi, ' ')
          .trim();
        const match = text.match(/\d{1,2}/);
        return match && Number(match[0]) === day;
      });

    let dayElement = findDayElement();

    if (!dayElement && body instanceof HTMLElement) {
      body.dispatchEvent(new Event('scroll', { bubbles: true }));
      await delay(750);
      dayElement = findDayElement();
    }

    const dayElements = findDayElements();
    if (!dayElement) {
      return {
        ok: false,
        reason: 'day_not_found',
        target: `${year}/${paddedMonth}/${String(day).padStart(2, '0')}`,
        monthTitle: getMonthTitle(monthElement),
        dayTexts: dayElements.map((element) => normalizeText(element.textContent)).slice(0, 40),
      };
    }

    dayElement.scrollIntoView({ block: 'center', inline: 'center' });
    await delay(100);
    dayElement.click();

    return {
      ok: true,
      monthTitle: getMonthTitle(monthElement),
      dayText: normalizeText(dayElement.textContent).slice(0, 60),
    };
  }, dateKey);

  if (!result?.ok) {
    throw new Error(
      `Unable to select provider calendar date ${dateKey}: ${result?.reason || 'unknown'} ${JSON.stringify(result ?? {})}`
    );
  }

  return result;
};

const waitForVantCalendarToClose = async (page) =>
  page
    .waitForFunction(
      () =>
        !Array.from(document.querySelectorAll('.van-calendar')).some((element) => {
          if (!(element instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        }),
      null,
      { timeout: 10000 }
    )
    .catch(() => {});

const selectCustomDateRangeWithCalendar = async (page, startDate, endDate) => {
  await openCustomRangeCalendar(page);
  await clickVantCalendarDate(page, startDate);
  await page.waitForTimeout(300);
  await clickVantCalendarDate(page, endDate);
  await waitForVantCalendarToClose(page);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
};

const selectCustomDateRange = async (page, startDate, endDate) => {
  let calendarError = null;

  try {
    await selectCustomDateRangeWithCalendar(page, startDate, endDate);
    return;
  } catch (error) {
    calendarError = error;
    if (await isVantCalendarVisible(page)) {
      const diagnostic = buildUiSummaryDiagnostic(await collectVisibleTexts(page));
      throw new Error(
        diagnostic
          ? `Unable to select provider custom calendar range. Visible controls: ${diagnostic}. ${calendarError instanceof Error ? calendarError.message : String(calendarError)}`
          : `Unable to select provider custom calendar range. ${calendarError instanceof Error ? calendarError.message : String(calendarError)}`
      );
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
  }

  let openedCustomRange = false;

  await openMoreFilters(page).catch(() => {});
  await scrollFilterPanels(page);
  openedCustomRange =
    (await clickVisibleTextIfPresent(page, /^Custom Range$/i)) ||
    (await clickVisibleTextIfPresent(page, /^Custom$/i)) ||
    (await clickVisibleTextIfPresent(page, /Custom Range|Custom/i));
  await page.waitForTimeout(750);

  let filled = await fillVisibleDateInputs(page, startDate, endDate);

  if (!filled) {
    await clickDateFilter(page);
    openedCustomRange =
      (await clickVisibleTextIfPresent(page, /^Custom Range$/i)) ||
      (await clickVisibleTextIfPresent(page, /^Custom$/i));
    if (!openedCustomRange) {
      await scrollFilterPanels(page);
      openedCustomRange =
        (await clickVisibleTextIfPresent(page, /^Custom Range$/i)) ||
        (await clickVisibleTextIfPresent(page, /^Custom$/i)) ||
        (await clickVisibleTextIfPresent(page, /Custom Range|Custom/i));
    }
    await page.waitForTimeout(750);

    if (!openedCustomRange) {
      await openMoreFilters(page);
      await scrollFilterPanels(page);
      openedCustomRange =
        (await clickVisibleTextIfPresent(page, /^Custom Range$/i)) ||
        (await clickVisibleTextIfPresent(page, /^Custom$/i)) ||
        (await clickVisibleTextIfPresent(page, /Custom Range|Custom/i));
      await page.waitForTimeout(750);
    }

    filled = await fillVisibleDateInputs(page, startDate, endDate);
  }

  if (!filled && openedCustomRange) {
    openedCustomRange =
      (await clickVisibleTextIfPresent(page, /^Custom Range$/i)) ||
      (await clickVisibleTextIfPresent(page, /^Custom$/i)) ||
      (await clickVisibleTextIfPresent(page, /Custom Range|Custom/i));
    await page.waitForTimeout(750);
    filled = await fillVisibleDateInputs(page, startDate, endDate);
  }

  if (!filled) {
    const diagnostic = buildUiSummaryDiagnostic(await collectVisibleTexts(page));
    const calendarMessage = calendarError instanceof Error ? calendarError.message : null;
    throw new Error(
      diagnostic
        ? `Unable to fill provider custom date range. Visible date controls: ${diagnostic}${calendarMessage ? ` Calendar error: ${calendarMessage}` : ''}`
        : `Unable to fill provider custom date range.${calendarMessage ? ` Calendar error: ${calendarMessage}` : ''}`
    );
  }

  await clickOptionalDateConfirm(page);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
};

const selectOrdersDateFilter = async (page) => {
  if (hasCustomDateRange) {
    await selectCustomDateRange(page, customDateStart, customDateEnd);
    return;
  }

  await selectDatePreset(page, datePreset);
};

const requestExportTask = async (page) => {
  await page.getByText('Export', { exact: true }).click();
  await page
    .getByText(/Confirm to export selected orders|Please go to Export Center/i)
    .waitFor({ state: 'visible', timeout: 15000 })
    .catch(async () => {
      const diagnostic = buildUiSummaryDiagnostic(await collectVisibleTexts(page));
      throw new Error(
        diagnostic
          ? `Provider export confirmation did not appear. Visible controls: ${diagnostic}`
          : 'Provider export confirmation did not appear.'
      );
    });

  const requestedAtMs = await page.evaluate(() => Date.now());
  await page.getByText('Confirm', { exact: true }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);

  return requestedAtMs;
};

const markNewestCompletedExportTask = async (page, requestedAtMs) =>
  page.evaluate(
    ({ minCreatedAtMs, toleranceMs }) => {
      const timestampPattern = /20\d{2}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}:\d{2}/g;
      const sanitize = (value) =>
        String(value ?? '')
          .replace(/[A-Fa-f0-9]{16,}/g, '[id]')
          .replace(/\b\d{6,}\b/g, '[number]')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 240);
      const parseTimestamp = (value) => {
        const match = String(value ?? '').match(
          /(20\d{2})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/
        );
        if (!match) return null;

        const [, year, month, day, hour, minute, second] = match.map(Number);
        const parsed = new Date(year, month - 1, day, hour, minute, second).getTime();
        return Number.isFinite(parsed) ? parsed : null;
      };
      const extractCreatedAt = (text) => {
        const lines = String(text ?? '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        for (const line of lines) {
          if (/Expiry Time/i.test(line)) continue;
          const match = line.match(timestampPattern);
          if (match?.[0]) return parseTimestamp(match[0]);
        }

        const withoutExpiry = String(text ?? '').replace(
          /Expiry Time\s*:?\s*20\d{2}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}:\d{2}/gi,
          ''
        );
        const fallback = withoutExpiry.match(timestampPattern);
        return fallback?.[0] ? parseTimestamp(fallback[0]) : null;
      };

      document
        .querySelectorAll('[data-bloomjoy-download-candidate]')
        .forEach((element) => element.removeAttribute('data-bloomjoy-download-candidate'));

      const findClickableDownloadElement = (element) => {
        if (!(element instanceof HTMLElement)) return null;
        const clickable =
          element.closest(
            'button, a, [role="button"], .ant-btn, .nut-button, [class*="button"], [class*="Button"]'
          ) || element;
        return clickable instanceof HTMLElement ? clickable : null;
      };
      const clickableElements = [
        ...new Set(
          Array.from(
            document.querySelectorAll(
              'button, a, [role="button"], .ant-btn, .nut-button, [class*="button"], [class*="Button"], span'
            )
          )
            .filter((element) => (element.textContent || '').trim() === 'Download')
            .map(findClickableDownloadElement)
            .filter(Boolean)
        ),
      ];
      const candidates = [];
      const diagnostics = [];

      for (const element of clickableElements) {
        let current = element;
        for (let depth = 0; depth < 10 && current; depth += 1) {
          const text = current.innerText || current.textContent || '';
          if (/Completed/i.test(text) && /Task No/i.test(text)) {
            const createdAtMs = extractCreatedAt(text);
            const candidate = {
              createdAtMs,
              text: sanitize(text),
              element,
            };
            diagnostics.push(candidate);
            if (Number.isFinite(createdAtMs) && createdAtMs >= minCreatedAtMs - toleranceMs) {
              candidates.push(candidate);
            }
            break;
          }
          current = current.parentElement;
        }
      }

      candidates.sort((left, right) => right.createdAtMs - left.createdAtMs);
      const match = candidates[0] ?? null;

      if (match) {
        match.element.setAttribute('data-bloomjoy-download-candidate', 'true');
      }

      return {
        matched: Boolean(match),
        createdAtMs: match?.createdAtMs ?? null,
        taskText: match?.text ?? null,
        visibleCompletedTasks: diagnostics
          .sort((left, right) => (right.createdAtMs ?? 0) - (left.createdAtMs ?? 0))
          .slice(0, 5)
          .map(({ createdAtMs, text }) => ({ createdAtMs, text })),
      };
    },
    {
      minCreatedAtMs: requestedAtMs,
      toleranceMs: 2 * 60 * 1000,
    }
  );

const waitForDownloadFromAnyPage = (context, timeoutMs) =>
  new Promise((resolve, reject) => {
    const pageListeners = new Map();
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      context.off('page', watchPage);
      for (const [watchedPage, listener] of pageListeners.entries()) {
        watchedPage.off('download', listener);
      }
    };

    const settle = (callback, value) => {
      cleanup();
      callback(value);
    };

    function watchPage(watchedPage) {
      if (!watchedPage || pageListeners.has(watchedPage)) return;
      const listener = (download) => settle(resolve, download);
      pageListeners.set(watchedPage, listener);
      watchedPage.on('download', listener);
    }

    context.pages().forEach(watchPage);
    context.on('page', watchPage);
    timer = setTimeout(
      () => settle(reject, new Error(`Provider export task download did not start within ${timeoutMs}ms.`)),
      timeoutMs
    );
  });

const downloadCompletedExportTask = async (page, baseUrl, requestedAtMs) => {
  const taskListUrl = `${baseUrl}#/taskExportList`;
  const deadline = Date.now() + exportTaskTimeoutMs;
  let lastTaskDiagnostic = null;

  while (Date.now() < deadline) {
    await page.goto(taskListUrl, { waitUntil: 'domcontentloaded' });
    assertAllowedSunzeRoute(page);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);

    const task = await markNewestCompletedExportTask(page, requestedAtMs);
    lastTaskDiagnostic = task;

    if (task.matched) {
      console.warn(`Matched provider export task for download: ${task.taskText || 'sanitized task unavailable'}.`);
      const downloadPromise = waitForDownloadFromAnyPage(page.context(), exportDownloadTimeoutMs);
      await page.locator('[data-bloomjoy-download-candidate="true"]').first().click();
      return {
        download: await downloadPromise,
        task,
      };
    }

    await page.waitForTimeout(5000);
  }

  const visibleTasks = lastTaskDiagnostic?.visibleCompletedTasks?.map((task) => task.text).join(' | ');
  throw new Error(
    visibleTasks
      ? `Provider export task did not complete within ${exportTaskTimeoutMs}ms. Recent completed tasks: ${visibleTasks}`
      : `Provider export task did not complete within ${exportTaskTimeoutMs}ms.`
  );
};

const exportOrdersWorkbook = async () => {
  const downloadRoot = downloadDirArg
    ? resolve(downloadDirArg)
    : await mkdtemp(join(tmpdir(), 'bloomjoy-sales-orders-'));
  await mkdir(downloadRoot, { recursive: true });

  const browser = await chromium.launch({ headless: !headful });
  const context = await browser.newContext({ acceptDownloads: true, timezoneId: reportingTimezone });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  let succeeded = false;
  let downloadedFilePath = null;

  try {
    const baseUrl = await openOrdersPage(page);
    await selectOrdersDateFilter(page);
    const preExportUiSummary = await readOrdersUiSummary(page);

    const exportRequestedAtMs = await requestExportTask(page);
    const { download, task } = await downloadCompletedExportTask(page, baseUrl, exportRequestedAtMs);
    const filename = basename(await download.suggestedFilename());
    const filePath = join(downloadRoot, filename);
    await download.saveAs(filePath);
    downloadedFilePath = filePath;
    const visibleSunzeMachineCodes = await readVisibleSunzeMachineCodes(page, baseUrl);
    succeeded = true;

    return {
      filePath,
      uiSummaries: [preExportUiSummary],
      visibleSunzeMachineCodes,
      exportTaskCreatedAtMs: task.createdAtMs,
      cleanupPath: downloadDirArg ? filePath : downloadRoot,
      cleanupMode: downloadDirArg ? 'file' : 'directory',
    };
  } finally {
    await browser.close();
    if (!succeeded && downloadedFilePath) {
      await rm(downloadedFilePath, { force: true });
    } else if (!succeeded && !downloadDirArg) {
      await rm(downloadRoot, { recursive: true, force: true });
    }
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
        : `Sales import ingest failed with HTTP ${response.status}`
    );
  }

  return responseBody;
};

const chunkArray = (values, chunkSize) => {
  const chunks = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
};

const sumField = (responses, fieldName) =>
  responses.reduce((total, response) => {
    const value = response?.[fieldName];
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);

const maxField = (responses, fieldName) => {
  const values = responses
    .map((response) => response?.[fieldName])
    .filter((value) => Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : null;
};

const postIngestPayloadInChunks = async (payload) => {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const chunks = rows.length > 0 ? chunkArray(rows, ingestChunkSize) : [[]];
  const responses = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunkRows = chunks[index];
    const chunkNumber = index + 1;
    const response = await postIngestPayload({
      ...payload,
      sourceReference:
        chunks.length > 1
          ? `${payload.sourceReference}:chunk-${chunkNumber}-of-${chunks.length}`
          : payload.sourceReference,
      rows: chunkRows,
      meta: {
        ...payload.meta,
        chunkIndex: chunks.length > 1 ? chunkNumber : null,
        chunkCount: chunks.length,
        chunkRowCount: chunkRows.length,
      },
    });
    responses.push(response);
  }

  if (responses.length === 1) {
    return {
      ...responses[0],
      chunkCount: 1,
      ingestChunkSize,
      importRunIds: responses[0]?.importRunId ? [responses[0].importRunId] : [],
    };
  }

  return {
    ok: responses.every((response) => response?.ok !== false),
    dryRun: payload.dryRun === true,
    chunkCount: responses.length,
    ingestChunkSize,
    importRunIds: responses.map((response) => response?.importRunId).filter(Boolean),
    rowsSeen: sumField(responses, 'rowsSeen'),
    rowsValidated: sumField(responses, 'rowsValidated'),
    rowsImported: sumField(responses, 'rowsImported'),
    rowsSkipped: sumField(responses, 'rowsSkipped'),
    rowsQuarantined: sumField(responses, 'rowsQuarantined'),
    rowsIgnored: sumField(responses, 'rowsIgnored'),
    unmappedRowsQueued: sumField(responses, 'unmappedRowsQueued'),
    pendingUnmappedMachineCount: maxField(responses, 'pendingUnmappedMachineCount'),
    ignoredUnmappedMachineCount: maxField(responses, 'ignoredUnmappedMachineCount'),
    newlyPendingUnmappedMachineCount: maxField(responses, 'newlyPendingUnmappedMachineCount'),
  };
};

const cleanupExportSource = async (source) => {
  if (!source?.cleanupPath) return;

  await rm(source.cleanupPath, {
    recursive: source.cleanupMode === 'directory',
    force: true,
  });
};

const isRetryableWorkbookError = (error) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    /Sheet "Order" not found/i.test(message) ||
    /end of central directory|invalid zip|corrupt|unexpected end|contains no workbook files/i.test(message)
  );
};

const parseOrdersSourceRows = async (source) => {
  const rows = await parseSunzeOrderWorkbook(source.filePath);
  assertSunzeOrderRowsWithinWindow(rows, {
    windowStart: deriveSelectedWindow()?.uiWindowStart,
    windowEnd: deriveSelectedWindow()?.uiWindowEnd,
  });
  return rows;
};

const loadOrdersSource = async () => {
  if (parseFilePath) {
    const source = {
      filePath: resolve(parseFilePath),
      uiSummaries: [],
      visibleSunzeMachineCodes: [],
      cleanupPath: null,
      cleanupMode: null,
    };
    return {
      source,
      rows: await parseOrdersSourceRows(source),
    };
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const source = await exportOrdersWorkbook();
    try {
      return {
        source,
        rows: await parseOrdersSourceRows(source),
      };
    } catch (error) {
      await cleanupExportSource(source);
      if (attempt >= maxAttempts || !isRetryableWorkbookError(error)) {
        throw error;
      }

      console.warn(
        `Provider workbook parse failed after export attempt ${attempt}/${maxAttempts}; retrying export. ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  throw new Error('Unable to export and parse provider Orders workbook.');
};

let cleanupTarget = null;

try {
  const { source, rows } = await loadOrdersSource();

  cleanupTarget = source.cleanupPath
    ? { path: source.cleanupPath, mode: source.cleanupMode }
    : null;
  const summary = summarizeSunzeOrderRows(rows);

  const matchedUiSummary =
    source.uiSummaries.length > 0 ? assertExportMatchesUi(summary, source.uiSummaries) : null;

  const payload = {
    source: 'sunze_browser',
    sourceReference: `sunze-orders:${exportDateLabel}:${new Date().toISOString()}`,
    datePreset: hasCustomDateRange ? 'Custom Range' : datePreset,
    dateStart: customDateStart,
    dateEnd: customDateEnd,
    windowStart: summary.windowStart,
    windowEnd: summary.windowEnd,
    generatedAt: new Date().toISOString(),
    rows,
    meta: {
      worker: 'scripts/sunze/sync-orders.mjs',
      githubRunId: process.env.GITHUB_RUN_ID ?? null,
      githubWorkflow: process.env.GITHUB_WORKFLOW ?? null,
      githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      parseFileMode: Boolean(parseFilePath),
      datePreset: hasCustomDateRange ? 'Custom Range' : datePreset,
      dateStart: customDateStart,
      dateEnd: customDateEnd,
      exportTaskCreatedAtMs: source.exportTaskCreatedAtMs ?? null,
      selectedWindowStart: matchedUiSummary?.uiWindowStart ?? null,
      selectedWindowEnd: matchedUiSummary?.uiWindowEnd ?? null,
      selectedWindowSource: matchedUiSummary?.uiWindowSource ?? null,
      selectedPreset: matchedUiSummary?.selectedPreset ?? null,
      reportingTimezone,
      uiRecordCount: matchedUiSummary?.uiRecordCount ?? null,
      uiRecordCountMatched: matchedUiSummary?.uiRecordCountMatched ?? null,
      uiRevenueCents: matchedUiSummary?.uiRevenueCents ?? null,
      parsedRowCount: summary.rowCount,
      parsedMachineCount: summary.machineCount,
      parsedOrderAmountCents: summary.orderAmountCents,
      visibleSunzeMachineCodes: source.visibleSunzeMachineCodes,
      visibleSunzeMachineCount: source.visibleSunzeMachineCodes.length,
      expectedVisibleMachineCount: parseFilePath ? null : expectedVisibleMachineCount,
      machineCoverageRequired: !parseFilePath,
    },
  };

  if (dryRun) {
    const shouldValidateIngest = Boolean(ingestUrl || ingestToken || process.env.GITHUB_ACTIONS === 'true');
    const ingestValidation = shouldValidateIngest
      ? await postIngestPayloadInChunks({ ...payload, dryRun: true })
      : null;

    jsonLog({
      ok: true,
      dryRun: true,
      ingestDryRunValidated: Boolean(ingestValidation),
      rowsValidated: ingestValidation?.rowsValidated ?? null,
      rowsQuarantined: ingestValidation?.rowsQuarantined ?? null,
      rowsIgnored: ingestValidation?.rowsIgnored ?? null,
      ingestChunkCount: ingestValidation?.chunkCount ?? null,
      ingestChunkSize: ingestValidation?.ingestChunkSize ?? null,
      rowsParsed: summary.rowCount,
      machineCount: summary.machineCount,
      orderAmountCents: summary.orderAmountCents,
      windowStart: payload.windowStart,
      windowEnd: payload.windowEnd,
      selectedWindowStart: matchedUiSummary?.uiWindowStart ?? null,
      selectedWindowEnd: matchedUiSummary?.uiWindowEnd ?? null,
      selectedWindowSource: matchedUiSummary?.uiWindowSource ?? null,
      selectedPreset: matchedUiSummary?.selectedPreset ?? null,
      uiRecordCount: matchedUiSummary?.uiRecordCount ?? null,
      uiRecordCountMatched: matchedUiSummary?.uiRecordCountMatched ?? null,
      uiRevenueCents: matchedUiSummary?.uiRevenueCents ?? null,
      visibleSourceMachineCount: source.visibleSunzeMachineCodes.length,
      rowsByDate: summarizeRowsByDate(rows, summaryMachineCodes),
      pendingUnmappedMachineCount: ingestValidation?.pendingUnmappedMachineCount ?? null,
      ignoredUnmappedMachineCount: ingestValidation?.ignoredUnmappedMachineCount ?? null,
      newlyPendingUnmappedMachineCount: ingestValidation?.newlyPendingUnmappedMachineCount ?? null,
      datePreset: hasCustomDateRange ? 'Custom Range' : datePreset,
      dateStart: customDateStart,
      dateEnd: customDateEnd,
    });
  } else {
    const result = await postIngestPayloadInChunks(payload);
    jsonLog({
      ok: true,
      rowsParsed: summary.rowCount,
      machineCount: summary.machineCount,
      orderAmountCents: summary.orderAmountCents,
      windowStart: payload.windowStart,
      windowEnd: payload.windowEnd,
      selectedWindowStart: matchedUiSummary?.uiWindowStart ?? null,
      selectedWindowEnd: matchedUiSummary?.uiWindowEnd ?? null,
      selectedWindowSource: matchedUiSummary?.uiWindowSource ?? null,
      selectedPreset: matchedUiSummary?.selectedPreset ?? null,
      visibleSourceMachineCount: source.visibleSunzeMachineCodes.length,
      uiRecordCount: matchedUiSummary?.uiRecordCount ?? null,
      uiRecordCountMatched: matchedUiSummary?.uiRecordCountMatched ?? null,
      rowsByDate: summarizeRowsByDate(rows, summaryMachineCodes),
      importRunId: result.importRunId ?? result.importRunIds?.[0] ?? null,
      importRunIds: result.importRunIds ?? null,
      ingestChunkCount: result.chunkCount ?? null,
      ingestChunkSize: result.ingestChunkSize ?? null,
      rowsImported: result.rowsImported ?? null,
      rowsSkipped: result.rowsSkipped ?? null,
      rowsQuarantined: result.rowsQuarantined ?? null,
      rowsIgnored: result.rowsIgnored ?? null,
      pendingUnmappedMachineCount: result.pendingUnmappedMachineCount ?? null,
      datePreset: hasCustomDateRange ? 'Custom Range' : datePreset,
      dateStart: customDateStart,
      dateEnd: customDateEnd,
    });
  }
} finally {
  if (cleanupTarget) {
    await cleanupExportSource({
      cleanupPath: cleanupTarget.path,
      cleanupMode: cleanupTarget.mode,
    });
  }
}
