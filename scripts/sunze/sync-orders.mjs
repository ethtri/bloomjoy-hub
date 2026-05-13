#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import {
  assertSunzeOrderRowsWithinWindow,
  filterSunzeOrderRowsToWindow,
  parseSunzeOrderWorkbook,
  summarizeSunzeOrderRows,
} from './sunze-orders.mjs';
import {
  assertExportMatchesUi,
  extractRevenueCandidatesCents,
  extractUiRecordCount,
} from './reconcile-orders-export.mjs';
import {
  buildFailureDiagnostic,
  buildSanitizedFailureError,
  sanitizeDiagnosticMessage,
  sanitizeUiSummaryForDiagnostic,
  summarizeRowsByDateForLog,
} from './sync-diagnostics.mjs';

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
const diagnosticFilePath =
  getArg('--diagnostic-file') ||
  process.env.PROVIDER_DIAGNOSTIC_FILE ||
  process.env.SUNZE_DIAGNOSTIC_FILE ||
  'sunze-sync-diagnostic.json';
const filterDateWindow = hasFlag('--filter-date-window');
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
const exportTaskClockSkewToleranceMs = parsePositiveInteger(
  process.env.PROVIDER_EXPORT_TASK_CLOCK_SKEW_MS ?? process.env.SUNZE_EXPORT_TASK_CLOCK_SKEW_MS,
  0
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
const trustScopedRevenue = process.env.PROVIDER_TRUST_SCOPED_REVENUE === 'true';

const required = (value, name) => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const jsonLog = (payload) => console.log(JSON.stringify(payload, null, 2));

const dateTokenPattern =
  /(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]20\d{2})/g;
const monthDayTokenPattern = /(?:^|[^\d])(\d{1,2})[-/.](\d{1,2})(?![-/.\d])/g;

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

  const year = Number(parts.year);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
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

if (filterDateWindow && (!parseFilePath || !hasCustomDateRange)) {
  throw new Error(
    '--filter-date-window requires --parse-file with both --date-start and --date-end so out-of-window source rows stay explicit.'
  );
}

if (!hasCustomDateRange && !supportedDatePresets.has(datePreset)) {
  throw new Error(
    `Unsupported provider date preset: ${datePreset}. Supported presets: ${[...supportedDatePresets].join(', ')}. Use --date-start and --date-end for approved custom-range exports.`
  );
}

const exportDateLabel = hasCustomDateRange ? `Custom Range:${customDateStart}:${customDateEnd}` : datePreset;
const lastSyncDiagnostic = {
  worker: 'scripts/sunze/sync-orders.mjs',
  githubRunId: process.env.GITHUB_RUN_ID ?? null,
  githubWorkflow: process.env.GITHUB_WORKFLOW ?? null,
  githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  datePreset: hasCustomDateRange ? 'Custom Range' : datePreset,
  dateStart: customDateStart,
  dateEnd: customDateEnd,
  parseFileMode: Boolean(parseFilePath),
};

const updateDiagnostic = (patch) => Object.assign(lastSyncDiagnostic, patch);

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

