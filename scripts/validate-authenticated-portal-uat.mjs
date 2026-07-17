import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(repoRoot, 'output', 'playwright');

const getArg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }

  return fallback;
};

const appUrl = getArg('--app-url', 'http://127.0.0.1:8081');
const expiresAt = Math.floor(Date.now() / 1000) + 3600;
const debug = process.env.PORTAL_UAT_DEBUG === '1';
const unexpectedBrowserErrors = [];

const personas = {
  admin: {
    id: '00000000-0000-4000-9000-000000000001',
    email: 'admin-uat@bloomjoy.localhost',
    plus: true,
    portalAccessTier: 'plus',
    isSuperAdmin: true,
    isScopedAdmin: false,
    canAccessAdmin: true,
    allowedSurfaces: ['*'],
    hasReportingAccess: true,
    canManageTechnicians: true,
    canManageTeam: true,
    isCorporatePartner: false,
    capabilities: ['reports.partner.view', 'refunds.manage', 'technicians.manage'],
    timekeeping: false,
  },
  customer: {
    id: '00000000-0000-4000-9000-000000000002',
    email: 'customer-uat@bloomjoy.localhost',
    plus: false,
    portalAccessTier: 'baseline',
    isSuperAdmin: false,
    isScopedAdmin: false,
    canAccessAdmin: false,
    allowedSurfaces: [],
    hasReportingAccess: false,
    canManageTechnicians: false,
    canManageTeam: false,
    isCorporatePartner: false,
    capabilities: [],
    timekeeping: false,
  },
  timekeeper: {
    id: '00000000-0000-4000-9000-000000000003',
    email: 'timekeeper-uat@bloomjoy.localhost',
    plus: false,
    portalAccessTier: 'baseline',
    isSuperAdmin: false,
    isScopedAdmin: false,
    canAccessAdmin: false,
    allowedSurfaces: [],
    hasReportingAccess: false,
    canManageTechnicians: false,
    canManageTeam: false,
    isCorporatePartner: false,
    capabilities: ['operator.timekeeping'],
    timekeeping: true,
  },
  profileOnlyTimekeeper: {
    id: '00000000-0000-4000-9000-000000000009',
    email: 'profile-only-timekeeper-uat@bloomjoy.localhost',
    plus: false,
    portalAccessTier: 'baseline',
    isSuperAdmin: false,
    isScopedAdmin: false,
    canAccessAdmin: false,
    allowedSurfaces: [],
    hasReportingAccess: false,
    canManageTechnicians: false,
    canManageTeam: false,
    isCorporatePartner: false,
    capabilities: [],
    timekeeping: true,
  },
  training: {
    id: '00000000-0000-4000-9000-000000000004',
    email: 'training-uat@bloomjoy.localhost',
    plus: false,
    portalAccessTier: 'training',
    isSuperAdmin: false,
    isScopedAdmin: false,
    canAccessAdmin: false,
    allowedSurfaces: [],
    hasReportingAccess: false,
    canManageTechnicians: false,
    canManageTeam: false,
    isCorporatePartner: false,
    capabilities: [],
    timekeeping: false,
  },
  reportingTechnician: {
    id: '00000000-0000-4000-9000-000000000006',
    email: 'reporting-technician-uat@bloomjoy.localhost',
    plus: false,
    portalAccessTier: 'training',
    isSuperAdmin: false,
    isScopedAdmin: false,
    canAccessAdmin: false,
    allowedSurfaces: [],
    hasReportingAccess: true,
    canManageTechnicians: false,
    canManageTeam: false,
    isCorporatePartner: false,
    capabilities: ['training.view'],
    timekeeping: false,
  },
  plusMember: {
    id: '00000000-0000-4000-9000-000000000007',
    email: 'plus-member-uat@bloomjoy.localhost',
    plus: true,
    portalAccessTier: 'plus',
    isSuperAdmin: false,
    isScopedAdmin: false,
    canAccessAdmin: false,
    allowedSurfaces: [],
    hasReportingAccess: false,
    canManageTechnicians: false,
    canManageTeam: false,
    isCorporatePartner: false,
    capabilities: [],
    timekeeping: false,
  },
  corporatePartner: {
    id: '00000000-0000-4000-9000-000000000008',
    email: 'corporate-partner-uat@bloomjoy.localhost',
    plus: false,
    portalAccessTier: 'corporate_partner',
    isSuperAdmin: false,
    isScopedAdmin: false,
    canAccessAdmin: false,
    allowedSurfaces: [],
    hasReportingAccess: false,
    canManageTechnicians: true,
    canManageTeam: true,
    isCorporatePartner: true,
    capabilities: ['reports.partner.view', 'training.view', 'technicians.manage'],
    timekeeping: false,
  },
  scopedAdmin: {
    id: '00000000-0000-4000-9000-000000000005',
    email: 'scoped-admin-uat@bloomjoy.localhost',
    plus: false,
    portalAccessTier: 'baseline',
    isSuperAdmin: false,
    isScopedAdmin: true,
    canAccessAdmin: true,
    allowedSurfaces: ['orders'],
    hasReportingAccess: false,
    canManageTechnicians: false,
    canManageTeam: false,
    isCorporatePartner: false,
    capabilities: [],
    timekeeping: false,
  },
};

const requiredTrainingIds = [
  'software-setup-quickstart',
  'start-up-shutdown-procedure',
  'pricing-passwords-payment-settings',
  'alarm-and-power-timer-setup',
  'daily-maintenance-routine',
  'consumables-loading-and-stick-handling',
  'troubleshooting-common-issues',
];

const normalizeDashboardTaskHref = (href) => {
  if (href?.startsWith('/portal/training')) {
    return '/portal/training';
  }
  if (href?.startsWith('/portal/time')) {
    return '/portal/time';
  }

  return href;
};

const assert = async (conditionOrPromise, message) => {
  const condition = await conditionOrPromise;
  if (!condition) {
    throw new Error(message);
  }
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
  access_token: `uat-access-token-${persona.id}`,
  refresh_token: `uat-refresh-token-${persona.id}`,
  expires_at: expiresAt,
  expires_in: 3600,
  token_type: 'bearer',
  user: makeUser(persona),
});

const makeTimekeepingContext = (persona) => ({
  workDate: '2026-06-27',
  profiles: persona.timekeeping
    ? [
        {
          id: 'operator-profile-uat',
          accountId: 'account-uat',
          accountName: 'UAT Account',
          displayName: 'Timekeeper UAT',
          workerType: 'hourly',
          status: 'active',
          assignedMachines: [
            {
              assignmentId: 'assignment-uat',
              machineId: 'machine-uat',
              machineLabel: 'UAT Machine',
              locationId: 'location-uat',
              locationName: 'UAT Location',
              effectiveStartDate: '2026-01-01',
              effectiveEndDate: null,
            },
          ],
          policy: {
            id: 'policy-uat',
            name: 'Hourly UAT',
            frequency: 'weekly',
            roundingRule: 'nearest_15_minutes',
            reviewModel: 'manager_review',
          },
          currentPeriod: {
            id: 'period-uat',
            periodStartDate: '2026-06-22',
            periodEndDate: '2026-06-28',
            submissionDueDate: '2026-06-29',
            lockDate: '2026-06-30',
            targetPayoutDate: '2026-07-03',
            status: 'open',
          },
          currentEntries: [],
          recentEntries: [],
        },
      ]
    : [],
});

