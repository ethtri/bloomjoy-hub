import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(repoRoot, 'output', 'playwright', 'issue-656-657');
const fixedNowIso = '2026-07-22T16:00:00.000Z';
const fixedDateFrom = '2026-07-16';
const fixedDateTo = '2026-07-22';

const getArg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const appUrl = getArg('--app-url', 'http://127.0.0.1:8081');
const debug = process.env.REPORTING_UAT_DEBUG === '1';
const checks = [];
const browserErrors = [];
const startedAt = new Date().toISOString();
let runError = null;

const selectors = {
  operatorDateRange: '[data-reporting-operator-date-range]',
  operatorMoreFilters: '[data-reporting-operator-more-filters]',
  operatorAdvancedFilters: '[data-reporting-operator-advanced-filters]',
  operatorBreakdown: '[data-reporting-operator-breakdown]',
  operatorPayment: '[data-reporting-operator-payment]',
  operatorFilterSummary: '[data-reporting-operator-filter-summary]',
  operatorMetrics: '[data-reporting-operator-metrics]',
  operatorPeriodSummary: '[data-reporting-operator-period-summary]',
  operatorDailySales: '[data-reporting-operator-daily-sales]',
  operatorDailyRow: '[data-reporting-daily-row]',
  operatorFreshness: '[data-reporting-operator-freshness-state]',
  operatorDetailsToggle: '[data-reporting-operator-details-toggle]',
  operatorDetailsContent: '[data-reporting-operator-details-content]',
  partnerMachinePicker: '[data-reporting-partner-machine-picker]',
  partnerMachineRow: '[data-reporting-partner-machine-row]',
  partnerMachineAction: '[data-reporting-partner-machine-action]',
  partnerMachineScope: '[data-reporting-partner-machine-scope]',
  partnerBackAll: '[data-reporting-partner-back-all]',
  partnerMachineHistory: '[data-reporting-partner-machine-history]',
};

const personas = {
  operator: {
    id: '00000000-0000-4000-9000-000000000647',
    email: 'operator-report-uat@bloomjoy.localhost',
    isSuperAdmin: false,
    isScopedAdmin: false,
    isCorporatePartner: false,
    hasReportingAccess: true,
    portalAccessTier: 'plus',
    capabilities: [],
  },
  corporatePartner: {
    id: '00000000-0000-4000-9000-000000000648',
    email: 'partner-report-uat@bloomjoy.localhost',
    isSuperAdmin: false,
    isScopedAdmin: false,
    isCorporatePartner: true,
    hasReportingAccess: false,
    portalAccessTier: 'corporate_partner',
    capabilities: [
      'reports.partner.view',
      'training.view',
      'technicians.manage',
      'support.request',
      'supplies.member_discount',
    ],
  },
  baseline: {
    id: '00000000-0000-4000-9000-000000000649',
    email: 'baseline-report-uat@bloomjoy.localhost',
    isSuperAdmin: false,
    isScopedAdmin: false,
    isCorporatePartner: false,
    hasReportingAccess: false,
    portalAccessTier: 'baseline',
    capabilities: [],
  },
  superAdmin: {
    id: '00000000-0000-4000-9000-000000000650',
    email: 'super-admin-report-uat@bloomjoy.localhost',
    isSuperAdmin: true,
    isScopedAdmin: false,
    isCorporatePartner: false,
    hasReportingAccess: true,
    portalAccessTier: 'plus',
    capabilities: ['reports.partner.view'],
  },
};

const operatorDimensions = [
  {
    account_id: 'account-uat',
    account_name: 'Sanitized UAT Account',
    location_id: 'location-north',
    location_name: 'North Hall',
    machine_id: 'operator-machine-north',
    machine_label: 'North Atrium',
    machine_type: 'robotic_cotton_candy',
    sunze_machine_id: null,
    latest_sale_date: fixedDateTo,
    status: 'active',
  },
  {
    account_id: 'account-uat',
    account_name: 'Sanitized UAT Account',
    location_id: 'location-garden',
    location_name: 'Garden Hall',
    machine_id: 'operator-machine-garden',
    machine_label: 'Garden Annex',
    machine_type: 'robotic_cotton_candy',
    sunze_machine_id: null,
    latest_sale_date: fixedDateTo,
    status: 'active',
  },
];

const operatorFacts = [
  ['2026-07-16', 'operator-machine-north', 'credit', 10000, 0, 10],
  ['2026-07-16', 'operator-machine-garden', 'cash', 5000, 500, 5],
  ['2026-07-17', 'operator-machine-north', 'other', 8000, 0, 8],
  ['2026-07-18', 'operator-machine-garden', 'credit', 12000, 1000, 12],
  ['2026-07-20', 'operator-machine-north', 'cash', 7000, 0, 7],
  ['2026-07-21', 'operator-machine-garden', 'credit', 9000, 0, 9],
  ['2026-07-22', 'operator-machine-north', 'credit', 11000, 500, 11],
  ['2026-07-22', 'operator-machine-garden', 'other', 6000, 0, 6],
].map(([date, machineId, paymentMethod, netSalesCents, refundAmountCents, transactionCount]) => {
  const dimension = operatorDimensions.find((item) => item.machine_id === machineId);
  return {
    period_start: date,
    machine_id: machineId,
    machine_label: dimension.machine_label,
    location_id: dimension.location_id,
    location_name: dimension.location_name,
    payment_method: paymentMethod,
    net_sales_cents: netSalesCents,
    refund_amount_cents: refundAmountCents,
    gross_sales_cents: netSalesCents + refundAmountCents,
    transaction_count: transactionCount,
  };
});

const paymentLabels = {
  credit: 'Credit',
  cash: 'Cash',
  other: 'Other',
  unknown: 'Unknown',
};

const partnerMachines = [
  { id: 'partner-machine-harbor', label: 'Atrium Unit', location: 'Harbor Mall', baseGross: 40000 },
  { id: 'partner-machine-garden', label: 'Atrium Unit', location: 'Garden Plaza', baseGross: 25000 },
  { id: 'partner-machine-zero', label: 'Kiosk West', location: 'Pier Center', baseGross: 0 },
  { id: 'partner-machine-boardwalk', label: 'Arcade North', location: 'Boardwalk', baseGross: 10000 },
  { id: 'partner-machine-museum', label: 'Market Pod', location: 'City Museum', baseGross: 8000 },
  { id: 'partner-machine-airport', label: 'Atrium Annex', location: 'Airport Hall', baseGross: 6000 },
];

const weeklyFactors = new Map([
  ['2026-06-01', 0.55],
  ['2026-06-08', 0.62],
  ['2026-06-15', 0.7],
  ['2026-06-22', 0.78],
  ['2026-06-29', 0.86],
  ['2026-07-06', 0.93],
  ['2026-07-13', 1],
]);