const collectTrustedRecordCountTexts = async (page) =>
  page.evaluate(() => {
    const selectors = [
      '.ant-pagination-total-text',
      '[class*="pagination-total"]',
      '[class*="pagination"] [class*="total"]',
    ];
    return Array.from(document.querySelectorAll(selectors.join(',')))
      .map((element) => (element.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 20);
  });

const collectScopedRevenueTexts = async (page) =>
  page.evaluate(() => {
    const selectors = [
      '.ant-statistic',
      '[class*="Statistic"]',
      '[class*="statistic"]',
      '[class*="summary"]',
      '[class*="Summary"]',
    ];
    return Array.from(document.querySelectorAll(selectors.join(',')))
      .map((element) => (element.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((text) => /^Revenue\b/i.test(text) || /\bRevenue\b/i.test(text))
      .slice(0, 20);
  });

const sanitizeDiagnosticText = (value) =>
  String(value ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/Task\s*No\.?\s*:?\s*[A-Za-z0-9-]{4,}/gi, 'Task No.:[id]')
    .replace(/\b[A-Za-z0-9][A-Za-z0-9-]{15,}\b/g, '[id]')
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

const writeFailureDiagnostic = async (error) => {
  const payload = buildFailureDiagnostic({ error, diagnostic: lastSyncDiagnostic });

  try {
    await writeFile(diagnosticFilePath, JSON.stringify(payload, null, 2));
    console.warn(`Wrote sanitized Sunze sync diagnostic to ${diagnosticFilePath}.`);
  } catch (writeError) {
    console.warn(
      `Unable to write Sunze sync diagnostic: ${
        sanitizeDiagnosticMessage(writeError instanceof Error ? writeError.message : String(writeError))
      }`
    );
  }
};

const extractSelectedWindow = (texts) => {
  const allDates = [];
  const allMonthDayKeys = [];

  for (const text of texts) {
    const dates = Array.from(text.matchAll(dateTokenPattern))
      .map((match) => normalizeDate(match[0]))
      .filter(Boolean);
    const monthDayKeys = Array.from(String(text ?? '').matchAll(monthDayTokenPattern))
      .map((match) => {
        const month = Number(match[1]);
        const day = Number(match[2]);
        return Number.isInteger(month) && Number.isInteger(day) && month >= 1 && month <= 12 && day >= 1 && day <= 31
          ? `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          : null;
      })
      .filter(Boolean);

    allDates.push(...dates);
    allMonthDayKeys.push(...monthDayKeys);

    if (!hasCustomDateRange && dates.length >= 2) {
      return {
        uiWindowStart: dates[0],
        uiWindowEnd: dates[1],
        uiWindowSource: 'visible_dates',
        selectedPreset: null,
      };
    }
  }

  if (hasCustomDateRange) {
    const visibleDateSet = new Set(allDates);
    const visibleMonthDaySet = new Set(allMonthDayKeys);
    const customStartMonthDay = customDateStart.slice(5);
    const customEndMonthDay = customDateEnd.slice(5);

    return (visibleDateSet.has(customDateStart) && visibleDateSet.has(customDateEnd)) ||
      (visibleMonthDaySet.has(customStartMonthDay) && visibleMonthDaySet.has(customEndMonthDay))
      ? {
          uiWindowStart: customDateStart,
          uiWindowEnd: customDateEnd,
          uiWindowSource: 'visible_custom_dates',
          selectedPreset: 'Custom Range',
        }
      : null;
  }

  if (allDates.length >= 1) {
    return {
      uiWindowStart: allDates[0],
      uiWindowEnd: allDates[1] ?? allDates[0],
      uiWindowSource: 'visible_dates',
      selectedPreset: null,
    };
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
  const trustedRecordCountTexts = await collectTrustedRecordCountTexts(page);
  const scopedRevenueTexts = await collectScopedRevenueTexts(page);
  const selectedWindow = extractSelectedWindow(visibleTexts) ?? (!hasCustomDateRange ? deriveSelectedWindow() : null);
  const scopedRevenueCandidatesCents = extractRevenueCandidatesCents(scopedRevenueTexts);
  const weakRevenueCandidatesCents = extractRevenueCandidatesCents(lines);
  const uiRevenueCandidatesCents =
    scopedRevenueCandidatesCents.length > 0 ? scopedRevenueCandidatesCents : weakRevenueCandidatesCents;
  const uiRevenueCents = uiRevenueCandidatesCents.length > 0 ? Math.max(...uiRevenueCandidatesCents) : null;
  const uiRevenueSource = scopedRevenueCandidatesCents.length > 0 ? 'scoped_revenue_text' : 'weak_page_text';
  const uiRevenueTrusted = scopedRevenueCandidatesCents.length > 0 && trustScopedRevenue;
  const recordCountSummary = extractUiRecordCount({
    trustedTexts: trustedRecordCountTexts,
    fallbackTexts: [...lines, ...visibleTexts],
  });

  if (!selectedWindow?.uiWindowStart || !selectedWindow?.uiWindowEnd) {
    const diagnostic = buildUiSummaryDiagnostic(visibleTexts);
    throw new Error(
      diagnostic
        ? `Unable to verify the selected provider order date range. Visible filter controls: ${diagnostic}`
        : 'Unable to verify the selected provider order date range.'
    );
  }

  if (uiRevenueCents === null) {
    console.warn('Provider order revenue total was not visible; row count and workbook checks will decide reconciliation.');
  }

  return {
    ...selectedWindow,
    uiRevenueCents,
    uiRevenueCandidatesCents,
    uiRevenueSource,
    uiRevenueTrusted,
    ...recordCountSummary,
  };
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

  updateDiagnostic({
    machineCoverage: {
      visibleSourceMachineCount: machineCodes.length,
      verified: machineCodes.length > 0,
      issue: machineCodes.length === 0 ? 'missing_visible_machine_codes' : null,
      pagesScanned,
      nextClicks,
      scrollAttempts,
      paginationDiagnostic: paginationDiagnostic || null,
    },
  });

  if (machineCodes.length === 0) {
    console.warn(
      `Unable to verify source machine coverage from the top-level machine list. Continuing with workbook row machine IDs. Scanned ${pagesScanned} top-level page(s), clicked next ${nextClicks} time(s), scrolled ${scrollAttempts} time(s). Pagination controls: ${paginationDiagnostic || 'none'}.`
    );
    return [];
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

const routeBaseMatches = (url, expectedBaseUrl) => {
  const expected = new URL(expectedBaseUrl);
  const expectedPath = expected.pathname.endsWith('/') ? expected.pathname : `${expected.pathname}/`;
  const actualPath = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;

  return url.origin === expected.origin && actualPath.startsWith(expectedPath);
};

const assertAllowedSunzeRoute = (page, expectedBaseUrl = required(loginUrl, 'PROVIDER_LOGIN_URL').split('#')[0]) => {
  const url = new URL(page.url());
  const allowedHashes = ['#/login', '#/home', '#/orderCenter', '#/taskExportList', '#/device'];
  const isAllowed =
    routeBaseMatches(url, expectedBaseUrl) && allowedHashes.some((hash) => url.hash.startsWith(hash));

  if (!isAllowed) {
    throw new Error(`Unexpected provider route during reporting sync: ${url.origin}${url.pathname}${url.hash}`);
  }
};

const openOrdersPage = async (page) => {
  const baseUrl = required(loginUrl, 'PROVIDER_LOGIN_URL').split('#')[0];

  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  assertAllowedSunzeRoute(page, baseUrl);
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
  assertAllowedSunzeRoute(page, baseUrl);
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
    const monthSelector = '.van-calendar__month, .van-calendar-month, [class*="calendar-month"]';
    const daySelector = '[role="gridcell"], .van-calendar__day, .van-calendar-day, [class*="calendar-day"]';
    const getMonths = () =>
      Array.from(calendar.querySelectorAll(monthSelector)).filter(
        (element) =>
          element instanceof HTMLElement &&
          (element.matches('.van-calendar__month, .van-calendar-month') || element.querySelector(daySelector))
      );
    const getMonthTitle = (monthElement) =>
      normalizeText(
        (
          monthElement.querySelector(
            '.van-calendar__month-title, .van-calendar-month__month-title, [class*="calendar-month"][class*="month-title"], [class*="month-title"]'
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
      Array.from(monthElement.querySelectorAll(daySelector)).filter(
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

  const requestedAtMs = await page.evaluate(() => Math.floor(Date.now() / 1000) * 1000);
  await page.getByText('Confirm', { exact: true }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);

  return requestedAtMs;
};

const readVisibleExportTaskNos = async (page, baseUrl) => {
  await page.goto(`${baseUrl}#/taskExportList`, { waitUntil: 'domcontentloaded' });
  assertAllowedSunzeRoute(page);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);

  return page.evaluate(() => {
    const taskNos = new Set();
    const text = document.body?.innerText || '';
    for (const match of text.matchAll(/Task\s*No\.?\s*:?\s*([A-Za-z0-9-]{8,})/gi)) {
      taskNos.add(match[1]);
    }
    return [...taskNos];
  });
};

const markRequestedExportTaskForDownload = async (
  page,
  { requestedAtMs, ignoredTaskNos = [], targetTaskNo = null }
) =>
  page.evaluate(
    ({ minCreatedAtMs, toleranceMs, ignoredTaskNos: ignoredTaskNosArg, targetTaskNo: targetTaskNoArg }) => {
      const timestampPattern = /20\d{2}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}:\d{2}/g;
      const sanitize = (value) =>
        String(value ?? '')
          .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
          .replace(/Task\s*No\.?\s*:?\s*[A-Za-z0-9-]{4,}/gi, 'Task No.:[id]')
          .replace(/\b[A-Za-z0-9][A-Za-z0-9-]{15,}\b/g, '[id]')
          .replace(/[A-Fa-f0-9]{16,}/g, '[id]')
          .replace(/\b\d{6,}\b/g, '[number]')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 240);
      const maskTaskNo = (value) => {
        const text = String(value ?? '');
        return text ? `${text.slice(0, 4)}...[id]` : null;
      };
      const extractTaskNo = (text) =>
        String(text ?? '').match(/Task\s*No\.?\s*:?\s*([A-Za-z0-9-]{8,})/i)?.[1] ?? null;
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
      const normalizeStatus = (text) => {
        if (/Completed/i.test(text)) return 'Completed';
        if (/Fail(?:ed|ure)?/i.test(text)) return 'Failed';
        if (/Processing|Progress|Pending|Waiting|Running/i.test(text)) return 'Pending';
        return 'Unknown';
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
      const findDownloadElement = (root) => {
        const elements = [
          root,
          ...root.querySelectorAll(
            'button, a, [role="button"], .ant-btn, .nut-button, [class*="button"], [class*="Button"], span'
          ),
        ];

        return elements
          .filter((element) => (element.textContent || '').trim() === 'Download')
          .map(findClickableDownloadElement)
          .find(Boolean);
      };
      const ignoredTaskNos = new Set(ignoredTaskNosArg);
      const rowsByTaskNo = new Map();

      for (const element of document.querySelectorAll('body *')) {
        if (!(element instanceof HTMLElement)) continue;
        const text = element.innerText || element.textContent || '';
        if (!/Task\s*No/i.test(text) || text.length > 4000) continue;

        const taskNo = extractTaskNo(text);
        const createdAtMs = extractCreatedAt(text);
        if (!taskNo || !Number.isFinite(createdAtMs)) continue;

        const downloadElement = findDownloadElement(element);
        const status = normalizeStatus(text);
        const isCompleted = status === 'Completed' && Boolean(downloadElement);
        const score = text.length - (isCompleted ? 2000 : 0) - (downloadElement ? 500 : 0);
        const row = {
          taskNo,
          taskNoMasked: maskTaskNo(taskNo),
          createdAtMs,
          status,
          isCompleted,
          text: sanitize(text),
          element: downloadElement,
          score,
        };
        const existing = rowsByTaskNo.get(taskNo);

        if (!existing || row.score < existing.score) {
          rowsByTaskNo.set(taskNo, row);
        }
      }

      const rows = [...rowsByTaskNo.values()].sort((left, right) => right.createdAtMs - left.createdAtMs);
      const targetRow = targetTaskNoArg
        ? rows.find((row) => row.taskNo === targetTaskNoArg) ?? null
        : null;
      const candidateRows = rows
        .filter(
          (row) =>
            !ignoredTaskNos.has(row.taskNo) &&
            Number.isFinite(row.createdAtMs) &&
            row.createdAtMs >= minCreatedAtMs - toleranceMs
        )
        .sort((left, right) => {
          const leftDistance = Math.abs(left.createdAtMs - minCreatedAtMs);
          const rightDistance = Math.abs(right.createdAtMs - minCreatedAtMs);
          return leftDistance - rightDistance || left.createdAtMs - right.createdAtMs;
        });
      const claimedRow = targetRow ?? candidateRows[0] ?? null;
      const match = claimedRow?.isCompleted ? claimedRow : null;

      if (match) {
        match.element.setAttribute('data-bloomjoy-download-candidate', 'true');
      }

      return {
        matched: Boolean(match),
        taskNo: claimedRow?.taskNo ?? null,
        taskNoMasked: claimedRow?.taskNoMasked ?? null,
        createdAtMs: claimedRow?.createdAtMs ?? null,
        status: claimedRow?.status ?? null,
        taskText: claimedRow?.text ?? null,
        visibleTasks: rows
          .slice(0, 5)
          .map(({ createdAtMs, status, taskNoMasked }) => ({ createdAtMs, status, taskNoMasked })),
      };
    },
    {
      minCreatedAtMs: requestedAtMs,
      toleranceMs: exportTaskClockSkewToleranceMs,
      ignoredTaskNos,
      targetTaskNo,
    }
  );

const waitForDownloadFromAnyPage = (context, timeoutMs) => {
  let cleanup = () => {};
  let settled = false;

  const promise = new Promise((resolve, reject) => {
    const pageListeners = new Map();
    let timer = null;

    cleanup = () => {
      if (timer) clearTimeout(timer);
      context.off('page', watchPage);
      for (const [watchedPage, listener] of pageListeners.entries()) {
        watchedPage.off('download', listener);
      }
    };

    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
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

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      cleanup();
    },
  };
};

const downloadCompletedExportTask = async (page, baseUrl, requestedAtMs, ignoredTaskNos) => {
  const taskListUrl = `${baseUrl}#/taskExportList`;
  const deadline = Date.now() + exportTaskTimeoutMs;
  let lastTaskDiagnostic = null;
  let targetTaskNo = null;

  while (Date.now() < deadline) {
    await page.goto(taskListUrl, { waitUntil: 'domcontentloaded' });
    assertAllowedSunzeRoute(page);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);

    const task = await markRequestedExportTaskForDownload(page, {
      requestedAtMs,
      ignoredTaskNos,
      targetTaskNo,
    });
    lastTaskDiagnostic = task;

    if (!targetTaskNo && task.taskNo) {
      targetTaskNo = task.taskNo;
      console.warn(
        `Pinned provider export task ${task.taskNoMasked || '[id]'} created at ${new Date(
          task.createdAtMs
        ).toISOString()} with status ${task.status || 'Unknown'}.`
      );
    }

    if (targetTaskNo && task.status === 'Failed') {
      throw new Error(
        `Provider export task ${task.taskNoMasked || '[id]'} failed after request at ${new Date(
          task.createdAtMs
        ).toISOString()}.`
      );
    }

    if (task.matched) {
      console.warn(
        `Matched provider export task ${task.taskNoMasked || '[id]'} for download with status ${
          task.status || 'Unknown'
        } and createdAt ${new Date(task.createdAtMs).toISOString()}.`
      );
      const downloadWaiter = waitForDownloadFromAnyPage(page.context(), exportDownloadTimeoutMs);
      try {
        await page.locator('[data-bloomjoy-download-candidate="true"]').first().click();
      } catch (error) {
        downloadWaiter.cancel();
        throw error;
      }

      return {
        download: await downloadWaiter.promise,
        task,
      };
    }

    await page.waitForTimeout(5000);
  }

  const visibleTasks = lastTaskDiagnostic?.visibleTasks
    ?.map(
      (task) =>
        `${task.taskNoMasked || '[id]'} ${task.status || 'Unknown'} ${
          task.createdAtMs ? new Date(task.createdAtMs).toISOString() : 'unknown-created-at'
        }`
    )
    .join(' | ');
  throw new Error(
    visibleTasks
      ? `Provider export task did not complete within ${exportTaskTimeoutMs}ms. Recent task diagnostics: ${visibleTasks}`
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
    const preExistingExportTaskNos = await readVisibleExportTaskNos(page, baseUrl);
    await page.goto(`${baseUrl}#/orderCenter`, { waitUntil: 'domcontentloaded' });
    assertAllowedSunzeRoute(page);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2500);
    await selectOrdersDateFilter(page);
    const preExportUiSummary = await readOrdersUiSummary(page);

    const exportRequestedAtMs = await requestExportTask(page);
    const { download, task } = await downloadCompletedExportTask(
      page,
      baseUrl,
      exportRequestedAtMs,
      preExistingExportTaskNos
    );
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

const isRetryableProviderExportError = (error) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    /Sheet "Order" not found/i.test(message) ||
    /end of central directory|invalid zip|corrupt|unexpected end|contains no workbook files/i.test(message) ||
    /Provider export mismatch/i.test(message) ||
    /Unable to verify the selected provider order date range/i.test(message)
  );
};

const parseOrdersSourceRows = async (source) => {
  const sourceRows = await parseSunzeOrderWorkbook(source.filePath);
  const selectedWindow = deriveSelectedWindow();
  const windowBounds = {
    windowStart: selectedWindow?.uiWindowStart,
    windowEnd: selectedWindow?.uiWindowEnd,
  };

  if (filterDateWindow) {
    const filtered = filterSunzeOrderRowsToWindow(sourceRows, windowBounds);
    assertSunzeOrderRowsWithinWindow(filtered.rows, windowBounds);
    return {
      sourceRows,
      rows: filtered.rows,
      outOfWindowRowCount: filtered.outOfWindowRows.length,
      dateWindowFilterApplied: true,
    };
  }

  assertSunzeOrderRowsWithinWindow(sourceRows, windowBounds);
  return {
    sourceRows,
    rows: sourceRows,
    outOfWindowRowCount: 0,
    dateWindowFilterApplied: false,
  };
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
      matchedUiSummary: null,
      ...(await parseOrdersSourceRows(source)),
    };
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let source = null;
    try {
      source = await exportOrdersWorkbook();
      const parsed = await parseOrdersSourceRows(source);
      const summary = summarizeSunzeOrderRows(parsed.rows);
      const matchedUiSummary =
        source.uiSummaries.length > 0 ? assertExportMatchesUi(summary, source.uiSummaries) : null;

      updateDiagnostic({
        workbookSummary: {
          rowCount: summary.rowCount,
          machineCount: summary.machineCount,
          orderAmountCents: summary.orderAmountCents,
          windowStart: summary.windowStart,
          windowEnd: summary.windowEnd,
        },
        uiSummary: sanitizeUiSummaryForDiagnostic(matchedUiSummary),
      });

      return {
        source,
        matchedUiSummary,
        ...parsed,
      };
    } catch (error) {
      if (source) {
        updateDiagnostic({
          failedAttempt: attempt,
          uiSummaries: source.uiSummaries.map(sanitizeUiSummaryForDiagnostic),
          exportTaskCreatedAtMs: source.exportTaskCreatedAtMs ?? null,
          visibleSourceMachineCount: source.visibleSunzeMachineCodes.length,
        });
        await cleanupExportSource(source);
      }
      if (attempt >= maxAttempts || !isRetryableProviderExportError(error)) {
        throw error;
      }

      console.warn(
        `Provider export validation failed after attempt ${attempt}/${maxAttempts}; retrying export. ${sanitizeDiagnosticMessage(
          error instanceof Error ? error.message : String(error)
        )}`
      );
    }
  }

  throw new Error('Unable to export and parse provider Orders workbook.');
};