const rpcResponse = (rpcName, persona) => {
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
        has_plus_access: persona.plus,
        source: persona.plus ? 'subscription' : null,
        membership_status: persona.plus ? 'active' : 'none',
        current_period_end: null,
        cancel_at_period_end: false,
        paid_subscription_active: persona.plus,
        free_grant_id: null,
        free_grant_starts_at: null,
        free_grant_expires_at: null,
        free_grant_active: false,
      };
    case 'get_my_admin_access_context':
      return {
        isSuperAdmin: persona.isSuperAdmin,
        isScopedAdmin: persona.isScopedAdmin,
        canAccessAdmin: persona.canAccessAdmin,
        allowedSurfaces: persona.allowedSurfaces,
        scopedMachineIds: [],
      };
    case 'get_my_portal_access_context':
      return {
        access_tier: persona.portalAccessTier,
        is_plus_member: persona.plus,
        is_training_operator: persona.portalAccessTier === 'training',
        is_admin: persona.canAccessAdmin,
        can_manage_operator_training: persona.plus,
        is_corporate_partner: persona.isCorporatePartner,
        has_supply_discount: persona.plus,
        can_request_support: persona.plus,
        can_manage_technicians: persona.canManageTechnicians,
        capabilities: persona.capabilities,
        effective_presets: [],
      };
    case 'get_my_reporting_access_context':
      return {
        has_reporting_access: persona.hasReportingAccess,
        accessible_machine_count: persona.hasReportingAccess ? 3 : 0,
        accessible_location_count: persona.hasReportingAccess ? 2 : 0,
        can_manage_reporting: persona.isSuperAdmin,
        latest_sale_date: '2026-06-26',
        latest_import_completed_at: '2026-06-27T12:00:00.000Z',
      };
    case 'get_reporting_dimensions':
      return persona.hasReportingAccess
        ? [
            {
              account_id: 'account-uat',
              account_name: 'UAT Account',
              location_id: 'location-uat',
              location_name: 'UAT Location',
              machine_id: 'machine-uat',
              machine_label: 'UAT Machine',
              machine_type: 'robotic_cotton_candy',
              sunze_machine_id: 'sunze-uat',
              latest_sale_date: '2026-06-26',
              status: 'active',
            },
          ]
        : [];
    case 'get_sales_report':
      return persona.hasReportingAccess
        ? [
            {
              period_start: '2026-06-26',
              machine_id: 'machine-uat',
              machine_label: 'UAT Machine',
              location_id: 'location-uat',
              location_name: 'UAT Location',
              payment_method: 'credit',
              net_sales_cents: 12500,
              refund_amount_cents: 500,
              gross_sales_cents: 13000,
              transaction_count: 26,
            },
          ]
        : [];
    case 'get_my_technician_management_context':
      return {
        canManage: persona.canManageTeam,
        seatCap: 10,
        accounts: persona.canManageTeam
          ? [
              {
                accountId: 'account-uat',
                accountName: 'UAT Account',
                accountStatus: 'active',
                authorityPath: 'plus_customer_account',
                partnerId: null,
                partnerName: null,
                seatCap: 10,
                activeSeatCount: 1,
                machineCount: 1,
                machines: [],
              },
            ]
          : [],
      };
    case 'get_my_operator_timekeeping_context':
      return makeTimekeepingContext(persona);
    case 'get_my_operator_pay_statement_context':
      return {
        profiles: persona.timekeeping
          ? [
              {
                id: 'operator-profile-uat',
                accountId: 'account-uat',
                accountName: 'UAT Account',
                displayName: 'Timekeeper UAT',
                workerType: 'hourly',
                statements: [],
              },
            ]
          : [],
      };
    case 'admin_get_account_summaries':
    case 'admin_get_audit_log':
    case 'admin_list_scoped_admin_grants':
      return [];
    case 'admin_get_partnership_reporting_setup':
      return {
        partners: [],
        partnerships: [],
        machines: [],
        assignments: [],
        parties: [],
        taxRates: [],
        financialRules: [],
        warnings: [],
      };
    case 'admin_get_refund_manager_setup':
      return { machines: [] };
    default:
      return {};
  }
};

const createPageForPersona = async (
  browser,
  persona,
  viewport,
  {
    failLanguageSync = false,
    dashboardStatusDelayMs = 0,
    dashboardStatusFailureAttempts = 0,
    trainingProgressRecords = [],
    onboardingCompletedStepIds = null,
    language = 'en',
  } = {},
) => {
  const context = await browser.newContext({ viewport });
  const session = makeSession(persona);
  let dashboardStatusRequestCount = 0;

  await context.addInitScript(
    ({ value, email, completedStepIds, initialLanguage }) => {
      const sessionValue = JSON.stringify(value);
      const isSupabaseAuthKey = (key) =>
        typeof key === 'string' && /^sb-.+-auth-token$/.test(key);
      const originalGetItem = Storage.prototype.getItem;
      const originalSetItem = Storage.prototype.setItem;

      Storage.prototype.getItem = function getItem(key) {
        if (isSupabaseAuthKey(key)) {
          return sessionValue;
        }

        return originalGetItem.call(this, key);
      };

      Storage.prototype.setItem = function setItem(key, nextValue) {
        if (isSupabaseAuthKey(key)) {
          return originalSetItem.call(this, key, sessionValue);
        }

        return originalSetItem.call(this, key, nextValue);
      };

      if (Array.isArray(completedStepIds)) {
        window.localStorage.setItem(
          `bloomjoy-onboarding:${email.toLowerCase()}`,
          JSON.stringify({ completedStepIds }),
        );
      }
      if (window.localStorage.getItem('bloomjoy.language.v1') === null) {
        window.localStorage.setItem('bloomjoy.language.v1', initialLanguage);
      }
    },
    {
      value: session,
      email: persona.email,
      completedStepIds: onboardingCompletedStepIds,
      initialLanguage: language,
    },
  );

  await context.route('**/auth/v1/user', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makeUser(persona)),
    }),
  );
  await context.route('**/auth/v1/token**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(session),
    }),
  );
  const fulfillRpc = async (route, rpcName) => {
    if (rpcName === 'get_my_operator_timekeeping_context') {
      dashboardStatusRequestCount += 1;
      if (dashboardStatusDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, dashboardStatusDelayMs));
      }
      if (dashboardStatusRequestCount <= dashboardStatusFailureAttempts) {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Dashboard status unavailable in UAT.' }),
        });
      }
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(rpcResponse(rpcName, persona)),
    });
  };

  await context.route('**/rest/v1/rpc/**', async (route) => {
    const rpcName = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
    if (debug) {
      console.log(`[${persona.email}] rpc ${rpcName}`);
    }
    return fulfillRpc(route, rpcName);
  });
  await context.route('**/rest/v1/**', (route) =>
    {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.pathname.includes('/rest/v1/rpc/')) {
        const rpcName = decodeURIComponent(requestUrl.pathname.split('/').pop());
        if (debug) {
          console.log(`[${persona.email}] rpc ${rpcName}`);
        }

        return fulfillRpc(route, rpcName);
      }

      if (
        failLanguageSync &&
        requestUrl.pathname.endsWith('/customer_profiles') &&
        route.request().method() !== 'GET'
      ) {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Language preference sync unavailable in UAT.' }),
        });
      }

      if (requestUrl.pathname.endsWith('/training_progress')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(trainingProgressRecords),
        });
      }

      if (debug) {
        console.log(`[${persona.email}] rest ${route.request().method()} ${route.request().url()}`);
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    },
  );

  const page = await context.newPage();
  page.on('console', (message) => {
    const isExpectedLanguageSyncFailure =
      failLanguageSync &&
      message.type() === 'error' &&
      message.text().includes('503 (Service Unavailable)');
    const isExpectedDashboardStatusFailure =
      dashboardStatusFailureAttempts > 0 &&
      message.type() === 'error' &&
      message.text().includes('503 (Service Unavailable)');
    if (
      message.type() === 'error' &&
      !isExpectedLanguageSyncFailure &&
      !isExpectedDashboardStatusFailure
    ) {
      const errorMessage = `[${persona.email}] console error: ${message.text()}`;
      unexpectedBrowserErrors.push(errorMessage);
      console.error(errorMessage);
    }
  });
  page.on('pageerror', (error) => {
    const errorMessage = `[${persona.email}] page error: ${error.message}`;
    unexpectedBrowserErrors.push(errorMessage);
    console.error(errorMessage);
  });
  page.on('requestfailed', (request) => {
    const errorMessage =
      `[${persona.email}] request failed: ${request.method()} ${request.url()} ` +
      `(${request.failure()?.errorText ?? 'unknown error'})`;
    unexpectedBrowserErrors.push(errorMessage);
    console.error(errorMessage);
  });
  page.on('response', (response) => {
    if (response.status() < 400) {
      return;
    }

    const requestUrl = new URL(response.url());
    const isExpectedDashboardStatusFailure =
      dashboardStatusFailureAttempts > 0 &&
      response.status() === 503 &&
      requestUrl.pathname.endsWith('/rest/v1/rpc/get_my_operator_timekeeping_context');
    const isExpectedLanguageSyncFailure =
      failLanguageSync &&
      response.status() === 503 &&
      requestUrl.pathname.endsWith('/customer_profiles');

    if (isExpectedDashboardStatusFailure || isExpectedLanguageSyncFailure) {
      return;
    }

    const errorMessage =
      `[${persona.email}] unexpected response: ${response.status()} ` +
      `${response.request().method()} ${response.url()}`;
    unexpectedBrowserErrors.push(errorMessage);
    console.error(errorMessage);
  });

  return page;
};

