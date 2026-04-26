#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { parseSunzeOrderWorkbook, summarizeSunzeOrderRows } from './sunze-orders.mjs';

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
const datePreset = getArg('--date-preset', 'Last 3 Days');
const dateFrom = getArg('--date-from');
const dateTo = getArg('--date-to');
const downloadDirArg = getArg('--download-dir');
const expectedVisibleMachineCount = process.env.SUNZE_EXPECTED_MACHINE_COUNT
  ? Number(process.env.SUNZE_EXPECTED_MACHINE_COUNT)
  : null;
const reportingTimezone = process.env.SUNZE_REPORTING_TIMEZONE || 'America/Los_Angeles';
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

const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));

if ((dateFrom && !dateTo) || (!dateFrom && dateTo)) {
  throw new Error('Both --date-from and --date-to are required for a custom Sunze range.');
}

if (dateFrom && (!isDateKey(dateFrom) || !isDateKey(dateTo) || dateFrom > dateTo)) {
  throw new Error('Custom Sunze range must use YYYY-MM-DD dates with --date-from <= --date-to.');
}

const expectedCustomWindow =
  dateFrom && dateTo
    ? {
        uiWindowStart: dateFrom,
        uiWindowEnd: dateTo,
        uiWindowSource: 'requested_custom_range',
        selectedPreset: 'Custom Range',
      }
    : null;

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

  return null;
};

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
  const selectedWindow =
    extractSelectedWindow(visibleTexts) ?? expectedCustomWindow ?? deriveWindowFromPreset(datePreset);
  const uiRevenueCandidatesCents = extractRevenueCandidatesCents(lines);
  const uiRevenueCents = uiRevenueCandidatesCents.length > 0 ? Math.max(...uiRevenueCandidatesCents) : null;
  const uiRecordCount = extractRecordCount(combinedText);

  if (!selectedWindow?.uiWindowStart || !selectedWindow?.uiWindowEnd) {
    const diagnostic = buildUiSummaryDiagnostic(visibleTexts);
    throw new Error(
      diagnostic
        ? `Unable to verify the selected Sunze order date range. Visible filter controls: ${diagnostic}`
        : 'Unable to verify the selected Sunze order date range.'
    );
  }

  if (uiRevenueCents === null) {
    throw new Error('Unable to verify the Sunze order revenue total.');
  }

  if (uiRecordCount === null) {
    throw new Error('Unable to verify the Sunze order record count.');
  }

  return {
    ...selectedWindow,
    uiRevenueCents,
    uiRevenueCandidatesCents,
    uiRecordCount,
  };
};

const uiSummaryMatchesExport = (summary, uiSummary) =>
  summary.rowCount === uiSummary.uiRecordCount &&
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
    };
  }

  const uiDiagnostic = uiSummaries
    .map(
      (uiSummary, index) =>
        `snapshot ${index + 1}: ${uiSummary.uiRecordCount} rows/${uiSummary.uiRevenueCents} cents/${uiSummary.uiWindowStart} to ${uiSummary.uiWindowEnd}; revenue candidates ${uiSummary.uiRevenueCandidatesCents?.join(',') || 'none'}`
    )
    .join('; ');

  throw new Error(
    `Sunze export mismatch: workbook parsed ${summary.rowCount} rows/${summary.orderAmountCents} cents/${summary.windowStart} to ${summary.windowEnd}; UI ${uiDiagnostic}.`
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
    throw new Error('Unable to verify Sunze machine coverage from the top-level machine list.');
  }

  if (
    expectedVisibleMachineCount !== null &&
    Number.isSafeInteger(expectedVisibleMachineCount) &&
    machineCodes.length !== expectedVisibleMachineCount
  ) {
    console.warn(
      `Sunze visible machine count changed: expected ${expectedVisibleMachineCount}, observed ${machineCodes.length}. Scanned ${pagesScanned} top-level page(s), clicked next ${nextClicks} time(s), scrolled ${scrollAttempts} time(s). Pagination controls: ${paginationDiagnostic || 'none'}.`
    );
  }

  return machineCodes;
};

const assertAllowedSunzeRoute = (page) => {
  const url = new URL(page.url());
  const allowedHashes = ['#/login', '#/home', '#/orderCenter', '#/device'];
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

  return baseUrl;
};