let cleanupTarget = null;

try {
  const { source, rows, sourceRows, outOfWindowRowCount, dateWindowFilterApplied, matchedUiSummary } =
    await loadOrdersSource();

  cleanupTarget = source.cleanupPath
    ? { path: source.cleanupPath, mode: source.cleanupMode }
    : null;
  const summary = summarizeSunzeOrderRows(rows);
  const sourceSummary = summarizeSunzeOrderRows(sourceRows);
  const requestedWindow = deriveSelectedWindow();
  const visibleSunzeMachineCount = source.visibleSunzeMachineCodes.length;
  const machineCoverageVerified = !parseFilePath && visibleSunzeMachineCount > 0;
  const machineCoverageIssue = parseFilePath
    ? 'parse_file_no_machine_center_check'
    : machineCoverageVerified
      ? null
      : 'missing_visible_machine_codes';

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
      uiRecordCountTrusted: matchedUiSummary?.uiRecordCountTrusted ?? null,
      uiRecordCountSource: matchedUiSummary?.uiRecordCountSource ?? null,
      uiRecordCountReason: matchedUiSummary?.uiRecordCountReason ?? null,
      uiRecordCountCandidates: matchedUiSummary?.uiRecordCountCandidates ?? [],
      uiRecordCountSourceText: matchedUiSummary?.uiRecordCountSourceText ?? null,
      uiRevenueCents: matchedUiSummary?.uiRevenueCents ?? null,
      uiRevenueMatched: matchedUiSummary?.uiRevenueMatched ?? null,
      uiRevenueTrusted: matchedUiSummary?.uiRevenueTrusted ?? null,
      uiRevenueSource: matchedUiSummary?.uiRevenueSource ?? null,
      uiRevenueCandidatesCents: matchedUiSummary?.uiRevenueCandidatesCents ?? [],
      uiReconciliationMode: matchedUiSummary?.uiReconciliationMode ?? null,
      parsedRowCount: summary.rowCount,
      parsedMachineCount: summary.machineCount,
      parsedOrderAmountCents: summary.orderAmountCents,
      sourceParsedRowCount: sourceSummary.rowCount,
      sourceMachineCount: sourceSummary.machineCount,
      sourceOrderAmountCents: sourceSummary.orderAmountCents,
      sourceWindowStart: sourceSummary.windowStart,
      sourceWindowEnd: sourceSummary.windowEnd,
      filteredWindowStart: summary.windowStart,
      filteredWindowEnd: summary.windowEnd,
      requestedWindowStart: requestedWindow?.uiWindowStart ?? null,
      requestedWindowEnd: requestedWindow?.uiWindowEnd ?? null,
      dateWindowFilterApplied,
      outOfWindowRowCount,
      visibleSunzeMachineCodes: source.visibleSunzeMachineCodes,
      visibleSunzeMachineCount,
      expectedVisibleMachineCount: parseFilePath ? null : expectedVisibleMachineCount,
      machineCoverageRequired: false,
      machineCoverageVerified,
      machineCoverageIssue,
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
      rowsSeen: ingestValidation?.rowsSeen ?? null,
      rowsValidated: ingestValidation?.rowsValidated ?? null,
      rowsQuarantined: ingestValidation?.rowsQuarantined ?? null,
      rowsIgnored: ingestValidation?.rowsIgnored ?? null,
      unmappedRowsQueued: ingestValidation?.unmappedRowsQueued ?? null,
      ingestChunkCount: ingestValidation?.chunkCount ?? null,
      ingestChunkSize: ingestValidation?.ingestChunkSize ?? null,
      rowsParsed: summary.rowCount,
      machineCount: summary.machineCount,
      orderAmountCents: summary.orderAmountCents,
      windowStart: payload.windowStart,
      windowEnd: payload.windowEnd,
      sourceRowsParsed: sourceSummary.rowCount,
      sourceMachineCount: sourceSummary.machineCount,
      sourceOrderAmountCents: sourceSummary.orderAmountCents,
      sourceWindowStart: sourceSummary.windowStart,
      sourceWindowEnd: sourceSummary.windowEnd,
      filteredRowsParsed: summary.rowCount,
      filteredMachineCount: summary.machineCount,
      filteredOrderAmountCents: summary.orderAmountCents,
      filteredWindowStart: summary.windowStart,
      filteredWindowEnd: summary.windowEnd,
      requestedWindowStart: requestedWindow?.uiWindowStart ?? null,
      requestedWindowEnd: requestedWindow?.uiWindowEnd ?? null,
      dateWindowFilterApplied,
      outOfWindowRowCount,
      selectedWindowStart: matchedUiSummary?.uiWindowStart ?? null,
      selectedWindowEnd: matchedUiSummary?.uiWindowEnd ?? null,
      selectedWindowSource: matchedUiSummary?.uiWindowSource ?? null,
      selectedPreset: matchedUiSummary?.selectedPreset ?? null,
      uiRecordCount: matchedUiSummary?.uiRecordCount ?? null,
      uiRecordCountMatched: matchedUiSummary?.uiRecordCountMatched ?? null,
      uiRecordCountTrusted: matchedUiSummary?.uiRecordCountTrusted ?? null,
      uiRecordCountSource: matchedUiSummary?.uiRecordCountSource ?? null,
      uiRecordCountReason: matchedUiSummary?.uiRecordCountReason ?? null,
      uiRecordCountCandidates: matchedUiSummary?.uiRecordCountCandidates ?? [],
      uiRevenueCents: matchedUiSummary?.uiRevenueCents ?? null,
      uiRevenueMatched: matchedUiSummary?.uiRevenueMatched ?? null,
      uiRevenueTrusted: matchedUiSummary?.uiRevenueTrusted ?? null,
      uiRevenueSource: matchedUiSummary?.uiRevenueSource ?? null,
      uiRevenueCandidatesCents: matchedUiSummary?.uiRevenueCandidatesCents ?? [],
      uiReconciliationMode: matchedUiSummary?.uiReconciliationMode ?? null,
      visibleSourceMachineCount: visibleSunzeMachineCount,
      machineCoverageVerified,
      machineCoverageIssue,
      rowsByDate: summarizeRowsByDateForLog(rows, summaryMachineCodes),
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
      visibleSourceMachineCount: visibleSunzeMachineCount,
      uiRecordCount: matchedUiSummary?.uiRecordCount ?? null,
      uiRecordCountMatched: matchedUiSummary?.uiRecordCountMatched ?? null,
      uiRecordCountTrusted: matchedUiSummary?.uiRecordCountTrusted ?? null,
      uiRecordCountSource: matchedUiSummary?.uiRecordCountSource ?? null,
      uiRecordCountReason: matchedUiSummary?.uiRecordCountReason ?? null,
      uiRecordCountCandidates: matchedUiSummary?.uiRecordCountCandidates ?? [],
      uiRevenueCents: matchedUiSummary?.uiRevenueCents ?? null,
      uiRevenueMatched: matchedUiSummary?.uiRevenueMatched ?? null,
      uiRevenueTrusted: matchedUiSummary?.uiRevenueTrusted ?? null,
      uiRevenueSource: matchedUiSummary?.uiRevenueSource ?? null,
      uiRevenueCandidatesCents: matchedUiSummary?.uiRevenueCandidatesCents ?? [],
      uiReconciliationMode: matchedUiSummary?.uiReconciliationMode ?? null,
      machineCoverageVerified,
      machineCoverageIssue,
      rowsByDate: summarizeRowsByDateForLog(rows, summaryMachineCodes),
      importRunId: result.importRunId ?? result.importRunIds?.[0] ?? null,
      importRunIds: result.importRunIds ?? null,
      ingestChunkCount: result.chunkCount ?? null,
      ingestChunkSize: result.ingestChunkSize ?? null,
      rowsSeen: result.rowsSeen ?? null,
      rowsValidated: result.rowsValidated ?? null,
      rowsImported: result.rowsImported ?? null,
      rowsSkipped: result.rowsSkipped ?? null,
      rowsQuarantined: result.rowsQuarantined ?? null,
      rowsIgnored: result.rowsIgnored ?? null,
      unmappedRowsQueued: result.unmappedRowsQueued ?? null,
      pendingUnmappedMachineCount: result.pendingUnmappedMachineCount ?? null,
      ignoredUnmappedMachineCount: result.ignoredUnmappedMachineCount ?? null,
      newlyPendingUnmappedMachineCount: result.newlyPendingUnmappedMachineCount ?? null,
      sourceRowsParsed: sourceSummary.rowCount,
      sourceMachineCount: sourceSummary.machineCount,
      sourceOrderAmountCents: sourceSummary.orderAmountCents,
      sourceWindowStart: sourceSummary.windowStart,
      sourceWindowEnd: sourceSummary.windowEnd,
      filteredRowsParsed: summary.rowCount,
      filteredMachineCount: summary.machineCount,
      filteredOrderAmountCents: summary.orderAmountCents,
      filteredWindowStart: summary.windowStart,
      filteredWindowEnd: summary.windowEnd,
      requestedWindowStart: requestedWindow?.uiWindowStart ?? null,
      requestedWindowEnd: requestedWindow?.uiWindowEnd ?? null,
      dateWindowFilterApplied,
      outOfWindowRowCount,
      datePreset: hasCustomDateRange ? 'Custom Range' : datePreset,
      dateStart: customDateStart,
      dateEnd: customDateEnd,
    });
  }
} catch (error) {
  await writeFailureDiagnostic(error);
  throw buildSanitizedFailureError(error);
} finally {
  if (cleanupTarget) {
    await cleanupExportSource({
      cleanupPath: cleanupTarget.path,
      cleanupMode: cleanupTarget.mode,
    });
  }
}