const textContent = async (locator) => (await locator.textContent()) ?? '';

const waitForHeading = async (page, options, screenshotName) => {
  try {
    await page.getByRole('heading', options).waitFor();
  } catch (error) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    await page.screenshot({
      path: path.join(outputDir, screenshotName),
      fullPage: true,
    }).catch(() => {});
    console.error(`UAT wait failed at ${page.url()}`);
    console.error(bodyText.slice(0, 1200));
    throw error;
  }
};

const visibleLanguageControls = (page) =>
  page.locator('[data-language-preference-control]:visible');

const assertNoHorizontalOverflow = async (page, label) => {
  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  await assert(
    dimensions.documentWidth <= dimensions.viewportWidth + 1,
    `${label} must not overflow horizontally (${dimensions.documentWidth}px > ${dimensions.viewportWidth}px).`,
  );
};

const assertDashboardExperience = async (
  page,
  {
    label,
    expectedPrimaryHref,
    expectedState = 'ready',
    primaryInFirstViewport = false,
  },
) => {
  const primaryAction = page.locator('[data-dashboard-primary-action]');
  await primaryAction.waitFor();
  await assert(
    (await page.locator('main h1').count()) === 1,
    `${label} must render exactly one page H1.`,
  );
  await assert(
    (await primaryAction.count()) === 1,
    `${label} must render exactly one primary dashboard action.`,
  );
  await assert(
    (await primaryAction.getAttribute('href')) === expectedPrimaryHref,
    `${label} primary action must target ${expectedPrimaryHref}.`,
  );
  await assert(
    (await page.locator('[data-dashboard-state]').getAttribute('data-dashboard-state')) ===
      expectedState,
    `${label} must finish in the ${expectedState} dashboard state.`,
  );

  const attentionItems = page.locator('[data-dashboard-attention-item]');
  await assert(
    (await attentionItems.count()) <= 2,
    `${label} must cap secondary attention items at two.`,
  );
  const attentionHrefs = await attentionItems.locator('a').evaluateAll((links) =>
    links.map((link) => link.getAttribute('href')).filter(Boolean),
  );
  const secondaryAction = page.locator('[data-dashboard-secondary-action]');
  const secondaryHref =
    (await secondaryAction.count()) > 0
      ? await secondaryAction.getAttribute('href')
      : null;
  const allTaskHrefs = [expectedPrimaryHref, secondaryHref, ...attentionHrefs]
    .filter(Boolean)
    .map(normalizeDashboardTaskHref);
  await assert(
    new Set(allTaskHrefs).size === allTaskHrefs.length,
    `${label} must not duplicate a task across primary, secondary, and attention actions.`,
  );
  await assert(
    (await page.locator('main a[href="/portal/reports"]').count()) <= 1,
    `${label} must render Reporting at most once inside the dashboard.`,
  );

  const primaryBox = await primaryAction.boundingBox();
  await assert(
    primaryBox && primaryBox.height >= 44,
    `${label} primary action must provide at least a 44px touch target.`,
  );
  if (primaryInFirstViewport) {
    const viewport = page.viewportSize();
    await assert(
      primaryBox && viewport && primaryBox.y + primaryBox.height <= viewport.height,
      `${label} primary action must remain visible in the first mobile viewport.`,
    );
  }

  await assertNoHorizontalOverflow(page, label);
};

const assertDashboardPrimaryNavigation = async (page, { label, expectedPath }) => {
  const primaryAction = page.locator('[data-dashboard-primary-action]');
  await primaryAction.click();
  await page.waitForURL((url) => url.pathname === expectedPath);
  await page.locator('main h1').first().waitFor();
  const destinationText = await textContent(page.locator('main'));
  await assert(
    !/Page not found|Access required|Timekeeping setup required|not included with this account|outside your current access|Ask Bloomjoy for access/i.test(
      destinationText,
    ),
    `${label} primary action must reach its authorized destination without a route guard.`,
  );
  if (expectedPath.startsWith('/portal') || expectedPath.startsWith('/admin')) {
    await assert(
      (await page.locator('[data-app-shell-content-header]').count()) === 1,
      `${label} primary action must remain inside the authenticated application shell.`,
    );
    await assert(
      (await page.locator('aside nav a[aria-current="page"]').count()) === 1,
      `${label} primary destination must activate exactly one authenticated navigation item.`,
    );
  }
};