const selectDatePreset = async (page, preset) => {
  await page.getByText('Today').first().click();
  await page.waitForTimeout(500);
  await page.getByText(preset, { exact: true }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
};

const clickVisibleButton = async (page, name) => {
  const buttons = page.getByRole('button', { name });
  const count = await buttons.count();

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if ((await button.isVisible().catch(() => false)) && !(await button.isDisabled().catch(() => false))) {
      await button.click();
      return true;
    }
  }

  return false;
};

const applyOrdersSearch = async (page) => {
  const clicked = await clickVisibleButton(page, /^(search|query|查询)$/i);
  if (!clicked) return;

  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
};

const toSlashDate = (dateKey) => dateKey.replaceAll('-', '/');

const toUsDate = (dateKey) => {
  const [year, month, day] = dateKey.split('-');
  return `${month}/${day}/${year}`;
};

const fillCustomDateInputs = async (page, fromDate, toDate) => {
  const pickerInputs = page
    .locator('.ant-picker-dropdown input, [class*="picker-dropdown"] input, [class*="date"] input')
    .filter({ visible: true });
  const inputCount = await pickerInputs.count();

  if (inputCount < 2) {
    await page.keyboard.type(fromDate);
    await page.keyboard.press('Tab');
    await page.keyboard.type(toDate);
    return {
      attemptedFormat: 'keyboard',
      values: [],
    };
  }

  const dateFormats = [
    [fromDate, toDate],
    [toSlashDate(fromDate), toSlashDate(toDate)],
    [toUsDate(fromDate), toUsDate(toDate)],
  ];

  for (const [fromValue, toValue] of dateFormats) {
    await pickerInputs.nth(0).fill(fromValue);
    await pickerInputs.nth(1).fill(toValue);

    const values = await pickerInputs.evaluateAll((inputs) =>
      inputs.map((input) => (input instanceof HTMLInputElement ? input.value : ''))
    );
    const normalizedValues = values
      .map((value) => normalizeDate(String(value ?? '').match(dateTokenPattern)?.[0] ?? value))
      .filter(Boolean);
    if (normalizedValues.includes(fromDate) && normalizedValues.includes(toDate)) {
      return {
        attemptedFormat: fromValue.includes('/') ? 'slash' : 'iso',
        values,
      };
    }
  }

  const values = await pickerInputs.evaluateAll((inputs) =>
    inputs.map((input) => (input instanceof HTMLInputElement ? input.value : ''))
  );
  return {
    attemptedFormat: 'unverified',
    values,
  };
};

const applyCustomDatePicker = async (page) => {
  const pickerDropdown = page.locator('.ant-picker-dropdown, [class*="picker-dropdown"]').filter({ visible: true });
  const clickedOk =
    (await pickerDropdown
      .last()
      .getByRole('button', { name: /^(ok|apply|confirm|确定|应用)$/i })
      .click({ timeout: 1500 })
      .then(() => true)
      .catch(() => false)) ||
    (await clickVisibleButton(page, /^(ok|apply|confirm|确定|应用)$/i));

  if (!clickedOk) {
    await page.keyboard.press('Enter').catch(() => {});
  }

  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
};

const selectCustomDateRange = async (page, fromDate, toDate) => {
  await page.getByText('Today').first().click();
  await page.waitForTimeout(500);
  await page.getByText('Custom Range', { exact: true }).click();
  await page.waitForTimeout(500);

  const result = await fillCustomDateInputs(page, fromDate, toDate);
  await applyCustomDatePicker(page);
  await applyOrdersSearch(page);

  console.warn(
    `Sunze custom date range requested ${fromDate} to ${toDate}; input format ${result.attemptedFormat}; accepted values ${result.values.map(sanitizeDiagnosticText).join(' | ') || 'not visible'}.`
  );
};