const addUtcDays = (dateInput, days) => {
  const date = new Date(`${dateInput}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const makePartnerTotals = (machine, periodStart) => {
  const factor = weeklyFactors.get(periodStart) ?? 1;
  const grossSalesCents = Math.round(machine.baseGross * factor);
  const refundAmountCents = periodStart === '2026-07-13' && machine.id === 'partner-machine-harbor' ? 1000 : 0;
  const taxCents = Math.round(grossSalesCents * 0.05);
  const feeCents = Math.round(grossSalesCents * 0.025);
  const costCents = 0;
  const netSalesCents = grossSalesCents - refundAmountCents - taxCents - feeCents;
  const splitBaseCents = netSalesCents;
  const amountOwedCents = Math.round(splitBaseCents / 2);
  return {
    order_count: Math.round(grossSalesCents / 1000),
    item_quantity: Math.round(grossSalesCents / 1000) + (grossSalesCents > 0 && machine.id === 'partner-machine-harbor' ? 2 : 0),
    gross_sales_cents: grossSalesCents,
    refund_amount_cents: refundAmountCents,
    tax_cents: taxCents,
    fee_cents: feeCents,
    cost_cents: costCents,
    net_sales_cents: netSalesCents,
    split_base_cents: splitBaseCents,
    amount_owed_cents: amountOwedCents,
    bloomjoy_retained_cents: netSalesCents - amountOwedCents,
  };
};

const sumPartnerTotals = (records) => {
  const keys = [
    'order_count',
    'item_quantity',
    'gross_sales_cents',
    'refund_amount_cents',
    'tax_cents',
    'fee_cents',
    'cost_cents',
    'net_sales_cents',
    'split_base_cents',
    'amount_owed_cents',
    'bloomjoy_retained_cents',
  ];
  return records.reduce(
    (summary, record) => {
      keys.forEach((key) => {
        summary[key] += Number(record[key] ?? 0);
      });
      return summary;
    },
    Object.fromEntries(keys.map((key) => [key, 0])),
  );
};

const makePartnerPreview = (body) => {
  const dateFrom = String(body?.p_date_from ?? '2026-07-13');
  const dateTo = String(body?.p_date_to ?? '2026-07-19');
  const periodGrain = body?.p_period_grain === 'calendar_month' ? 'calendar_month' : 'reporting_week';
  let periodStarts;
  if (periodGrain === 'calendar_month') {
    periodStarts = [dateFrom];
  } else {
    periodStarts = [...weeklyFactors.keys()].filter((date) => date >= dateFrom && date <= dateTo);
    if (periodStarts.length === 0) periodStarts = [dateFrom];
  }

  const machinePeriods = periodStarts.flatMap((periodStart) => {
    const periodEnd = periodGrain === 'reporting_week' ? addUtcDays(periodStart, 6) : dateTo;
    return partnerMachines.map((machine) => ({
      period_start: periodStart,
      period_end: periodEnd,
      reporting_machine_id: machine.id,
      machine_label: machine.label,
      location_name: machine.location,
      ...makePartnerTotals(machine, periodStart),
    }));
  });
  const periods = periodStarts.map((periodStart) => {
    const periodEnd = periodGrain === 'reporting_week' ? addUtcDays(periodStart, 6) : dateTo;
    return {
      period_start: periodStart,
      period_end: periodEnd,
      ...sumPartnerTotals(machinePeriods.filter((record) => record.period_start === periodStart)),
    };
  });
  const selectedPeriod = periods.find((period) => period.period_start === dateFrom) ?? periods.at(-1);

  return {
    partnership_id: 'partnership-sanitized-uat',
    partnership_name: 'Demo Growth Partnership',
    period_grain: periodGrain,
    date_from: dateFrom,
    date_to: dateTo,
    summary: selectedPeriod ? sumPartnerTotals(machinePeriods.filter((record) => record.period_start === selectedPeriod.period_start)) : sumPartnerTotals([]),
    periods,
    machine_periods: machinePeriods,
    warnings: [
      {
        warning_type: 'reconciliation_note',
        severity: 'non_blocking',
        machine_id: 'partner-machine-harbor',
        machine_label: 'Atrium Unit',
        message: 'INTERNAL-ONLY fixture warning: upstream reconciliation ticket UAT-656-657.',
      },
    ],
  };
};

const startOfUtcWeek = (dateInput) => {
  const date = new Date(`${dateInput}T12:00:00.000Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
};

const startOfUtcMonth = (dateInput) => `${dateInput.slice(0, 7)}-01`;

const operatorReportResponse = (body) => {
  const dateFrom = String(body?.p_date_from ?? fixedDateFrom);
  const dateTo = String(body?.p_date_to ?? fixedDateTo);
  const grain = ['week', 'month'].includes(body?.p_grain) ? body.p_grain : 'day';
  const machineIds = Array.isArray(body?.p_machine_ids) ? body.p_machine_ids : [];
  const paymentMethods = Array.isArray(body?.p_payment_methods) ? body.p_payment_methods : [];
  const filtered = operatorFacts.filter(
    (row) =>
      row.period_start >= dateFrom &&
      row.period_start <= dateTo &&
      (machineIds.length === 0 || machineIds.includes(row.machine_id)) &&
      (paymentMethods.length === 0 || paymentMethods.includes(row.payment_method)),
  );
  const grouped = new Map();
  filtered.forEach((row) => {
    const periodStart = grain === 'week' ? startOfUtcWeek(row.period_start) : grain === 'month' ? startOfUtcMonth(row.period_start) : row.period_start;
    const key = `${periodStart}|${row.machine_id}|${row.payment_method}`;
    const current = grouped.get(key) ?? { ...row, period_start: periodStart, net_sales_cents: 0, refund_amount_cents: 0, gross_sales_cents: 0, transaction_count: 0 };
    current.net_sales_cents += row.net_sales_cents;
    current.refund_amount_cents += row.refund_amount_cents;
    current.gross_sales_cents += row.gross_sales_cents;
    current.transaction_count += row.transaction_count;
    grouped.set(key, current);
  });
  return [...grouped.values()].sort((left, right) => left.period_start.localeCompare(right.period_start));
};

const makeUser = (persona) => ({
  id: persona.id,
  aud: 'authenticated',
  role: 'authenticated',
  email: persona.email,
  email_confirmed_at: '2026-01-01T00:00:00.000Z',
  phone: '',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const makeSession = (persona) => ({
  access_token: `sanitized-uat-access-${persona.id}`,
  refresh_token: `sanitized-uat-refresh-${persona.id}`,
  expires_at: Math.floor(new Date(fixedNowIso).valueOf() / 1000) + 3600,
  expires_in: 3600,
  token_type: 'bearer',
  user: makeUser(persona),
});

const reportingAccessContext = (persona, freshness) => ({
  has_reporting_access: persona.hasReportingAccess,
  accessible_machine_count: persona.hasReportingAccess ? operatorDimensions.length : 0,
  accessible_location_count: persona.hasReportingAccess ? operatorDimensions.length : 0,
  can_manage_reporting: persona.isSuperAdmin,
  latest_sale_date: freshness === 'unavailable' ? null : freshness === 'stale' ? '2026-07-18' : fixedDateTo,
  latest_import_completed_at:
    freshness === 'unavailable'
      ? null
      : freshness === 'stale'
        ? '2026-07-18T18:00:00.000Z'
        : '2026-07-22T15:00:00.000Z',
});

const rpcResponse = (rpcName, persona, body, freshness) => {
  switch (rpcName) {
    case 'resolve_my_technician_entitlements':
      return {
        technicianEmail: persona.email,
        resolvedGrantCount: 0,
        resolvedOperatorTrainingGrantCount: 0,
        upsertedReportingEntitlementCount: 0,
        skippedGrantCount: 0,
      };
    case 'get_my_plus_access':
      return {
        has_plus_access: persona.isSuperAdmin,
        source: persona.isSuperAdmin ? 'subscription' : null,
        membership_status: persona.isSuperAdmin ? 'active' : 'none',
        current_period_end: null,
        cancel_at_period_end: false,
        paid_subscription_active: persona.isSuperAdmin,
        free_grant_id: null,
        free_grant_starts_at: null,
        free_grant_expires_at: null,
        free_grant_active: false,
      };
    case 'get_my_admin_access_context':
      return {
        isSuperAdmin: persona.isSuperAdmin,
        isScopedAdmin: persona.isScopedAdmin,
        canAccessAdmin: persona.isSuperAdmin || persona.isScopedAdmin,
        allowedSurfaces: persona.isSuperAdmin ? ['*'] : [],
        scopedMachineIds: [],
      };
    case 'get_my_portal_access_context':
      return {
        access_tier: persona.portalAccessTier,
        is_plus_member: persona.isSuperAdmin,
        is_training_operator: false,
        is_admin: persona.isSuperAdmin || persona.isScopedAdmin,
        can_manage_operator_training: persona.isSuperAdmin,
        is_corporate_partner: persona.isCorporatePartner,
        has_supply_discount: persona.isCorporatePartner || persona.isSuperAdmin,
        can_request_support: persona.isCorporatePartner || persona.isSuperAdmin,
        can_manage_technicians: persona.isCorporatePartner,
        capabilities: persona.capabilities,
        effective_presets: [],
      };
    case 'get_my_reporting_access_context':
      return reportingAccessContext(persona, freshness);
    case 'get_reporting_dimensions':
      return persona.hasReportingAccess ? operatorDimensions : [];
    case 'get_sales_report':
      return persona.hasReportingAccess ? operatorReportResponse(body) : [];
    case 'get_partner_dashboard_partnerships':
      return persona.isCorporatePartner || persona.isSuperAdmin
        ? {
            partnerships: [
              {
                id: 'partnership-sanitized-uat',
                name: 'Demo Growth Partnership',
                status: 'active',
                reporting_week_end_day: 0,
                timezone: 'America/Los_Angeles',
              },
            ],
          }
        : { partnerships: [] };
    case 'admin_preview_partner_period_report':
      return makePartnerPreview(body);
    case 'get_my_technician_management_context':
      return { canManage: persona.isCorporatePartner, seatCap: 10, accounts: [] };
    case 'get_my_operator_timekeeping_context':
      return { workDate: fixedDateTo, profiles: [] };
    case 'get_my_operator_pay_statement_context':
      return { profiles: [] };
    default:
      return {};
  }
};

const parsePostBody = (request) => {
  try {
    return request.postDataJSON() ?? {};
  } catch {
    return {};
  }
};

const createPageForPersona = async (
  browser,
  persona,
  viewport,
  { freshness = 'fresh' } = {},
) => {
  const context = await browser.newContext({ viewport });
  const session = makeSession(persona);
  const state = { operatorExports: [], partnerExports: [] };

  await context.addInitScript(
    ({ sessionValue, fixedNow, email }) => {
      const NativeDate = Date;
      const fixedTimestamp = new NativeDate(fixedNow).valueOf();
      class FixedDate extends NativeDate {
        constructor(...args) {
          super(...(args.length === 0 ? [fixedTimestamp] : args));
        }
        static now() {
          return fixedTimestamp;
        }
      }
      FixedDate.parse = NativeDate.parse;
      FixedDate.UTC = NativeDate.UTC;
      globalThis.Date = FixedDate;

      const serializedSession = JSON.stringify(sessionValue);
      const isSupabaseAuthKey = (key) => typeof key === 'string' && /^sb-.+-auth-token$/.test(key);
      const originalGetItem = Storage.prototype.getItem;
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.getItem = function getItem(key) {
        return isSupabaseAuthKey(key) ? serializedSession : originalGetItem.call(this, key);
      };
      Storage.prototype.setItem = function setItem(key, value) {
        return originalSetItem.call(this, key, isSupabaseAuthKey(key) ? serializedSession : value);
      };
      window.localStorage.setItem('bloomjoy.language.v1', 'en');
      window.localStorage.setItem(
        `bloomjoy-onboarding:${email.toLowerCase()}`,
        JSON.stringify({ completedStepIds: [] }),
      );
    },
    { sessionValue: session, fixedNow: fixedNowIso, email: persona.email },
  );

  await context.route('**/auth/v1/user', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makeUser(persona)) }),
  );
  await context.route('**/auth/v1/token**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) }),
  );
  await context.route('**/rest/v1/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/rest/v1/rpc/')) {
      const rpcName = decodeURIComponent(url.pathname.split('/').pop());
      const body = parsePostBody(route.request());
      if (debug) console.log(`[${persona.email}] rpc ${rpcName}`, body);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(rpcResponse(rpcName, persona, body, freshness)),
      });
    }
    if (debug) console.log(`[${persona.email}] rest ${route.request().method()} ${url.pathname}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await context.route('**/functions/v1/**', (route) => {
    const functionName = new URL(route.request().url()).pathname.split('/').pop();
    const body = parsePostBody(route.request());
    if (functionName === 'sales-report-export') {
      state.operatorExports.push(body);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          snapshotId: 'operator-export-uat',
          storagePath: 'sanitized/operator-report.pdf',
          signedUrl: `${appUrl}/uat-export/operator-report.pdf`,
          pdfGeneratorVersion: 'sales-report-pdf/polished-v1',
          rowCount: operatorReportResponse(body.filters).length,
        }),
      });
    }
    if (functionName === 'partner-report-export') {
      state.partnerExports.push(body);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          snapshotId: 'partner-export-uat',
          storagePath: 'sanitized/partner-report.csv',
          signedUrl: `${appUrl}/uat-export/partner-report.csv`,
          format: body.format ?? 'csv',
          fileName: 'sanitized-partner-report.csv',
          periodGrain: body.periodGrain ?? 'reporting_week',
          periodMode: body.periodMode ?? 'weekly',
          periodStartDate: body.dateFrom,
          periodEndDate: body.dateTo,
          machineScopeLabel: Array.isArray(body.machineIds) && body.machineIds.length ? 'Selected machine' : 'All machines',
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
  await context.route('**/uat-export/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'Sanitized UAT export placeholder.' }),
  );

  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const value = `[${persona.email}] console error: ${message.text()}`;
      browserErrors.push(value);
      if (debug) console.error(value);
    }
  });
  page.on('pageerror', (error) => browserErrors.push(`[${persona.email}] page error: ${error.message}`));
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') {
      browserErrors.push(`[${persona.email}] request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`);
    }
  });
  return { page, context, state };
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const check = async (name, task) => {
  try {
    await task();
    checks.push({ name, status: 'pass' });
  } catch (error) {
    checks.push({ name, status: 'fail', detail: error instanceof Error ? error.message : String(error) });
    throw error;
  }
};

const textOf = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ').trim();

const waitForReport = async (page) => {
  await page.getByRole('heading', { name: 'Reporting', level: 1 }).waitFor();
};

const visibleLocator = async (locator, description) => {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) return candidate;
  }
  throw new Error(`${description} is not visible.`);
};

const assertNoHorizontalOverflow = async (page, label) => {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  if (dimensions.documentWidth > dimensions.viewportWidth + 1) {
    const offenders = await page.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName.toLowerCase(),
            className: typeof element.className === 'string' ? element.className : '',
            text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            overflowX: getComputedStyle(element).overflowX,
          };
        })
        .filter((item) => item.right > document.documentElement.clientWidth + 1)
        .sort((left, right) => right.right - left.right)
        .slice(0, 30),
    );
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    fs.writeFileSync(
      path.join(outputDir, `${slug}-overflow.json`),
      `${JSON.stringify({ dimensions, offenders }, null, 2)}\n`,
    );
    await page.screenshot({ path: path.join(outputDir, `${slug}-overflow.png`), fullPage: true });
  }
  assert(
    dimensions.documentWidth <= dimensions.viewportWidth + 1,
    `${label} overflows horizontally (${dimensions.documentWidth}px > ${dimensions.viewportWidth}px).`,
  );
};

const assertTouchTarget = async (locator, label) => {
  const box = await locator.boundingBox();
  assert(box && box.width >= 36 && box.height >= 36, `${label} must be at least 36px in both dimensions.`);
};

const selectRadixOption = async (trigger, optionName) => {
  await trigger.click();
  const option = trigger.page().getByRole('option', { name: optionName, exact: true });
  await option.waitFor();
  await option.click();
};

const findOperatorMachineTrigger = async (page) => {
  const labels = page.getByText('Machine', { exact: true });
  const count = await labels.count();
  for (let index = 0; index < count; index += 1) {
    const wrapper = labels.nth(index).locator('..');
    const trigger = wrapper.getByRole('combobox');
    if ((await trigger.count()) > 0 && (await trigger.first().isVisible())) return trigger.first();
  }
  throw new Error('Operator machine filter is not visible.');
};

const ensureMoreFiltersOpen = async (page) => {
  const advancedFilters = page.locator(selectors.operatorAdvancedFilters);
  if (!(await advancedFilters.isVisible())) {
    await page.locator(selectors.operatorMoreFilters).click();
  }
  await advancedFilters.waitFor();
};

const selectOperatorPayment = async (page, paymentName) => {
  await ensureMoreFiltersOpen(page);
  await page.locator(selectors.operatorPayment).click();
  const option = page.getByRole('menuitemcheckbox', { name: paymentName, exact: true });
  await option.waitFor();
  await option.click();
  await page.keyboard.press('Escape');
};

const openDetailedBreakdown = async (page) => {
  const content = page.locator(selectors.operatorDetailsContent);
  if (!(await content.isVisible())) {
    await page.locator(selectors.operatorDetailsToggle).click();
  }
  await content.waitFor();
};

const expectCurrency = async (locator, currency, label) => {
  await locator.getByText(currency, { exact: true }).first().waitFor();
  const text = await textOf(locator);
  assert(text.includes(currency), `${label} must include ${currency}. Found: ${text}`);
};

const chooseLastSevenDaily = async (page) => {
  const dateRange = page.locator(selectors.operatorDateRange);
  try {
    await dateRange.waitFor();
  } catch (error) {
    fs.writeFileSync(
      path.join(outputDir, 'operator-controls-debug.txt'),
      `${await page.locator('body').innerText()}\n`,
    );
    await page.screenshot({
      path: path.join(outputDir, 'operator-controls-debug.png'),
      fullPage: true,
    });
    throw error;
  }
  await selectRadixOption(dateRange, 'Last 7 days');
  await ensureMoreFiltersOpen(page);
  const breakdown = page.locator(selectors.operatorBreakdown);
  await breakdown.waitFor();
  const daily = breakdown.getByRole('radio', { name: 'Daily', exact: true });
  await daily.click();
  await visibleLocator(
    page.locator(`${selectors.operatorDailyRow}[data-date="2026-07-19"]`),
    'Operator daily row 2026-07-19',
  );
};

const assertOperatorDailyReconciliation = async (page) => {
  const metrics = page.locator(selectors.operatorMetrics);
  await metrics.waitFor();
  const metricsText = await textOf(metrics);
  for (const [label, expected] of [
    ['net sales', '$680.00'],
    ['gross sales', '$700.00'],
    ['refund impact', '$20.00'],
  ]) {
    assert(metricsText.toLowerCase().includes(label) && metricsText.includes(expected), `Operator ${label} KPI must reconcile to ${expected}. Found: ${metricsText}`);
  }
  assert(/Transactions\s+68\b/i.test(metricsText), `Operator Transactions KPI must reconcile to 68. Found: ${metricsText}`);

  const dailySection = page.locator(selectors.operatorDailySales);
  await dailySection.waitFor();
  const expectedDays = new Map([
    ['2026-07-16', ['$150.00', '$155.00', '$5.00', '15']],
    ['2026-07-17', ['$80.00', '$80.00', '$0.00', '8']],
    ['2026-07-18', ['$120.00', '$130.00', '$10.00', '12']],
    ['2026-07-19', ['$0.00', '0']],
    ['2026-07-20', ['$70.00', '$70.00', '$0.00', '7']],
    ['2026-07-21', ['$90.00', '$90.00', '$0.00', '9']],
    ['2026-07-22', ['$170.00', '$175.00', '$5.00', '17']],
  ]);
  for (const [date, expectedValues] of expectedDays) {
    const row = await visibleLocator(
      page.locator(`${selectors.operatorDailyRow}[data-date="${date}"]`),
      `Operator daily row ${date}`,
    );
    const rowText = await textOf(row);
    expectedValues.forEach((value) => assert(rowText.includes(value), `Daily row ${date} must include ${value}. Found: ${rowText}`));
    if (date === '2026-07-19') {
      assert(/no sales|zero sales/i.test(rowText), `Zero-sales date ${date} must be explicitly labeled as no sales. Found: ${rowText}`);
      assert(!/stale|unavailable|missing import/i.test(rowText), `Zero-sales date ${date} must not be labeled stale or unavailable.`);
    }
  }

  await openDetailedBreakdown(page);
  const detailedBreakdown = page.locator('[data-reporting-operator-detailed-breakdown]');
  const detailText = await textOf(detailedBreakdown);
  for (const row of operatorFacts) {
    assert(detailText.includes(row.machine_label), `Detailed report must include ${row.machine_label}.`);
    assert(detailText.includes(paymentLabels[row.payment_method]), `Detailed report must include ${paymentLabels[row.payment_method]}.`);
    assert(detailText.includes(`$${(row.net_sales_cents / 100).toFixed(2)}`), `Detailed report must include $${(row.net_sales_cents / 100).toFixed(2)} net sales.`);
    assert(detailText.includes(`$${(row.gross_sales_cents / 100).toFixed(2)}`), `Detailed report must include $${(row.gross_sales_cents / 100).toFixed(2)} gross sales.`);
  }
};

const assertVisibleDetailedTotals = async (page, label) => {
  await openDetailedBreakdown(page);
  const rows = page.locator(`${selectors.operatorDetailsContent} table:visible tbody tr`);
  const totals = {
    netSalesCents: 0,
    grossSalesCents: 0,
    refundAmountCents: 0,
    transactionCount: 0,
  };
  for (let index = 0; index < (await rows.count()); index += 1) {
    const cells = rows.nth(index).locator('td');
    const currencyToCents = (value) =>
      Math.round(Number(value.replace(/[^0-9.-]/g, '')) * 100);
    totals.netSalesCents += currencyToCents(await cells.nth(3).innerText());
    totals.grossSalesCents += currencyToCents(await cells.nth(4).innerText());
    totals.refundAmountCents += currencyToCents(await cells.nth(5).innerText());
    totals.transactionCount += Number((await cells.nth(6).innerText()).replace(/[^0-9-]/g, ''));
  }
  assert(
    JSON.stringify(totals) ===
      JSON.stringify({
        netSalesCents: 68000,
        grossSalesCents: 70000,
        refundAmountCents: 2000,
        transactionCount: 68,
      }),
    `${label} detailed rows must reconcile exactly. Found: ${JSON.stringify(totals)}`,
  );
};

const assertFreshnessState = async (page, state) => {
  const treatment = page.locator(`${selectors.operatorFreshness}[data-reporting-operator-freshness-state="${state}"]`);
  await treatment.waitFor();
  const text = await textOf(treatment);
  const dailySectionText = await textOf(page.locator(selectors.operatorDailySales));
  if (state === 'fresh') {
    assert(/current|fresh|through|updated|last import/i.test(text), `Fresh state must explain report coverage. Found: ${text}`);
  } else if (state === 'stale') {
    assert(
      /stale|delayed|extends beyond|predates/i.test(`${text} ${dailySectionText}`),
      `Stale state must explain delayed coverage. Found: ${dailySectionText}`,
    );
  } else {
    assert(
      /unavailable|not available|missing/i.test(`${text} ${dailySectionText}`),
      `Unavailable state must explain missing import metadata. Found: ${dailySectionText}`,
    );
  }
};

const waitForRecordedRequest = async (page, records, label) => {
  for (let attempt = 0; attempt < 100 && records.length === 0; attempt += 1) {
    await page.waitForTimeout(50);
  }
  assert(records.length === 1, `${label} must be intercepted exactly once.`);
};

const settleScreenshotViewport = async (page, toastPattern) => {
  if (toastPattern) {
    await page
      .getByText(toastPattern)
      .last()
      .waitFor({ state: 'hidden', timeout: 7000 })
      .catch(() => undefined);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
              }
              window.scrollTo(0, 0);
              document.documentElement.scrollTop = 0;
              document.body.scrollTop = 0;
              resolve(undefined);
            });
          });
        }),
    );
    await page.waitForTimeout(100);
    if ((await page.evaluate(() => window.scrollY)) === 0) return;
  }
  const scrollY = await page.evaluate(() => window.scrollY);
  assert(
    scrollY <= 600,
    `Screenshot viewport must settle near the top of the page. Found scrollY=${scrollY}.`,
  );
};

const assertOperatorDesktop = async (browser) => {
  const { page, context, state } = await createPageForPersona(
    browser,
    personas.operator,
    { width: 1366, height: 900 },
  );
  try {
    await page.goto(`${appUrl}/portal/reports`, { waitUntil: 'networkidle' });
    await waitForReport(page);
    await check('Operator-only reporting user cannot see partner controls or revenue-share data', async () => {
      assert(
        (await page.getByRole('radio', { name: /partner dashboard/i }).count()) === 0,
        'Operator-only reporting must not expose the partner dashboard toggle.',
      );
      assert(
        (await page.locator(selectors.partnerMachineRow).count()) === 0,
        'Operator-only reporting must not expose partner machine rows.',
      );
      const bodyText = await textOf(page.locator('body'));
      assert(
        !/Partner Revenue Share/i.test(bodyText),
        'Operator-only reporting must not expose partner revenue-share data.',
      );
    });
    await check('Operator default toolbar keeps advanced and custom controls out of the primary path', async () => {
      const dateRange = page.locator(selectors.operatorDateRange);
      const machine = await findOperatorMachineTrigger(page);
      const moreFilters = page.locator(selectors.operatorMoreFilters);
      await dateRange.waitFor();
      await machine.waitFor();
      await moreFilters.waitFor();
      assert((await textOf(dateRange)).includes('Last 7 days'), 'Last 7 days must be the default date range.');
      assert((await page.locator(selectors.operatorAdvancedFilters).count()) === 0, 'Advanced filters must be collapsed by default.');
      assert((await page.locator('[data-reporting-operator-custom-date-range]').count()) === 0, 'Custom dates must be hidden by default.');
      assert(!(await page.locator(selectors.operatorDetailsContent).isVisible()), 'Detailed breakdown must be collapsed by default.');
      const filterSummary = await textOf(page.locator(selectors.operatorFilterSummary));
      for (const expected of ['Last 7 days', 'Daily', 'All machines', 'All payments']) {
        assert(filterSummary.includes(expected), `Default filter summary must include ${expected}. Found: ${filterSummary}`);
      }
      for (const [locator, label] of [
        [dateRange, 'Operator date range'],
        [machine, 'Operator machine'],
        [moreFilters, 'Operator More filters'],
      ]) {
        await assertTouchTarget(locator, `${label} control`);
      }
    });
    await settleScreenshotViewport(page);
    await page.screenshot({ path: path.join(outputDir, 'operator-filter-default-desktop.png'), fullPage: true });

    await check('Operator date-range control keeps all presets and reveals dates only for Custom', async () => {
      const dateRange = page.locator(selectors.operatorDateRange);
      await dateRange.click();
      for (const label of ['Today', 'Last 7 days', 'This week', 'Last week', 'Last 30 days', 'Month to date', 'Custom']) {
        await page.getByRole('option', { name: label, exact: true }).waitFor();
      }
      await page.keyboard.press('Escape');
      await selectRadixOption(dateRange, 'Custom');
      const customDates = page.locator('[data-reporting-operator-custom-date-range]');
      await customDates.waitFor();
      assert((await customDates.locator('input[type="date"]').count()) === 2, 'Custom must reveal exactly two date inputs.');
      await settleScreenshotViewport(page);
      await page.screenshot({ path: path.join(outputDir, 'operator-custom-date-desktop.png'), fullPage: true });
      await selectRadixOption(dateRange, 'Last 7 days');
      assert((await page.locator('[data-reporting-operator-custom-date-range]').count()) === 0, 'Leaving Custom must hide date inputs.');
    });

    await check('Operator More filters contains visible Daily/Weekly/Monthly and one payment selector', async () => {
      await chooseLastSevenDaily(page);
      const breakdown = page.locator(selectors.operatorBreakdown);
      for (const label of ['Daily', 'Weekly', 'Monthly']) {
        const button = breakdown.getByRole('radio', { name: label, exact: true });
        await button.waitFor();
        await assertTouchTarget(button, `Operator ${label} breakdown button`);
      }
      const payment = page.locator(selectors.operatorPayment);
      await payment.waitFor();
      assert((await textOf(payment)).includes('All payments'), 'Payment control must summarize its default as All payments.');
      await assertTouchTarget(payment, 'Operator payment selector');
    });
    await settleScreenshotViewport(page);
    await page.screenshot({ path: path.join(outputDir, 'operator-filter-more-desktop.png'), fullPage: true });
    await page.locator(selectors.operatorPayment).click();
    for (const label of ['Cash', 'Credit', 'Other', 'Unknown']) {
      await page.getByRole('menuitemcheckbox', { name: label, exact: true }).waitFor();
    }
    await page.screenshot({ path: path.join(outputDir, 'operator-payment-menu-desktop.png'), fullPage: true });
    await page.keyboard.press('Escape');

    await check('Operator KPIs, daily totals, and detail rows reconcile exactly', () => assertOperatorDailyReconciliation(page));
    await settleScreenshotViewport(page);
    await page.screenshot({ path: path.join(outputDir, 'operator-detail-expanded-desktop.png'), fullPage: true });

    await check('Operator fresh status is separate from a loaded zero-sales date', async () => {
      await assertFreshnessState(page, 'fresh');
      const zeroRow = await visibleLocator(
        page.locator(`${selectors.operatorDailyRow}[data-date="2026-07-19"]`),
        'Operator zero-sales row',
      );
      assert(/no sales|zero sales/i.test(await textOf(zeroRow)), 'Loaded zero-sales row must remain explicitly labeled.');
    });
    await check('Operator breakdown control supports keyboard focus movement', async () => {
      const group = page.locator(selectors.operatorBreakdown);
      const daily = group.getByRole('radio', { name: 'Daily', exact: true });
      const weekly = group.getByRole('radio', { name: 'Weekly', exact: true });
      await daily.focus();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await daily.press('ArrowRight');
        await page.waitForTimeout(50);
        if (await weekly.evaluate((element) => element === document.activeElement)) break;
        await daily.focus();
      }
      assert(await weekly.evaluate((element) => element === document.activeElement), 'ArrowRight from Daily must move focus to Weekly.');
      await daily.click();
    });
    await check('Operator summary changes to weekly grouping while retaining reconciled totals', async () => {
      const detailsContent = page.locator(selectors.operatorDetailsContent);
      if (await detailsContent.isVisible()) {
        await page.locator(selectors.operatorDetailsToggle).click();
      }
      const breakdown = page.locator(selectors.operatorBreakdown);
      await breakdown.getByRole('radio', { name: 'Weekly', exact: true }).click();
      await page.getByRole('heading', { name: 'Sales by week', exact: true }).waitFor();
      const summaryRows = page.locator(`${selectors.operatorPeriodSummary} [data-reporting-period-row]:visible`);
      assert((await summaryRows.count()) === 2, `Weekly summary must show two weekly periods. Found ${await summaryRows.count()}.`);
      const weeklySummaryText = await textOf(page.locator(selectors.operatorPeriodSummary));
      assert(
        weeklySummaryText.includes('Jul 16 - Jul 19') &&
          weeklySummaryText.includes('Jul 20 - Jul 22') &&
          !weeklySummaryText.includes('Jul 13') &&
          !weeklySummaryText.includes('Jul 26'),
        `Partial weekly labels must stay inside the selected date range. Found: ${weeklySummaryText}`,
      );
      const metricsText = await textOf(page.locator(selectors.operatorMetrics));
      assert(metricsText.includes('$680.00') && metricsText.includes('$700.00'), 'Weekly grouping must preserve reconciled totals.');
      await settleScreenshotViewport(page);
      await page.screenshot({ path: path.join(outputDir, 'operator-weekly-summary-desktop.png'), fullPage: true });
      await assertVisibleDetailedTotals(page, 'Weekly');
      await page.locator(selectors.operatorDetailsToggle).click();

      await breakdown.getByRole('radio', { name: 'Monthly', exact: true }).click();
      await page.getByRole('heading', { name: 'Sales by month', exact: true }).waitFor();
      const monthlyRows = page.locator(`${selectors.operatorPeriodSummary} [data-reporting-period-row]:visible`);
      assert((await monthlyRows.count()) === 1, `Monthly summary must show one selected-period row. Found ${await monthlyRows.count()}.`);
      const monthlySummaryText = await textOf(page.locator(selectors.operatorPeriodSummary));
      assert(
        monthlySummaryText.includes('Jul 16 - Jul 22') &&
          !monthlySummaryText.includes('Jul 1 - Jul 31'),
        `Partial monthly labels must stay inside the selected date range. Found: ${monthlySummaryText}`,
      );
      await assertVisibleDetailedTotals(page, 'Monthly');
      await page.locator(selectors.operatorDetailsToggle).click();

      await breakdown.getByRole('radio', { name: 'Daily', exact: true }).click();
      await page.getByRole('heading', { name: 'Sales by day', exact: true }).waitFor();
    });
    await check('Operator machine and payment filters scope every total and export', async () => {
      const machineTrigger = await findOperatorMachineTrigger(page);
      await selectRadixOption(machineTrigger, 'North Atrium');
      await selectOperatorPayment(page, 'Credit');
      const metrics = page.locator(selectors.operatorMetrics);
      await expectCurrency(metrics, '$210.00', 'Filtered operator net KPI');
      await expectCurrency(metrics, '$215.00', 'Filtered operator gross KPI');
      await expectCurrency(metrics, '$5.00', 'Filtered operator refund KPI');
      const metricsText = await textOf(metrics);
      assert(/Transactions\s+21\b/i.test(metricsText), `Filtered Transactions KPI must be 21. Found: ${metricsText}`);
      const filteredDaily = await textOf(page.locator(selectors.operatorDailySales));
      assert(filteredDaily.includes('$100.00') && filteredDaily.includes('$110.00'), 'Filtered daily totals must include only North Atrium credit-card sales.');
      assert(!filteredDaily.includes('$170.00'), 'Filtered daily totals must not retain all-machine sales.');

      const exportButton = page.locator('[data-portal-report-export="operator-pdf"]');
      await exportButton.click();
      await page.waitForFunction(() => document.body.innerText.includes('Reporting'));
      await waitForRecordedRequest(page, state.operatorExports, 'Operator export request');
      const exportedFilters = state.operatorExports[0].filters;
      assert(exportedFilters.dateFrom === fixedDateFrom && exportedFilters.dateTo === fixedDateTo, 'Operator export must retain the Last 7 days date window.');
      assert(exportedFilters.grain === 'day', 'Operator export must retain Daily breakdown.');
      assert(JSON.stringify(exportedFilters.machineIds) === JSON.stringify(['operator-machine-north']), 'Operator export must retain selected machine scope.');
      assert(JSON.stringify(exportedFilters.paymentMethods) === JSON.stringify(['credit']), 'Operator export must retain selected payment scope.');
    });
    await check('Operator desktop has no horizontal overflow', () => assertNoHorizontalOverflow(page, 'Operator desktop'));

    await page.locator('[data-reporting-operator-reset]').click();
    await visibleLocator(
      page.locator(`${selectors.operatorDailyRow}[data-date="2026-07-19"]`),
      'Operator daily row 2026-07-19 after clearing filters',
    );
  } finally {
    await context.close();
  }
};

const assertOperatorMobile = async (browser) => {
  const { page, context } = await createPageForPersona(browser, personas.operator, { width: 390, height: 844 });
  try {
    await page.goto(`${appUrl}/portal/reports`, { waitUntil: 'networkidle' });
    await waitForReport(page);
    await check('Operator mobile defaults to compact filters and collapsed detail', async () => {
      await page.locator(selectors.operatorDateRange).waitFor();
      await page.locator(selectors.operatorMoreFilters).waitFor();
      assert((await page.locator(selectors.operatorAdvancedFilters).count()) === 0, 'Mobile advanced filters must be collapsed by default.');
      assert(!(await page.locator(selectors.operatorDetailsContent).isVisible()), 'Mobile detailed breakdown must be collapsed by default.');
      await assertTouchTarget(page.locator(selectors.operatorDateRange), 'Operator mobile date range');
      await assertTouchTarget(page.locator(selectors.operatorMoreFilters), 'Operator mobile More filters');
    });
    await settleScreenshotViewport(page);
    await page.screenshot({ path: path.join(outputDir, 'operator-filter-default-mobile-390.png'), fullPage: true });

    await chooseLastSevenDaily(page);
    await settleScreenshotViewport(page);
    await page.screenshot({ path: path.join(outputDir, 'operator-filter-more-mobile-390.png'), fullPage: true });
    await check('Operator mobile preserves exact daily reconciliation', () => assertOperatorDailyReconciliation(page));
    await page.locator(selectors.operatorMoreFilters).click();
    await settleScreenshotViewport(page);
    await page.screenshot({ path: path.join(outputDir, 'operator-detail-expanded-mobile-390.png'), fullPage: true });
    await check('Operator mobile is usable at 390px without horizontal overflow', async () => {
      await assertNoHorizontalOverflow(page, 'Operator mobile');
      await assertTouchTarget(page.locator(selectors.operatorDetailsToggle), 'Operator mobile detail control');
    });
  } finally {
    await context.close();
  }
};

const assertOperatorFreshnessVariants = async (browser) => {
  for (const freshness of ['stale', 'unavailable']) {
    const { page, context } = await createPageForPersona(
      browser,
      personas.operator,
      { width: 1366, height: 900 },
      { freshness },
    );
    try {
      await page.goto(`${appUrl}/portal/reports`, { waitUntil: 'networkidle' });
      await waitForReport(page);
      await chooseLastSevenDaily(page);
      await page.locator(selectors.operatorMoreFilters).click();
      await check(`Operator ${freshness} import state remains distinct from loaded zero sales`, async () => {
        await assertFreshnessState(page, freshness);
        const dailySection = page.locator(selectors.operatorDailySales);
        await dailySection.waitFor();
        const zeroRow = await visibleLocator(
          page.locator(`${selectors.operatorDailyRow}[data-date="2026-07-19"]`),
          `Operator ${freshness} zero-sales row`,
        );
        const zeroText = await textOf(zeroRow);
        assert(/no sales|zero sales/i.test(zeroText), `${freshness} state must preserve the loaded no-sales date.`);
        assert(!new RegExp(freshness, 'i').test(zeroText), `${freshness} state must be presented above the daily rows, not on the zero-sales row.`);
      });
      if (freshness === 'stale') {
        await page.screenshot({ path: path.join(outputDir, 'operator-zero-sales-stale-desktop.png'), fullPage: true });
      }
    } finally {
      await context.close();
    }
  }
};

const visibleMachineLocator = async (page, selector, machineId, description) =>
  visibleLocator(page.locator(`${selector}[data-machine-id="${machineId}"]`), description);

const assertPartnerAllMachines = async (page) => {
  for (const machine of partnerMachines) {
    const row = await visibleMachineLocator(page, selectors.partnerMachineRow, machine.id, `Partner row for ${machine.label} at ${machine.location}`);
    const rowText = await textOf(row);
    assert(rowText.includes(machine.label), `Partner row must identify ${machine.label}.`);
    assert(rowText.includes(machine.location), `Partner row must show ${machine.location}. Found: ${rowText}`);
    const action = await visibleMachineLocator(page, selectors.partnerMachineAction, machine.id, `View action for ${machine.label} at ${machine.location}`);
    assert(/view|details|machine/i.test(await textOf(action)), `Machine action must be explicit for ${machine.label}.`);
  }
  const zeroRow = await visibleMachineLocator(page, selectors.partnerMachineRow, 'partner-machine-zero', 'Zero-sales partner machine row');
  assert((await textOf(zeroRow)).includes('$0.00'), 'Assigned zero-sales machine must remain visible with $0.00.');

  const harbor = await visibleMachineLocator(page, selectors.partnerMachineRow, 'partner-machine-harbor', 'Harbor duplicate-name row');
  const garden = await visibleMachineLocator(page, selectors.partnerMachineRow, 'partner-machine-garden', 'Garden duplicate-name row');
  assert((await textOf(harbor)).includes('Harbor Mall'), 'First duplicate machine label must be distinguished by Harbor Mall.');
  assert((await textOf(garden)).includes('Garden Plaza'), 'Second duplicate machine label must be distinguished by Garden Plaza.');
};

const searchForPartnerMachine = async (page, query, optionPattern) => {
  const picker = page.locator(selectors.partnerMachinePicker);
  const trigger = await visibleLocator(picker, 'Partner machine picker trigger');
  await trigger.click();
  const search = page
    .getByRole('combobox', { name: /search machine or location/i })
    .or(page.getByPlaceholder(/search machine or location/i));
  const input = await visibleLocator(search, 'Partner machine search input');
  await input.fill(query);
  const option = page.getByRole('option', { name: optionPattern }).or(page.getByRole('button', { name: optionPattern }));
  const visibleOption = await visibleLocator(option, `Partner machine search result ${String(optionPattern)}`);
  await visibleOption.click();
};

const assertSelectedPartnerMachine = async (page, machine) => {
  const scope = page.locator(selectors.partnerMachineScope);
  await scope.waitFor();
  const scopeText = await textOf(scope);
  assert(scopeText.includes('Demo Growth Partnership'), 'Selected-machine scope must include the partnership breadcrumb.');
  assert(scopeText.includes(machine.label) && scopeText.includes(machine.location), `Selected-machine scope must include ${machine.label} and ${machine.location}. Found: ${scopeText}`);
  await page.locator(selectors.partnerBackAll).waitFor();
  const history = page.locator(selectors.partnerMachineHistory);
  await history.waitFor();
  const historyText = await textOf(history);
  assert(historyText.includes(machine.label), `Machine history must identify ${machine.label}.`);
  if (machine.baseGross === 0) {
    assert(historyText.includes('$0.00'), 'Zero-sales selected machine must retain a visible zero-valued history.');
  } else {
    const current = makePartnerTotals(machine, '2026-07-13');
    for (const cents of [current.gross_sales_cents, current.net_sales_cents, current.amount_owed_cents]) {
      const expected = `$${(cents / 100).toFixed(2)}`;
      assert(historyText.includes(expected), `Selected-machine history must include ${expected}. Found: ${historyText}`);
    }
  }
  const bodyText = await textOf(page.locator('body'));
  assert(bodyText.includes('Calculation'), 'Selected-machine view must keep the calculation detail.');
};

const assertPartnerDesktop = async (browser) => {
  const { page, context, state } = await createPageForPersona(
    browser,
    personas.corporatePartner,
    { width: 1366, height: 900 },
  );
  try {
    await page.goto(`${appUrl}/portal/reports`, { waitUntil: 'networkidle' });
    await waitForReport(page);
    await page.getByRole('heading', { name: 'Partner performance summary' }).waitFor();
    await check('Partner all-machines view shows six actions, locations, duplicate-name context, and zero sales', () => assertPartnerAllMachines(page));
    await check('Partner machine picker becomes searchable at the six-machine threshold', async () => {
      await searchForPartnerMachine(page, 'Garden Plaza', /Atrium Unit.*Garden Plaza|Garden Plaza.*Atrium Unit/i);
      await assertSelectedPartnerMachine(page, partnerMachines[1]);
      await page.locator(selectors.partnerBackAll).click();
      await visibleMachineLocator(page, selectors.partnerMachineAction, 'partner-machine-harbor', 'Returned all-machines action');
    });
    await settleScreenshotViewport(page);
    await page.screenshot({ path: path.join(outputDir, 'partner-all-machines-desktop.png'), fullPage: true });

    await check('Partner row action supports keyboard selection and a persistent selected scope', async () => {
      const action = await visibleMachineLocator(page, selectors.partnerMachineAction, 'partner-machine-harbor', 'Harbor machine action');
      await action.focus();
      assert(await action.evaluate((element) => element === document.activeElement), 'Partner machine action must accept keyboard focus.');
      await action.press('Enter');
      await assertSelectedPartnerMachine(page, partnerMachines[0]);
      const scope = page.locator(selectors.partnerMachineScope);
      assert((await scope.evaluate((element) => getComputedStyle(element).position)) === 'sticky', 'Selected-machine scope must use sticky positioning.');
      await page.evaluate(() => window.scrollTo(0, Math.round(document.documentElement.scrollHeight * 0.6)));
      await page.waitForTimeout(100);
      const box = await scope.boundingBox();
      assert(box && box.y >= 0 && box.y < 900, 'Selected-machine scope must remain visible while scrolling.');
      await page.evaluate(() => window.scrollTo(0, 0));
    });
    await check('Corporate Partner hides non-blocking internal notes without false review messaging', async () => {
      const bodyText = await textOf(page.locator('body'));
      for (const forbidden of [
        'Bloomjoy review in progress',
        'Bloomjoy is reviewing',
        'Report data incomplete',
        'Export is unavailable because required report data is incomplete',
        'INTERNAL-ONLY',
        'UAT-656-657',
        'Open admin setup',
        'Report setup needs attention',
      ]) {
        assert(!bodyText.includes(forbidden), `Corporate Partner view must not expose internal-only text: ${forbidden}`);
      }
    });
    await check('Partner selected-machine KPIs, history, and export retain machine scope', async () => {
      const current = makePartnerTotals(partnerMachines[0], '2026-07-13');
      const bodyText = await textOf(page.locator('body'));
      for (const cents of [current.gross_sales_cents, current.net_sales_cents, current.amount_owed_cents]) {
        const expected = `$${(cents / 100).toFixed(2)}`;
        assert(bodyText.includes(expected), `Selected Partner KPI/history/calculation must include ${expected}.`);
      }
      const exportButton = page.locator('[data-portal-report-export="partner"]');
      await exportButton.click();
      const csvOption = page.getByRole('menuitem', { name: /CSV reconciliation/i });
      await csvOption.click();
      await waitForRecordedRequest(page, state.partnerExports, 'Partner export request');
      const payload = state.partnerExports[0];
      assert(payload.format === 'csv', 'Partner export must preserve requested CSV format.');
      assert(JSON.stringify(payload.machineIds) === JSON.stringify(['partner-machine-harbor']), 'Partner export must contain only the selected machine ID.');
      assert(payload.partnershipId === 'partnership-sanitized-uat', 'Partner export must retain partnership scope.');
    });
    await check('Partner desktop has no horizontal overflow', () => assertNoHorizontalOverflow(page, 'Partner desktop'));
    await settleScreenshotViewport(page, /partner CSV generated/i);
    await page.screenshot({ path: path.join(outputDir, 'partner-selected-machine-desktop.png'), fullPage: true });
  } finally {
    await context.close();
  }
};

const assertPartnerMobile = async (browser) => {
  const { page, context } = await createPageForPersona(
    browser,
    personas.corporatePartner,
    { width: 390, height: 844 },
  );
  try {
    await page.goto(`${appUrl}/portal/reports`, { waitUntil: 'networkidle' });
    await waitForReport(page);
    await page.getByRole('heading', { name: 'Partner performance summary' }).waitFor();
    await check('Partner mobile all-machines view preserves location and action context', async () => {
      await assertPartnerAllMachines(page);
      await assertNoHorizontalOverflow(page, 'Partner all-machines mobile');
      const action = await visibleMachineLocator(page, selectors.partnerMachineAction, 'partner-machine-zero', 'Zero-sales mobile machine action');
      await assertTouchTarget(action, 'Partner mobile View machine action');
    });
    await page.screenshot({ path: path.join(outputDir, 'partner-all-machines-mobile-390.png'), fullPage: true });

    await check('Partner mobile selected zero-sales machine keeps scope, history, back action, and no overflow', async () => {
      const action = await visibleMachineLocator(page, selectors.partnerMachineAction, 'partner-machine-zero', 'Zero-sales mobile machine action');
      await action.click();
      await assertSelectedPartnerMachine(page, partnerMachines[2]);
      await assertTouchTarget(page.locator(selectors.partnerBackAll), 'Partner mobile Back to all machines action');
      await assertNoHorizontalOverflow(page, 'Partner selected-machine mobile');
    });
    await page.locator(selectors.partnerBackAll).click();
    await searchForPartnerMachine(
      page,
      'Pier Center',
      /Kiosk West.*Pier Center|Pier Center.*Kiosk West/i,
    );
    await assertSelectedPartnerMachine(page, partnerMachines[2]);
    await settleScreenshotViewport(page);
    await page.screenshot({ path: path.join(outputDir, 'partner-selected-zero-machine-mobile-390.png'), fullPage: true });
  } finally {
    await context.close();
  }
};

const assertSuperAdminPartnerDrilldown = async (browser) => {
  const { page, context } = await createPageForPersona(
    browser,
    personas.superAdmin,
    { width: 1366, height: 900 },
  );
  try {
    await page.goto(`${appUrl}/portal/reports`, { waitUntil: 'networkidle' });
    await waitForReport(page);
    await check('Super Admin can open and leave a scoped partner machine drilldown', async () => {
      const partnerToggle = await visibleLocator(
        page.getByRole('radio', { name: /partner dashboard/i }),
        'Super Admin partner dashboard toggle',
      );
      await partnerToggle.click();
      await page.getByRole('heading', { name: 'Partner performance summary' }).waitFor();
      await assertPartnerAllMachines(page);
      const action = await visibleMachineLocator(
        page,
        selectors.partnerMachineAction,
        'partner-machine-harbor',
        'Super Admin Harbor machine action',
      );
      await action.click();
      await assertSelectedPartnerMachine(page, partnerMachines[0]);
      await page.locator(selectors.partnerBackAll).click();
      await visibleMachineLocator(
        page,
        selectors.partnerMachineAction,
        'partner-machine-harbor',
        'Super Admin returned all-machines action',
      );
    });
  } finally {
    await context.close();
  }
};

const assertResponsiveBoundaryWidths = async (browser) => {
  for (const width of [360, 414]) {
    const { page, context } = await createPageForPersona(
      browser,
      personas.operator,
      { width, height: width === 360 ? 800 : 896 },
    );
    try {
      await page.goto(`${appUrl}/portal/reports`, { waitUntil: 'networkidle' });
      await waitForReport(page);
      await check(`Operator compact boundary ${width}px has no horizontal overflow`, () =>
        assertNoHorizontalOverflow(page, `Operator compact ${width}px`),
      );
      await chooseLastSevenDaily(page);
      await check(`Operator expanded-filter boundary ${width}px has no horizontal overflow`, () =>
        assertNoHorizontalOverflow(page, `Operator expanded ${width}px`),
      );
    } finally {
      await context.close();
    }
  }

  const { page, context } = await createPageForPersona(
    browser,
    personas.corporatePartner,
    { width: 414, height: 896 },
  );
  try {
    await page.goto(`${appUrl}/portal/reports`, { waitUntil: 'networkidle' });
    await waitForReport(page);
    await page.getByRole('heading', { name: 'Partner performance summary' }).waitFor();
    await check('Partner responsive boundary 414px keeps all-machine and selected-machine scopes in bounds', async () => {
      await assertNoHorizontalOverflow(page, 'Partner all-machines 414px');
      const action = await visibleMachineLocator(
        page,
        selectors.partnerMachineAction,
        'partner-machine-zero',
        'Partner 414px zero-sales machine action',
      );
      await action.click();
      await assertSelectedPartnerMachine(page, partnerMachines[2]);
      await assertNoHorizontalOverflow(page, 'Partner selected-machine 414px');
    });
  } finally {
    await context.close();
  }
};

const assertPermissionBoundaries = async (browser) => {
  const { page: baselinePage, context: baselineContext } = await createPageForPersona(
    browser,
    personas.baseline,
    { width: 1366, height: 900 },
  );
  try {
    await baselinePage.goto(`${appUrl}/portal/reports`, { waitUntil: 'networkidle' });
    await check('Baseline account remains blocked from reporting', async () => {
      const bodyText = await textOf(baselinePage.locator('body'));
      assert(/Reporting is not included|reporting access|required/i.test(bodyText), `Baseline account must see the existing reporting boundary. Found: ${bodyText.slice(0, 500)}`);
      assert((await baselinePage.locator(selectors.operatorDailySales).count()) === 0, 'Baseline account must not receive operator daily data.');
      assert((await baselinePage.locator(selectors.partnerMachineRow).count()) === 0, 'Baseline account must not receive partner machine data.');
    });
  } finally {
    await baselineContext.close();
  }

  const signedOutContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await signedOutContext.route('**/auth/v1/**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'No active sanitized UAT session.' }) }),
  );
  const signedOutPage = await signedOutContext.newPage();
  try {
    await signedOutPage.goto(`${appUrl}/portal/reports?source=issue-656-657`, { waitUntil: 'networkidle' });
    await check('Signed-out reporting route still redirects to login', async () => {
      assert(new URL(signedOutPage.url()).pathname === '/login', `Signed-out report route must redirect to /login. Found: ${signedOutPage.url()}`);
    });
  } finally {
    await signedOutContext.close();
  }
};

const writeResults = () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const payload = {
    issues: [656, 657],
    appUrl,
    fixedNow: fixedNowIso,
    startedAt,
    completedAt: new Date().toISOString(),
    status: runError ? 'fail' : 'pass',
    sanitizedFixtures: true,
    checks,
    browserErrors,
    error: runError,
    screenshots: fs.existsSync(outputDir)
      ? fs.readdirSync(outputDir).filter((name) => name.endsWith('.png')).sort()
      : [],
  };
  fs.writeFileSync(path.join(outputDir, 'reporting-uat-results.json'), `${JSON.stringify(payload, null, 2)}\n`);
  const markdown = [
    '# Reporting UAT result - issues #656 and #657',
    '',
    `- Status: **${payload.status.toUpperCase()}**`,
    `- App: \`${appUrl}\``,
    `- Fixed fixture clock: \`${fixedNowIso}\``,
    '- Data: sanitized, intercepted Auth/RPC/function responses only',
    '',
    '## Checks',
    '',
    ...checks.map((result) => `- ${result.status === 'pass' ? 'PASS' : 'FAIL'} - ${result.name}${result.detail ? `: ${result.detail}` : ''}`),
    '',
    '## Screenshots',
    '',
    ...payload.screenshots.map((name) => `- \`${name}\``),
    '',
    ...(browserErrors.length ? ['## Browser errors', '', ...browserErrors.map((error) => `- ${error}`), ''] : []),
    ...(runError ? ['## Failure', '', runError, ''] : []),
  ].join('\n').trimEnd();
  fs.writeFileSync(path.join(outputDir, 'reporting-uat-results.md'), `${markdown}\n`);
};