const assertHeaderAlignment = async (page, label) => {
  const sidebarHeader = page.locator('[data-app-shell-sidebar-header]');
  const contentHeader = page.locator('[data-app-shell-content-header]');
  await assert(
    (await sidebarHeader.count()) === 1 && (await contentHeader.count()) === 1,
    `${label} must render one sidebar header and one content header.`,
  );

  const [sidebarBox, contentBox, sidebarBorder, contentBorder] = await Promise.all([
    sidebarHeader.boundingBox(),
    contentHeader.boundingBox(),
    sidebarHeader.evaluate((element) => getComputedStyle(element).borderBottomColor),
    contentHeader.evaluate((element) => getComputedStyle(element).borderBottomColor),
  ]);
  await assert(sidebarBox && contentBox, `${label} header boxes must be measurable.`);

  const dividerDelta = Math.abs(
    sidebarBox.y + sidebarBox.height - (contentBox.y + contentBox.height),
  );
  await assert(
    dividerDelta <= 1,
    `${label} header dividers must align within 1 CSS px; measured ${dividerDelta.toFixed(2)}px.`,
  );
  await assert(
    sidebarBorder === contentBorder,
    `${label} header dividers must use the same color token.`,
  );
};

const readActionTreatment = async (locator) =>
  locator.evaluate((element) => {
    const surface = element.closest('.app-surface');
    const surfaceStyles = getComputedStyle(surface);
    const normalizeColor = (tokenName) => {
      const token = surfaceStyles.getPropertyValue(tokenName).trim();
      const probe = document.createElement('span');
      probe.style.color = `hsl(${token})`;
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const styles = getComputedStyle(element);

    return {
      background: styles.backgroundColor,
      color: styles.color,
      boxShadow: styles.boxShadow,
      expectedAction: normalizeColor('--action'),
      expectedForeground: normalizeColor('--action-foreground'),
      expectedHover: normalizeColor('--action-hover'),
      expectedActive: normalizeColor('--action-active'),
    };
  });

const assertActionTreatment = async (page, selector, label) => {
  const action = page.locator(selector);
  await action.waitFor();
  await assert((await action.count()) === 1, `${label} must resolve to one action.`);

  const normal = await readActionTreatment(action);
  await assert(
    normal.background === normal.expectedAction && normal.color === normal.expectedForeground,
    `${label} must use the semantic action fill and foreground.`,
  );
  await assert(normal.boxShadow !== 'none', `${label} must use the semantic action shadow.`);

  await action.hover();
  await page.waitForTimeout(250);
  const hovered = await readActionTreatment(action);
  await assert(
    hovered.background === hovered.expectedHover,
    `${label} hover must use the semantic hover fill.`,
  );

  const box = await action.boundingBox();
  await assert(box, `${label} must have a pointer target.`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(250);
  const active = await readActionTreatment(action);
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await assert(
    active.background === active.expectedActive,
    `${label} active state must use the semantic active fill.`,
  );
};

fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch();

try {
  const adminPage = await createPageForPersona(browser, personas.admin, {
    width: 1366,
    height: 768,
  });
  await adminPage.goto(`${appUrl}/admin`, { waitUntil: 'networkidle' });
  await waitForHeading(
    adminPage,
    { name: 'Overview', level: 1 },
    'portal-shell-admin-debug-failed.png',
  );
  await assert((await adminPage.locator('h1').count()) === 1, 'Admin route should render one H1.');
  await assert(
    (await adminPage.locator('text=ADMIN TOOLS').count()) === 0,
    'Old horizontal admin tools row should not render.',
  );

  const adminNavText = await textContent(adminPage.locator('aside nav'));
  await assert(adminNavText.includes('Work'), 'Admin nav must include shared Work.');
  await assert(adminNavText.includes('Operations'), 'Admin nav must include Operations.');
  await assert(adminNavText.includes('Customers'), 'Admin nav must include Customers.');
  await assert(adminNavText.includes('Partners & Reporting'), 'Admin nav must include Partners & Reporting.');
  await assert(adminNavText.includes('Administration'), 'Admin nav must include Administration.');
  await assert(adminNavText.includes('Refunds'), 'Admin nav must include the shared Refunds item.');
  await assert(adminNavText.includes('Operator Pay'), 'Admin nav must include Operator Pay.');
  await assert(
    !adminNavText.includes('Portal Dashboard'),
    'Admin nav must not show Portal Dashboard as a competing top-level destination.',
  );
  await assert(
    await adminPage.getByText('Switch to Portal').isVisible(),
    'Admin routes should expose Switch to Portal as a utility action.',
  );
  await assert(
    adminNavText.indexOf('Work') < adminNavText.indexOf('Operations') &&
      adminNavText.indexOf('Operations') < adminNavText.indexOf('Customers') &&
      adminNavText.indexOf('Customers') < adminNavText.indexOf('Administration') &&
      adminNavText.indexOf('Administration') < adminNavText.indexOf('Partners & Reporting'),
    'Admin routes should order shared Work before Operations, Customers, Administration, then Partners & Reporting.',
  );
  await assert(
    !adminNavText.includes('admin_roles') && !adminNavText.includes('is_super_admin'),
    'Visible admin nav must not expose implementation role names.',
  );
  await assert(
    (await visibleLanguageControls(adminPage).count()) === 0,
    'Authenticated desktop shell must not render a persistent language selector.',
  );
  await assertHeaderAlignment(adminPage, 'Admin desktop shell');

  const activeAdminHome = await adminPage.locator('aside nav a[aria-current="page"]').allTextContents();
  await assert(
    activeAdminHome.length === 1 && activeAdminHome[0].includes('Admin Console'),
    'Admin Home should have exactly one active nav item.',
  );

  await adminPage.goto(`${appUrl}/admin/orders`, { waitUntil: 'networkidle' });
  const activeAdminOrders = await adminPage
    .locator('aside nav a[aria-current="page"]')
    .allTextContents();
  await assert(
    activeAdminOrders.length === 1 && activeAdminOrders[0].includes('Admin Orders'),
    'Admin child routes should not also mark Admin Console active.',
  );
  await adminPage.screenshot({ path: path.join(outputDir, 'portal-shell-admin-desktop.png'), fullPage: true });
  await adminPage.close();

  const adminDashboardPage = await createPageForPersona(browser, personas.admin, {
    width: 1366,
    height: 768,
  });
  let adminTrainingProgressRequests = 0;
  adminDashboardPage.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/training_progress')) {
      adminTrainingProgressRequests += 1;
    }
  });
  await adminDashboardPage.goto(`${appUrl}/portal`, { waitUntil: 'networkidle' });
  await waitForHeading(
    adminDashboardPage,
    { name: 'Welcome back', level: 1 },
    'portal-dashboard-admin-debug-failed.png',
  );
  await assertDashboardExperience(adminDashboardPage, {
    label: 'Super Admin dashboard',
    expectedPrimaryHref: '/admin',
  });
  await assert(
    (await adminDashboardPage.getByText('Continue Setup').count()) === 0,
    'Super Admin dashboard must not treat a device-local customer checklist as admin work.',
  );
  await assert(
    adminTrainingProgressRequests === 0,
    'Super Admin dashboard readiness must not depend on irrelevant training-progress requests.',
  );
  await assert(
    await adminDashboardPage.evaluate(
      () =>
        performance.getEntriesByName('bloomjoy.portal.dashboard_data_ready').length === 1,
    ),
    'Super Admin dashboard must emit its data-ready performance mark without training data.',
  );
  await adminDashboardPage.screenshot({
    path: path.join(outputDir, 'portal-dashboard-admin-desktop.png'),
    fullPage: true,
  });
  await assertDashboardPrimaryNavigation(adminDashboardPage, {
    label: 'Super Admin dashboard',
    expectedPath: '/admin',
  });
  await adminDashboardPage.close();

  const mobileAdminPage = await createPageForPersona(browser, personas.admin, {
    width: 390,
    height: 844,
  });
  await mobileAdminPage.goto(`${appUrl}/admin`, { waitUntil: 'networkidle' });
  await assert(
    (await visibleLanguageControls(mobileAdminPage).count()) === 0,
    'Authenticated mobile header must not render a language selector.',
  );
  await mobileAdminPage.getByRole('button', { name: 'Open operator navigation menu' }).click();
  await mobileAdminPage.waitForTimeout(150);
  const focusedText = await mobileAdminPage.evaluate(() => document.activeElement?.textContent ?? '');
  await assert(
    focusedText.includes('Admin Console'),
    'Mobile drawer should focus the first navigation destination.',
  );
  const mobileDrawerText = await textContent(mobileAdminPage.getByRole('dialog'));
  await assert(
    !mobileDrawerText.includes('Portal Dashboard') && mobileDrawerText.includes('Switch to Portal'),
    'Mobile admin drawer should keep portal switching in utilities, not the primary nav.',
  );
  await assert(
    mobileDrawerText.includes('Work') &&
      mobileDrawerText.indexOf('Work') < mobileDrawerText.indexOf('Operations') &&
      mobileDrawerText.indexOf('Operations') < mobileDrawerText.indexOf('Customers') &&
      mobileDrawerText.indexOf('Customers') < mobileDrawerText.indexOf('Administration') &&
      mobileDrawerText.indexOf('Administration') < mobileDrawerText.indexOf('Partners & Reporting'),
    'Mobile admin drawer should expose the streamlined Admin Console IA order.',
  );
  await assert(
    (await visibleLanguageControls(mobileAdminPage).count()) === 0,
    'Authenticated mobile drawer must not duplicate the Account language preference.',
  );
  await assertNoHorizontalOverflow(mobileAdminPage, 'Admin mobile drawer');
  await mobileAdminPage.screenshot({
    path: path.join(outputDir, 'portal-shell-admin-mobile-drawer.png'),
    fullPage: true,
  });
  await mobileAdminPage.close();

  const customerPage = await createPageForPersona(browser, personas.customer, {
    width: 1366,
    height: 768,
  });
  await customerPage.goto(`${appUrl}/portal`, { waitUntil: 'networkidle' });
  await waitForHeading(
    customerPage,
    { name: 'Welcome back', level: 1 },
    'portal-shell-customer-debug-failed.png',
  );
  await assert(
    (await customerPage.locator('aside nav a[href="/portal/time"]').count()) === 0,
    'Customer essentials account should not see Time in navigation.',
  );
  await assert(
    (await customerPage.getByText('See access details').count()) === 0,
    'Portal dashboard should not render locked quick-action cards.',
  );
  await assertDashboardExperience(customerPage, {
    label: 'Baseline customer dashboard',
    expectedPrimaryHref: '/supplies',
  });
  await assert(
    (await customerPage.locator('[data-dashboard-attention-list]').count()) === 0,
    'Baseline dashboard must not invent setup or training attention items.',
  );
  await assertHeaderAlignment(customerPage, 'Portal desktop shell');
  await customerPage.screenshot({
    path: path.join(outputDir, 'portal-dashboard-baseline-desktop.png'),
    fullPage: true,
  });
  await assertDashboardPrimaryNavigation(customerPage, {
    label: 'Baseline customer dashboard',
    expectedPath: '/supplies',
  });
  await customerPage.goto(`${appUrl}/portal/time`, { waitUntil: 'networkidle' });
  await customerPage.getByText('Timekeeping setup required').waitFor();
  await assert(
    (await customerPage.getByText('Locked for').count()) === 0,
    'Timekeeping route guard should not show internal locked-tier copy.',
  );
  await customerPage.screenshot({
    path: path.join(outputDir, 'portal-shell-customer-timekeeping-block.png'),
    fullPage: true,
  });
  await customerPage.close();

  const timekeeperPage = await createPageForPersona(browser, personas.timekeeper, {
    width: 1366,
    height: 768,
  });
  await timekeeperPage.goto(`${appUrl}/portal`, { waitUntil: 'networkidle' });
  await waitForHeading(
    timekeeperPage,
    { name: 'Welcome back', level: 1 },
    'portal-shell-timekeeper-debug-failed.png',
  );
  await assert(
    (await timekeeperPage.locator('aside nav a[href="/portal/time"]').count()) === 1,
    'Timekeeper should see Time in navigation.',
  );
  await assertDashboardExperience(timekeeperPage, {
    label: 'Timekeeper dashboard',
    expectedPrimaryHref: '/portal/time/new',
  });
  await timekeeperPage.screenshot({
    path: path.join(outputDir, 'portal-dashboard-timekeeper-desktop.png'),
    fullPage: true,
  });
  await assertDashboardPrimaryNavigation(timekeeperPage, {
    label: 'Timekeeper dashboard',
    expectedPath: '/portal/time/new',
  });
  await timekeeperPage.goto(`${appUrl}/portal/time`, { waitUntil: 'networkidle' });
  await waitForHeading(
    timekeeperPage,
    { name: 'Time', level: 1 },
    'portal-shell-timekeeper-time-debug-failed.png',
  );
  await assert(
    (await timekeeperPage.getByText('Timekeeping setup required').count()) === 0,
    'Timekeeper should not hit the timekeeping setup guard.',
  );
  await timekeeperPage.screenshot({
    path: path.join(outputDir, 'portal-shell-timekeeper-time.png'),
    fullPage: true,
  });
  await timekeeperPage.close();

  const loginDesktopContext = await browser.newContext({
    viewport: { width: 1366, height: 768 },
  });
  const loginDesktopPage = await loginDesktopContext.newPage();
  await loginDesktopPage.goto(`${appUrl}/login`, { waitUntil: 'networkidle' });
  await waitForHeading(
    loginDesktopPage,
    { name: 'Sign in to the Bloomjoy operator app', level: 1 },
    'portal-shell-login-desktop-debug-failed.png',
  );
  await assert(
    (await visibleLanguageControls(loginDesktopPage).count()) === 1,
    'Desktop login must render exactly one visible language selector.',
  );
  const loginLanguageButtons = visibleLanguageControls(loginDesktopPage).locator('button');
  const loginLanguageButtonBoxes = await loginLanguageButtons.evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }),
  );
  await assert(
    loginLanguageButtonBoxes.every((box) => box.width >= 44 && box.height >= 44),
    'Login language targets must be at least 44 by 44 CSS px.',
  );
  const loginEnglishButton = loginDesktopPage.getByRole('button', {
    name: 'English',
    exact: true,
  });
  await loginDesktopPage.keyboard.press('Tab');
  await loginEnglishButton.focus();
  const loginFocusState = await loginEnglishButton.evaluate((button) => ({
    focusVisible: button.matches(':focus-visible'),
    boxShadow: getComputedStyle(button).boxShadow,
  }));
  await assert(
    loginFocusState.focusVisible && loginFocusState.boxShadow !== 'none',
    'Login language buttons must expose a visible keyboard focus ring.',
  );
  await loginDesktopPage.screenshot({
    path: path.join(outputDir, 'portal-shell-login-desktop.png'),
    fullPage: true,
  });
  await loginDesktopContext.close();

  const loginMobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const loginMobilePage = await loginMobileContext.newPage();
  await loginMobilePage.goto(`${appUrl}/login`, { waitUntil: 'networkidle' });
  await waitForHeading(
    loginMobilePage,
    { name: 'Sign in to the Bloomjoy operator app', level: 1 },
    'portal-shell-login-mobile-debug-failed.png',
  );
  await assert(
    (await visibleLanguageControls(loginMobilePage).count()) === 1,
    'Mobile login must render exactly one visible language selector.',
  );
  await assertNoHorizontalOverflow(loginMobilePage, 'Login mobile');
  await loginMobilePage.screenshot({
    path: path.join(outputDir, 'portal-shell-login-mobile.png'),
    fullPage: true,
  });
  await loginMobilePage.getByRole('button', { name: 'Open operator navigation menu' }).click();
  await assert(
    (await visibleLanguageControls(loginMobilePage).count()) === 1,
    'Opening the login drawer must not create a second visible language selector.',
  );
  await loginMobileContext.close();

  const mobileDashboardPage = await createPageForPersona(browser, personas.customer, {
    width: 390,
    height: 844,
  });
  await mobileDashboardPage.goto(`${appUrl}/portal`, { waitUntil: 'networkidle' });
  await waitForHeading(
    mobileDashboardPage,
    { name: 'Welcome back', level: 1 },
    'portal-shell-dashboard-mobile-debug-failed.png',
  );
  await assert(
    (await visibleLanguageControls(mobileDashboardPage).count()) === 0,
    'Mobile dashboard shell must not render a language selector.',
  );
  await assertDashboardExperience(mobileDashboardPage, {
    label: 'Baseline mobile dashboard',
    expectedPrimaryHref: '/supplies',
    primaryInFirstViewport: true,
  });
  await mobileDashboardPage.screenshot({
    path: path.join(outputDir, 'portal-dashboard-mobile-en.png'),
    fullPage: true,
  });
  await mobileDashboardPage.close();

  const mobileChineseDashboardPage = await createPageForPersona(
    browser,
    personas.customer,
    {
      width: 390,
      height: 844,
    },
    { language: 'zh-Hans' },
  );
  await mobileChineseDashboardPage.goto(`${appUrl}/portal`, { waitUntil: 'networkidle' });
  await waitForHeading(
    mobileChineseDashboardPage,
    { name: '欢迎回来', level: 1 },
    'portal-dashboard-mobile-zh-debug-failed.png',
  );
  await assertDashboardExperience(mobileChineseDashboardPage, {
    label: 'Chinese baseline mobile dashboard',
    expectedPrimaryHref: '/supplies',
    primaryInFirstViewport: true,
  });
  const chineseDashboardText = await textContent(
    mobileChineseDashboardPage.locator('[data-dashboard-state]'),
  );
  await assert(
    !chineseDashboardText.includes('dashboard.'),
    'Chinese dashboard must not expose raw translation keys.',
  );
  await mobileChineseDashboardPage.screenshot({
    path: path.join(outputDir, 'portal-dashboard-mobile-zh.png'),
    fullPage: true,
  });
  await mobileChineseDashboardPage.close();

  const loadingDashboardPage = await createPageForPersona(
    browser,
    personas.profileOnlyTimekeeper,
    {
      width: 390,
      height: 844,
    },
    { dashboardStatusDelayMs: 1_500 },
  );
  await loadingDashboardPage.goto(`${appUrl}/portal`, { waitUntil: 'domcontentloaded' });
  await waitForHeading(
    loadingDashboardPage,
    { name: 'Welcome back', level: 1 },
    'portal-dashboard-loading-debug-failed.png',
  );
  await loadingDashboardPage.locator('[data-dashboard-primary-loading]').waitFor();
  await assert(
    (await loadingDashboardPage.locator('[data-dashboard-primary-action]').count()) === 0,
    'Profile-derived timekeeping access must not expose a fallback primary action while access is unresolved.',
  );
  await assert(
    (await loadingDashboardPage.locator('[data-dashboard-state]').getAttribute('data-dashboard-state')) ===
      'loading',
    'Delayed current-work data must render an explicit loading dashboard state.',
  );
  await assert(
    await loadingDashboardPage.evaluate(
      () =>
        performance.getEntriesByName('bloomjoy.portal.dashboard_data_ready').length === 0,
    ),
    'Dashboard data-ready mark must remain absent while the primary current-work signal is gated.',
  );
  await assert(
    (await loadingDashboardPage.locator('[data-dashboard-attention-empty]').count()) === 0,
    'Loading dashboard must not claim that the user is caught up.',
  );
  await loadingDashboardPage.screenshot({
    path: path.join(outputDir, 'portal-dashboard-loading-mobile.png'),
    fullPage: true,
  });
  await assertDashboardExperience(loadingDashboardPage, {
    label: 'Resolved delayed timekeeper dashboard',
    expectedPrimaryHref: '/portal/time/new',
    primaryInFirstViewport: true,
  });
  await assertDashboardPrimaryNavigation(loadingDashboardPage, {
    label: 'Profile-only timekeeper dashboard',
    expectedPath: '/portal/time/new',
  });
  await loadingDashboardPage.close();

  const errorDashboardPage = await createPageForPersona(
    browser,
    personas.timekeeper,
    {
      width: 1366,
      height: 768,
    },
    { dashboardStatusFailureAttempts: 4 },
  );
  await errorDashboardPage.goto(`${appUrl}/portal`, { waitUntil: 'domcontentloaded' });
  await errorDashboardPage.locator('[data-dashboard-error-state]').waitFor({
    timeout: 20_000,
  });
  await assertDashboardExperience(errorDashboardPage, {
    label: 'Unavailable timekeeper dashboard',
    expectedPrimaryHref: '/portal/time',
    expectedState: 'error',
  });
  await errorDashboardPage.screenshot({
    path: path.join(outputDir, 'portal-dashboard-error-desktop.png'),
    fullPage: true,
  });
  await errorDashboardPage.getByRole('button', { name: 'Retry status' }).click();
  await errorDashboardPage
    .locator('[data-dashboard-primary-action][href="/portal/time/new"]')
    .waitFor();
  await errorDashboardPage.locator('[data-dashboard-error-state]').waitFor({ state: 'hidden' });
  await assertDashboardExperience(errorDashboardPage, {
    label: 'Recovered timekeeper dashboard',
    expectedPrimaryHref: '/portal/time/new',
  });
  await errorDashboardPage.close();

  const completedTrainingRecords = requiredTrainingIds.map((trainingId) => ({
    training_id: trainingId,
    started_at: '2026-06-01T00:00:00.000Z',
    completed_at: '2026-06-02T00:00:00.000Z',
    completion_source: 'uat',
  }));
  const completedDashboardPage = await createPageForPersona(
    browser,
    personas.plusMember,
    {
      width: 1366,
      height: 768,
    },
    {
      trainingProgressRecords: completedTrainingRecords,
      onboardingCompletedStepIds: ['1', '2', '3', '4', '5'],
    },
  );
  await completedDashboardPage.goto(`${appUrl}/portal`, { waitUntil: 'networkidle' });
  await completedDashboardPage.locator('[data-dashboard-empty-state]').waitFor();
  await assertDashboardExperience(completedDashboardPage, {
    label: 'Completed Plus dashboard',
    expectedPrimaryHref: '/portal/training',
    expectedState: 'empty',
  });
  await completedDashboardPage.screenshot({
    path: path.join(outputDir, 'portal-dashboard-empty-desktop.png'),
    fullPage: true,
  });
  await assertDashboardPrimaryNavigation(completedDashboardPage, {
    label: 'Completed Plus dashboard',
    expectedPath: '/portal/training',
  });
  await completedDashboardPage.close();

  const accountPage = await createPageForPersona(browser, personas.customer, {
    width: 1366,
    height: 768,
  });
  await accountPage.goto(`${appUrl}/portal/account`, { waitUntil: 'networkidle' });
  await waitForHeading(
    accountPage,
    { name: 'Account Settings', level: 1 },
    'portal-shell-account-desktop-debug-failed.png',
  );
  await assert(
    (await visibleLanguageControls(accountPage).count()) === 1,
    'Account Settings must render exactly one visible language preference.',
  );
  await accountPage.getByText('Preferences', { exact: true }).waitFor();
  const accountLanguageButtons = visibleLanguageControls(accountPage).locator('button');
  const accountLanguageButtonBoxes = await accountLanguageButtons.evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }),
  );
  await assert(
    accountLanguageButtonBoxes.every((box) => box.width >= 44 && box.height >= 44),
    'Account language targets must be at least 44 by 44 CSS px.',
  );
  await accountPage.screenshot({
    path: path.join(outputDir, 'portal-shell-account-desktop-en.png'),
    fullPage: true,
  });
  const chineseLanguageButton = accountPage.getByRole('button', {
    name: '简体中文',
    exact: true,
  });
  await accountPage.keyboard.press('Tab');
  await chineseLanguageButton.focus();
  const accountFocusState = await chineseLanguageButton.evaluate((button) => ({
    focusVisible: button.matches(':focus-visible'),
    boxShadow: getComputedStyle(button).boxShadow,
  }));
  await assert(
    accountFocusState.focusVisible && accountFocusState.boxShadow !== 'none',
    'Account language buttons must expose a visible keyboard focus ring.',
  );
  await chineseLanguageButton.click();
  await waitForHeading(
    accountPage,
    { name: '账户设置 / Account Settings', level: 1 },
    'portal-shell-account-zh-debug-failed.png',
  );
  await accountPage.getByText('已保存在此设备，并已同步到您的账号。', { exact: true }).waitFor();
  await assert(
    (await accountPage.evaluate(
      () => window.localStorage.getItem('bloomjoy.language.v1'),
    )) === 'zh-Hans',
    'Language switching must persist the Chinese preference locally.',
  );
  const chineseAccountNav = await textContent(
    accountPage.locator('aside nav a[href="/portal/account"]'),
  );
  await assert(
    chineseAccountNav.includes('账户设置 / Account Settings'),
    'Account Settings must remain recognizable when the current language is Chinese.',
  );
  await accountPage.reload({ waitUntil: 'networkidle' });
  await waitForHeading(
    accountPage,
    { name: '账户设置 / Account Settings', level: 1 },
    'portal-shell-account-refresh-debug-failed.png',
  );
  await accountPage.screenshot({
    path: path.join(outputDir, 'portal-shell-account-desktop-zh.png'),
    fullPage: true,
  });
  await accountPage.close();

  const accountSyncFailurePage = await createPageForPersona(
    browser,
    personas.customer,
    { width: 1366, height: 768 },
    { failLanguageSync: true },
  );
  await accountSyncFailurePage.goto(`${appUrl}/portal/account`, { waitUntil: 'networkidle' });
  await waitForHeading(
    accountSyncFailurePage,
    { name: 'Account Settings', level: 1 },
    'portal-shell-account-sync-failure-debug-failed.png',
  );
  await accountSyncFailurePage
    .getByText('Saved on this device. Account sync is unavailable; try again later.', {
      exact: true,
    })
    .waitFor();
  await accountSyncFailurePage.getByRole('button', { name: '简体中文', exact: true }).click();
  await accountSyncFailurePage
    .getByText('已保存在此设备。账号同步暂不可用，请稍后再试。', { exact: true })
    .waitFor();
  await assert(
    (await accountSyncFailurePage.evaluate(
      () => window.localStorage.getItem('bloomjoy.language.v1'),
    )) === 'zh-Hans',
    'A profile-sync failure must not block device-local language persistence.',
  );
  await accountSyncFailurePage.close();

  const mobileAccountPage = await createPageForPersona(browser, personas.customer, {
    width: 390,
    height: 844,
  });
  await mobileAccountPage.goto(`${appUrl}/portal/account`, { waitUntil: 'networkidle' });
  await waitForHeading(
    mobileAccountPage,
    { name: 'Account Settings', level: 1 },
    'portal-shell-account-mobile-debug-failed.png',
  );
  await assert(
    (await visibleLanguageControls(mobileAccountPage).count()) === 1,
    'Mobile Account Settings must render exactly one language preference.',
  );
  await assertNoHorizontalOverflow(mobileAccountPage, 'Account Settings mobile');
  await mobileAccountPage.screenshot({
    path: path.join(outputDir, 'portal-shell-account-mobile.png'),
    fullPage: true,
  });
  await mobileAccountPage.close();

  const reportingPage = await createPageForPersona(browser, personas.admin, {
    width: 1366,
    height: 768,
  });
  await reportingPage.goto(`${appUrl}/portal/reports`, { waitUntil: 'networkidle' });
  await waitForHeading(
    reportingPage,
    { name: 'Reporting', level: 1 },
    'portal-shell-reporting-desktop-debug-failed.png',
  );
  await assertActionTreatment(
    reportingPage,
    '[data-portal-report-export="operator-pdf"]',
    'Reporting PDF export',
  );
  await assertHeaderAlignment(reportingPage, 'Reporting desktop shell');
  await reportingPage.screenshot({
    path: path.join(outputDir, 'portal-shell-reporting-desktop.png'),
    fullPage: true,
  });
  await reportingPage.close();

  const mobileReportingPage = await createPageForPersona(browser, personas.admin, {
    width: 390,
    height: 844,
  });
  await mobileReportingPage.goto(`${appUrl}/portal/reports`, { waitUntil: 'networkidle' });
  await waitForHeading(
    mobileReportingPage,
    { name: 'Reporting', level: 1 },
    'portal-shell-reporting-mobile-debug-failed.png',
  );
  await mobileReportingPage.locator('[data-portal-report-export="operator-pdf"]').waitFor();
  await assertNoHorizontalOverflow(mobileReportingPage, 'Reporting mobile');
  await mobileReportingPage.screenshot({
    path: path.join(outputDir, 'portal-shell-reporting-mobile.png'),
    fullPage: true,
  });
  await mobileReportingPage.close();

  const startedTrainingRecords = [
    {
      training_id: 'software-setup-quickstart',
      started_at: '2026-06-01T00:00:00.000Z',
      completed_at: null,
      completion_source: null,
    },
  ];
  const plusDashboardPage = await createPageForPersona(browser, personas.plusMember, {
    width: 1366,
    height: 768,
  }, { trainingProgressRecords: startedTrainingRecords });
  await plusDashboardPage.goto(`${appUrl}/portal`, { waitUntil: 'networkidle' });
  await assertDashboardExperience(plusDashboardPage, {
    label: 'Plus member dashboard',
    expectedPrimaryHref: '/portal/onboarding',
  });
  await assert(
    (await plusDashboardPage.getByText(/not checked on this device/i).count()) > 0,
    'Plus setup progress must be labeled as device-local rather than authoritative account state.',
  );
  await plusDashboardPage.screenshot({
    path: path.join(outputDir, 'portal-dashboard-plus-desktop.png'),
    fullPage: true,
  });
  await assertDashboardPrimaryNavigation(plusDashboardPage, {
    label: 'Plus member dashboard',
    expectedPath: '/portal/onboarding',
  });
  await plusDashboardPage.close();

  const reportingTechnicianDashboardPage = await createPageForPersona(
    browser,
    personas.reportingTechnician,
    {
      width: 1366,
      height: 768,
    },
    { trainingProgressRecords: startedTrainingRecords },
  );
  await reportingTechnicianDashboardPage.goto(`${appUrl}/portal`, {
    waitUntil: 'networkidle',
  });
  await assertDashboardExperience(reportingTechnicianDashboardPage, {
    label: 'Reporting Technician dashboard',
    expectedPrimaryHref: '/portal/reports',
  });
  await assert(
    (await reportingTechnicianDashboardPage.locator('main a[href="/portal/account"]').count()) ===
      0,
    'Reporting Technician dashboard must not expose Account Settings.',
  );
  await reportingTechnicianDashboardPage.screenshot({
    path: path.join(outputDir, 'portal-dashboard-reporting-technician-desktop.png'),
    fullPage: true,
  });
  await assertDashboardPrimaryNavigation(reportingTechnicianDashboardPage, {
    label: 'Reporting Technician dashboard',
    expectedPath: '/portal/reports',
  });
  await reportingTechnicianDashboardPage.close();

  const partnerDashboardPage = await createPageForPersona(
    browser,
    personas.corporatePartner,
    {
      width: 1366,
      height: 768,
    },
  );
  await partnerDashboardPage.goto(`${appUrl}/portal`, { waitUntil: 'networkidle' });
  await assertDashboardExperience(partnerDashboardPage, {
    label: 'Corporate Partner dashboard',
    expectedPrimaryHref: '/portal/reports',
  });
  const partnerDashboardText = await textContent(
    partnerDashboardPage.locator('[data-dashboard-state]'),
  );
  await assert(
    !/Plus Membership|Admin Console/.test(partnerDashboardText),
    'Corporate Partner dashboard must not expose Plus upsell or admin-only concepts.',
  );
  await assertDashboardPrimaryNavigation(partnerDashboardPage, {
    label: 'Corporate Partner dashboard',
    expectedPath: '/portal/reports',
  });
  await partnerDashboardPage.close();

  const scopedAdminPage = await createPageForPersona(browser, personas.scopedAdmin, {
    width: 1366,
    height: 768,
  });
  await scopedAdminPage.goto(`${appUrl}/portal`, { waitUntil: 'networkidle' });
  await assertDashboardExperience(scopedAdminPage, {
    label: 'Orders-scoped Admin dashboard',
    expectedPrimaryHref: '/admin/orders',
  });
  await scopedAdminPage.screenshot({
    path: path.join(outputDir, 'portal-dashboard-scoped-admin-desktop.png'),
    fullPage: true,
  });
  await assertDashboardPrimaryNavigation(scopedAdminPage, {
    label: 'Orders-scoped Admin dashboard',
    expectedPath: '/admin/orders',
  });
  await scopedAdminPage.locator('[data-app-shell-content-header]').waitFor();
  await assertHeaderAlignment(scopedAdminPage, 'Scoped Admin desktop shell');
  const scopedHeaderFitsEnglish = await scopedAdminPage
    .locator('[data-app-shell-content-header]')
    .evaluate((header) => {
      const content = header.firstElementChild;
      return content.scrollHeight <= content.clientHeight + 1;
    });
  await assert(scopedHeaderFitsEnglish, 'Scoped Admin English header must fit its fixed desktop row.');
  await scopedAdminPage.evaluate(() => {
    window.localStorage.setItem('bloomjoy.language.v1', 'zh-Hans');
  });
  await scopedAdminPage.reload({ waitUntil: 'networkidle' });
  await assertHeaderAlignment(scopedAdminPage, 'Scoped Admin Chinese desktop shell');
  const scopedHeaderFitsChinese = await scopedAdminPage
    .locator('[data-app-shell-content-header]')
    .evaluate((header) => {
      const content = header.firstElementChild;
      return content.scrollHeight <= content.clientHeight + 1;
    });
  await assert(scopedHeaderFitsChinese, 'Scoped Admin Chinese header must fit its fixed desktop row.');
  await scopedAdminPage.screenshot({
    path: path.join(outputDir, 'portal-shell-scoped-admin-desktop-zh.png'),
    fullPage: true,
  });
  await scopedAdminPage.close();

  const trainingPage = await createPageForPersona(
    browser,
    personas.training,
    {
      width: 1366,
      height: 768,
    },
    { trainingProgressRecords: startedTrainingRecords },
  );
  await trainingPage.goto(`${appUrl}/portal`, { waitUntil: 'networkidle' });
  await waitForHeading(
    trainingPage,
    { name: 'Welcome back', level: 1 },
    'portal-shell-training-debug-failed.png',
  );
  await assert(
    (await trainingPage.locator('aside nav a[href="/portal/account"]').count()) === 0,
    'Training-only permissions must not be broadened to expose Account Settings.',
  );
  await assert(
    (await visibleLanguageControls(trainingPage).count()) === 0,
    'Training-only authenticated shell must not reintroduce the language selector.',
  );
  await assertDashboardExperience(trainingPage, {
    label: 'Training-only dashboard',
    expectedPrimaryHref: '/portal/training/software-setup-quickstart',
  });
  await assert(
    (await trainingPage.locator('main a[href="/portal/orders"]').count()) === 0 &&
      (await trainingPage.locator('main a[href="/portal/team"]').count()) === 0 &&
      (await trainingPage.locator('main a[href^="/admin"]').count()) === 0,
    'Training-only dashboard must not expose owner, Team, or Admin work.',
  );
  await trainingPage.screenshot({
    path: path.join(outputDir, 'portal-dashboard-training-desktop.png'),
    fullPage: true,
  });
  await assertDashboardPrimaryNavigation(trainingPage, {
    label: 'Training-only dashboard',
    expectedPath: '/portal/training/software-setup-quickstart',
  });
  await trainingPage.getByRole('button', { name: 'Open profile menu' }).click();
  await trainingPage.getByText('Sign Out', { exact: true }).waitFor();
  await trainingPage.close();

  await assert(
    unexpectedBrowserErrors.length === 0,
    `Authenticated portal UAT encountered unexpected browser errors:\n${unexpectedBrowserErrors.join('\n')}`,
  );
  console.log(`Authenticated portal UAT passed at ${appUrl}`);
  console.log(`Screenshots written to ${path.relative(repoRoot, outputDir)}`);
} finally {
  await browser.close();
}