const clickExportAndWaitForDownload = async (page, uiSummary) => {
  try {
    const downloadPromise = page.waitForEvent('download', { timeout: 45000 });
    const clicked =
      (await clickVisibleButton(page, /^export$/i)) ||
      (await page
        .getByText('Export', { exact: true })
        .click()
        .then(() => true)
        .catch(() => false));

    if (!clicked) {
      throw new Error('Unable to find a visible Sunze Orders Export control.');
    }

    return await downloadPromise;
  } catch (error) {
    const diagnostic = buildUiSummaryDiagnostic(await collectVisibleTexts(page));
    throw new Error(
      `Sunze Orders export did not start for ${uiSummary.uiWindowStart} to ${uiSummary.uiWindowEnd} (${uiSummary.uiRecordCount} visible records). Visible controls: ${diagnostic || 'none'}.`
    );
  }
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
  let succeeded = false;
  let downloadedFilePath = null;

  try {
    const baseUrl = await openOrdersPage(page);
    if (expectedCustomWindow) {
      await selectCustomDateRange(page, dateFrom, dateTo);
    } else {
      await selectDatePreset(page, datePreset);
    }
    const preExportUiSummary = await readOrdersUiSummary(page);
    console.warn(
      `Sunze Orders export preflight: ${preExportUiSummary.uiRecordCount} records for ${preExportUiSummary.uiWindowStart} to ${preExportUiSummary.uiWindowEnd}.`
    );

    const download = await clickExportAndWaitForDownload(page, preExportUiSummary);
    const filename = basename(await download.suggestedFilename());
    const filePath = join(downloadRoot, filename);
    await download.saveAs(filePath);
    downloadedFilePath = filePath;
    const postExportUiSummary = await readOrdersUiSummary(page);
    const visibleSunzeMachineCodes = await readVisibleSunzeMachineCodes(page, baseUrl);
    succeeded = true;

    return {
      filePath,
      uiSummaries: [preExportUiSummary, postExportUiSummary],
      visibleSunzeMachineCodes,
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
        : `Sunze ingest failed with HTTP ${response.status}`
    );
  }

  return responseBody;
};

let cleanupTarget = null;

try {
  const source = parseFilePath
    ? {
        filePath: resolve(parseFilePath),
        uiSummaries: [],
        visibleSunzeMachineCodes: [],
        cleanupPath: null,
        cleanupMode: null,
      }
    : await exportOrdersWorkbook();

  cleanupTarget = source.cleanupPath
    ? { path: source.cleanupPath, mode: source.cleanupMode }
    : null;
  const rows = await parseSunzeOrderWorkbook(source.filePath);
  const summary = summarizeSunzeOrderRows(rows);

  const matchedUiSummary =
    source.uiSummaries.length > 0 ? assertExportMatchesUi(summary, source.uiSummaries) : null;

  const payload = {
    source: 'sunze_browser',
    sourceReference: `sunze-orders:${expectedCustomWindow ? `${dateFrom}:${dateTo}` : datePreset}:${new Date().toISOString()}`,
    datePreset: expectedCustomWindow ? 'Custom Range' : datePreset,
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
      datePreset: expectedCustomWindow ? 'Custom Range' : datePreset,
      requestedWindowStart: dateFrom ?? null,
      requestedWindowEnd: dateTo ?? null,
      selectedWindowStart: matchedUiSummary?.uiWindowStart ?? null,
      selectedWindowEnd: matchedUiSummary?.uiWindowEnd ?? null,
      selectedWindowSource: matchedUiSummary?.uiWindowSource ?? null,
      selectedPreset: matchedUiSummary?.selectedPreset ?? null,
      reportingTimezone,
      uiRecordCount: matchedUiSummary?.uiRecordCount ?? null,
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
      ? await postIngestPayload({ ...payload, dryRun: true })
      : null;

    jsonLog({
      ok: true,
      dryRun: true,
      ingestDryRunValidated: Boolean(ingestValidation),
      rowsValidated: ingestValidation?.rowsValidated ?? null,
      rowsQuarantined: ingestValidation?.rowsQuarantined ?? null,
      rowsIgnored: ingestValidation?.rowsIgnored ?? null,
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
      uiRevenueCents: matchedUiSummary?.uiRevenueCents ?? null,
      visibleSunzeMachineCount: source.visibleSunzeMachineCodes.length,
      pendingUnmappedMachineCount: ingestValidation?.pendingUnmappedMachineCount ?? null,
      ignoredUnmappedMachineCount: ingestValidation?.ignoredUnmappedMachineCount ?? null,
      newlyPendingUnmappedMachineCount: ingestValidation?.newlyPendingUnmappedMachineCount ?? null,
      datePreset: expectedCustomWindow ? 'Custom Range' : datePreset,
    });
  } else {
    const result = await postIngestPayload(payload);
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
      visibleSunzeMachineCount: source.visibleSunzeMachineCodes.length,
      importRunId: result.importRunId ?? null,
      rowsImported: result.rowsImported ?? null,
      rowsSkipped: result.rowsSkipped ?? null,
      rowsQuarantined: result.rowsQuarantined ?? null,
      rowsIgnored: result.rowsIgnored ?? null,
      pendingUnmappedMachineCount: result.pendingUnmappedMachineCount ?? null,
    });
  }
} finally {
  if (cleanupTarget) {
    await rm(cleanupTarget.path, {
      recursive: cleanupTarget.mode === 'directory',
      force: true,
    });
  }
}
