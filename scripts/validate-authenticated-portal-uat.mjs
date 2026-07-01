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

const createPageForPersona = async (browser, persona, viewport) => {
  const context = await browser.newContext({ viewport });
  const session = makeSession(persona);

  await context.addInitScript(
    ({ value }) => {
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
    },
    { value: session },
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
  await context.route('**/rest/v1/rpc/**', (route) => {
    const rpcName = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
    if (debug) {
      console.log(`[${persona.email}] rpc ${rpcName}`);
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(rpcResponse(rpcName, persona)),
    });
  });
  await context.route('**/rest/v1/**', (route) =>
    {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.pathname.includes('/rest/v1/rpc/')) {
        const rpcName = decodeURIComponent(requestUrl.pathname.split('/').pop());
        if (debug) {
          console.log(`[${persona.email}] rpc ${rpcName}`);
        }

        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(rpcResponse(rpcName, persona)),
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
    if (message.type() === 'error') {
      console.error(`[${persona.email}] console error: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    console.error(`[${persona.email}] page error: ${error.message}`);
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
    adminNavText.indexOf('Operations') < adminNavText.indexOf('Customers') &&
      adminNavText.indexOf('Customers') < adminNavText.indexOf('Administration') &&
      adminNavText.indexOf('Administration') < adminNavText.indexOf('Partners & Reporting'),
    'Admin routes should order Operations, Customers, Administration, then Partners & Reporting.',
  );
  await assert(
    !adminNavText.includes('admin_roles') && !adminNavText.includes('is_super_admin'),
    'Visible admin nav must not expose implementation role names.',
  );

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

  const mobileAdminPage = await createPageForPersona(browser, personas.admin, {
    width: 390,
    height: 844,
  });
  await mobileAdminPage.goto(`${appUrl}/admin`, { waitUntil: 'networkidle' });
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
    mobileDrawerText.indexOf('Operations') < mobileDrawerText.indexOf('Customers') &&
      mobileDrawerText.indexOf('Customers') < mobileDrawerText.indexOf('Administration') &&
      mobileDrawerText.indexOf('Administration') < mobileDrawerText.indexOf('Partners & Reporting'),
    'Mobile admin drawer should expose the streamlined Admin Console IA order.',
  );
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

  console.log(`Authenticated portal UAT passed at ${appUrl}`);
  console.log(`Screenshots written to ${path.relative(repoRoot, outputDir)}`);
} finally {
  await browser.close();
}