fs.mkdirSync(outputDir, { recursive: true });
for (const artifactName of fs.readdirSync(outputDir)) {
  if (/\.(?:json|md|png|txt)$/i.test(artifactName)) {
    fs.rmSync(path.join(outputDir, artifactName));
  }
}
const browser = await chromium.launch({ headless: true });
try {
  await assertOperatorDesktop(browser);
  await assertOperatorMobile(browser);
  await assertOperatorFreshnessVariants(browser);
  await assertPartnerDesktop(browser);
  await assertPartnerMobile(browser);
  await assertSuperAdminPartnerDrilldown(browser);
  await assertResponsiveBoundaryWidths(browser);
  await assertPermissionBoundaries(browser);
  await check('No unexpected browser errors occurred', async () => {
    assert(browserErrors.length === 0, `Unexpected browser errors:\n${browserErrors.join('\n')}`);
  });
} catch (error) {
  runError = error instanceof Error ? error.stack ?? error.message : String(error);
} finally {
  await browser.close();
  writeResults();
}

if (runError) {
  console.error(runError);
  console.error(`Reporting UAT failed. Results: ${path.relative(repoRoot, path.join(outputDir, 'reporting-uat-results.md'))}`);
  process.exitCode = 1;
} else {
  console.log(`Reporting UAT passed at ${appUrl}`);
  console.log(`Screenshots and results written to ${path.relative(repoRoot, outputDir)}`);
}
