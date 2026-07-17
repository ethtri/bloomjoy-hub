import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(repoRoot, 'output', 'playwright');

const getArg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const appUrl = getArg('--app-url', 'http://127.0.0.1:8081');
const expiresAt = Math.floor(Date.now() / 1000) + 3600;
const criticalAccessRpcs = [
  'get_my_plus_access',
  'get_my_admin_access_context',
  'get_my_portal_access_context',
  'get_my_reporting_access_context',
];

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

const personas = {
  baseline: {
    id: '00000000-0000-4000-9000-000000000594',
    email: 'performance-uat@bloomjoy.localhost',
    isAdmin: false,
    pendingTechnician: false,
  },
  pendingTechnician: {
    id: '00000000-0000-4000-9000-000000000595',
    email: 'pending-technician-uat@bloomjoy.localhost',
    isAdmin: false,
    pendingTechnician: true,
  },
  admin: {
    id: '00000000-0000-4000-9000-000000000596',
    email: 'performance-admin-uat@bloomjoy.localhost',
    isAdmin: true,
    pendingTechnician: false,
  },
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

const rpcResponse = (rpcName, persona, state) => {
  switch (rpcName) {
    case 'resolve_my_technician_entitlements':
      return {
        technicianEmail: persona.email,
        resolvedGrantCount: persona.pendingTechnician ? 1 : 0,
        resolvedOperatorTrainingGrantCount: persona.pendingTechnician ? 1 : 0,
        upsertedReportingEntitlementCount: persona.pendingTechnician ? 1 : 0,
        skippedGrantCount: 0,
      };
    case 'get_my_plus_access':
      return {
        has_plus_access: persona.isAdmin,
        source: persona.isAdmin ? 'subscription' : null,
        membership_status: persona.isAdmin ? 'active' : 'none',
        current_period_end: null,
        cancel_at_period_end: false,
        paid_subscription_active: persona.isAdmin,
        free_grant_id: null,
        free_grant_starts_at: null,
        free_grant_expires_at: null,
        free_grant_active: false,
      };
    case 'get_my_admin_access_context':
      return {
        isSuperAdmin: persona.isAdmin,
        isScopedAdmin: false,
        canAccessAdmin: persona.isAdmin,
        allowedSurfaces: persona.isAdmin ? ['*'] : [],
        scopedMachineIds: [],
      };
    case 'get_my_portal_access_context':
      return {
        access_tier:
          persona.isAdmin ? 'plus' : persona.pendingTechnician && state.resolutionCompleted
            ? 'training'
            : 'baseline',
        is_plus_member: persona.isAdmin,
        is_training_operator: persona.pendingTechnician && state.resolutionCompleted,
        is_admin: persona.isAdmin,
        can_manage_operator_training: persona.isAdmin,
        is_corporate_partner: false,
        has_supply_discount: persona.isAdmin,
        can_request_support: persona.isAdmin,
        can_manage_technicians: false,
        capabilities:
          persona.pendingTechnician && state.resolutionCompleted
            ? ['reports.partner.view']
            : persona.isAdmin
              ? ['*']
              : [],
        effective_presets: [],
      };
    case 'get_my_reporting_access_context':
      return {
        has_reporting_access:
          persona.isAdmin || (persona.pendingTechnician && state.resolutionCompleted),
        accessible_machine_count:
          persona.isAdmin || (persona.pendingTechnician && state.resolutionCompleted) ? 1 : 0,
        accessible_location_count:
          persona.isAdmin || (persona.pendingTechnician && state.resolutionCompleted) ? 1 : 0,
        can_manage_reporting: persona.isAdmin,
        latest_sale_date: null,
        latest_import_completed_at: null,
      };
    case 'get_my_operator_timekeeping_context':
      return { workDate: '2026-07-17', profiles: [] };
    case 'get_my_technician_management_context':
      return { canManage: false, seatCap: null, accounts: [] };
    case 'admin_get_account_summaries':
    case 'admin_get_audit_log':
    case 'admin_list_scoped_admin_grants':
      return [];
    default:
      return {};
  }
};

const fulfillJson = (route, body) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

const createHarness = async (
  browser,
  persona,
  {
    blockResolver = false,
    resolverDelayMs = 0,
    accessDelayMs = 0,
    seedSession = true,
    language = 'en',
    viewport = { width: 1366, height: 768 },
  } = {},
) => {
  const context = await browser.newContext({ viewport });
  const session = makeSession(persona);
  const state = {
    resolutionCompleted: false,
    resolutionCompletedAt: null,
    dashboardRequestAt: null,
    rpcCounts: new Map(),
    rpcStartTimes: new Map(),
    rpcTimeline: [],
  };
  let releaseResolver;
  const resolverGate = blockResolver
    ? new Promise((resolve) => {
        releaseResolver = resolve;
      })
    : null;

  await context.addInitScript(
    ({ sessionValue, shouldSeedSession, storedLanguage }) => {
      window.__bloomjoyPerformanceEvents = [];
      window.__bloomjoyAuthStorageKey = null;
      window.localStorage.setItem('bloomjoy.language.v1', storedLanguage);
      window.posthog = {
        capture(name, properties) {
          window.__bloomjoyPerformanceEvents.push({ name, properties });
        },
        identify() {},
      };

      const serializedSession = JSON.stringify(sessionValue);
      const isSupabaseAuthKey = (key) =>
        typeof key === 'string' && /^sb-.+-auth-token$/.test(key);
      const originalGetItem = Storage.prototype.getItem;
      const originalSetItem = Storage.prototype.setItem;

      Storage.prototype.getItem = function getItem(key) {
        if (isSupabaseAuthKey(key)) {
          window.__bloomjoyAuthStorageKey = key;
          return shouldSeedSession ? serializedSession : originalGetItem.call(this, key);
        }

        return originalGetItem.call(this, key);
      };

      Storage.prototype.setItem = function setItem(key, nextValue) {
        if (isSupabaseAuthKey(key)) {
          window.__bloomjoyAuthStorageKey = key;
          return originalSetItem.call(
            this,
            key,
            shouldSeedSession ? serializedSession : nextValue,
          );
        }

        return originalSetItem.call(this, key, nextValue);
      };
    },
    { sessionValue: session, shouldSeedSession: seedSession, storedLanguage: language },
  );

  await context.route('**/auth/v1/user', (route) => fulfillJson(route, makeUser(persona)));
  await context.route('**/auth/v1/token**', (route) => fulfillJson(route, session));
  await context.route('**/rest/v1/**', async (route) => {
    const requestUrl = new URL(route.request().url());

    if (!requestUrl.pathname.includes('/rest/v1/rpc/')) {
      return fulfillJson(route, []);
    }

    const rpcName = decodeURIComponent(requestUrl.pathname.split('/').pop());
    state.rpcTimeline.push({ rpcName, phase: 'start', at: Date.now() });
    state.rpcCounts.set(rpcName, (state.rpcCounts.get(rpcName) ?? 0) + 1);
    if (!state.rpcStartTimes.has(rpcName)) {
      state.rpcStartTimes.set(rpcName, Date.now());
    }

    if (rpcName === 'resolve_my_technician_entitlements') {
      if (resolverGate) {
        await resolverGate;
      }
      if (resolverDelayMs > 0) {
        await wait(resolverDelayMs);
      }
      state.resolutionCompleted = true;
      state.resolutionCompletedAt = Date.now();
    } else if (criticalAccessRpcs.includes(rpcName) && accessDelayMs > 0) {
      await wait(accessDelayMs);
    }

    state.rpcTimeline.push({ rpcName, phase: 'end', at: Date.now() });
    return fulfillJson(route, rpcResponse(rpcName, persona, state));
  });

  const page = await context.newPage();
  page.on('request', (request) => {
    const requestUrl = request.url();
    if (
      state.dashboardRequestAt === null &&
      (requestUrl.includes('/pages/portal/Dashboard') ||
        /\/Dashboard-[A-Za-z0-9_-]+\.js(?:\?|$)/.test(requestUrl))
    ) {
      state.dashboardRequestAt = Date.now();
    }
  });
  page.on('pageerror', (error) => {
    console.error(`[${persona.email}] page error: ${error.message}`);
  });

  return {
    context,
    page,
    state,
    releaseResolver: () => releaseResolver?.(),
  };
};

const waitForPerformanceMark = async (page, markName) => {
  await page.waitForFunction(
    (name) => performance.getEntriesByName(name, 'mark').length > 0,
    markName,
  );
};

const broadcastAuthEvent = async (page, event, session) => {
  await page.waitForFunction(() => Boolean(window.__bloomjoyAuthStorageKey));
  await page.evaluate(
    ({ eventName, sessionValue }) => {
      const channel = new BroadcastChannel(window.__bloomjoyAuthStorageKey);
      channel.postMessage({ event: eventName, session: sessionValue });
      channel.close();
    },
    { eventName: event, sessionValue: session },
  );
};

const broadcastAuthEvents = async (page, events) => {
  await page.waitForFunction(() => Boolean(window.__bloomjoyAuthStorageKey));
  await page.evaluate((eventValues) => {
    const channel = new BroadcastChannel(window.__bloomjoyAuthStorageKey);
    for (const eventValue of eventValues) {
      channel.postMessage(eventValue);
    }
    channel.close();
  }, events);
};

const waitForNodeCondition = async (condition, message, timeoutMs = 3_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await wait(20);
  }

  throw new Error(message);
};

const getPerformanceState = (page) =>
  page.evaluate(() => {
    const getMark = (name) => performance.getEntriesByName(name, 'mark').at(-1)?.startTime;
    const session = getMark('bloomjoy.portal.session_accepted');
    const shell = getMark('bloomjoy.portal.shell_visible');
    const access = getMark('bloomjoy.portal.access_ready');
    const dashboard = getMark('bloomjoy.portal.dashboard_visible');
    const dashboardData = getMark('bloomjoy.portal.dashboard_data_ready');

    return {
      names: performance
        .getEntries()
        .filter((entry) => entry.name.startsWith('bloomjoy.portal.'))
        .map((entry) => entry.name),
      navigationToShell: shell ?? null,
      sessionToShell:
        session === undefined || shell === undefined ? null : Math.max(0, shell - session),
      sessionToAccess: session === undefined || access === undefined ? null : access - session,
      sessionToDashboard:
        session === undefined || dashboard === undefined ? null : dashboard - session,
      sessionToDashboardData:
        session === undefined || dashboardData === undefined ? null : dashboardData - session,
      events: window.__bloomjoyPerformanceEvents ?? [],
    };
  });

const assertSingleCriticalBootstrap = (state, label) => {
  assert(
    state.rpcCounts.get('resolve_my_technician_entitlements') === 1,
    `${label}: entitlement resolution should run exactly once.`,
  );
  for (const rpcName of criticalAccessRpcs) {
    assert(
      state.rpcCounts.get(rpcName) === 1,
      `${label}: ${rpcName} should run exactly once.`,
    );
  }
};

const assertAccessStartsAfterResolution = (state, label) => {
  for (const rpcName of criticalAccessRpcs) {
    assert(
      (state.rpcStartTimes.get(rpcName) ?? 0) >= (state.resolutionCompletedAt ?? Infinity),
      `${label}: ${rpcName} must not read stale access before entitlement resolution completes.`,
    );
  }
};

const validateLifecycleSource = () => {
  const authSource = fs.readFileSync(path.join(repoRoot, 'src/contexts/AuthContext.tsx'), 'utf8');
  const loginSource = fs.readFileSync(path.join(repoRoot, 'src/pages/Login.tsx'), 'utf8');
  const routeSource = fs.readFileSync(path.join(repoRoot, 'src/lib/portalRouteModules.ts'), 'utf8');

  assert(
    authSource.includes("event === 'TOKEN_REFRESHED'") &&
      authSource.includes('isAlreadyHydrating || isAlreadyReady'),
    'Auth bootstrap must ignore token refreshes for the active hydrated session.',
  );
  assert(
    authSource.includes('generation !== bootstrapGenerationRef.current') &&
      authSource.includes('scheduledGeneration !== bootstrapGenerationRef.current') &&
      authSource.includes('retryGeneration !== bootstrapGenerationRef.current') &&
      authSource.includes('bootstrapGenerationRef.current += 1'),
    'Auth bootstrap must invalidate queued, active, and retry hydration work after sign-out or user change.',
  );
  assert(
    !authSource.includes('void hydrateSession()'),
    'Initial auth should have one onAuthStateChange source, not a parallel getSession hydration.',
  );
  assert(
    loginSource.includes('if (hasAuthenticatedSession)'),
    'Login should hand off to the permission-neutral shell as soon as the session is accepted.',
  );
  assert(
    routeSource.includes("import('@/pages/portal/Dashboard')") &&
      routeSource.includes('loadPortalDashboard().catch(() => undefined)') &&
      authSource.includes("routeCategory === 'portal-dashboard'"),
    'The portal dashboard module must preload safely only for the dashboard route.',
  );
};

fs.mkdirSync(outputDir, { recursive: true });
validateLifecycleSource();

const browser = await chromium.launch();

try {
  const anonymousContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const anonymousPage = await anonymousContext.newPage();
  await anonymousPage.goto(`${appUrl}/portal`, { waitUntil: 'domcontentloaded' });
  await anonymousPage.waitForURL((url) => url.pathname === '/login' && url.searchParams.has('next'));
  assert(
    new URL(anonymousPage.url()).searchParams.get('next') === '/portal',
    'Signed-out portal visits should retain the safe return path when redirecting to login.',
  );
  await anonymousContext.close();

  const delayed = await createHarness(browser, personas.baseline, {
    blockResolver: true,
  });
  await delayed.page.goto(`${appUrl}/portal`, { waitUntil: 'domcontentloaded' });
  await delayed.page
    .getByText(/Checking your secure session|Preparing your workspace/)
    .first()
    .waitFor();
  await waitForPerformanceMark(delayed.page, 'bloomjoy.portal.shell_visible');

  const delayedTiming = await getPerformanceState(delayed.page);
  assert(
    delayedTiming.navigationToShell !== null && delayedTiming.navigationToShell < 2_000,
    `Delayed bootstrap shell should appear within 2s of navigation; measured ${delayedTiming.navigationToShell}ms.`,
  );
  assert(
    criticalAccessRpcs.every((rpcName) => !delayed.state.rpcCounts.has(rpcName)),
    'Access RPCs must wait for first-login entitlement resolution.',
  );
  assert(
    delayed.state.dashboardRequestAt !== null,
    'Portal dashboard module should preload before access hydration completes.',
  );
  const delayedBody = await delayed.page.locator('body').innerText();
  assert(
    !/Loading\.\.\.|Admin Console|Reporting|Team|Timekeeping|Upgrade to Plus/.test(delayedBody),
    'Unknown access must show a neutral shell without generic loading or capability-sensitive labels.',
  );
  await delayed.page.screenshot({
    path: path.join(outputDir, 'portal-bootstrap-delayed-shell.png'),
    fullPage: true,
  });
  await delayed.page.setViewportSize({ width: 390, height: 844 });
  const mobileOverflow = await delayed.page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert(mobileOverflow <= 1, 'Permission-neutral loading shell must not overflow at 390px.');
  await delayed.page.screenshot({
    path: path.join(outputDir, 'portal-bootstrap-delayed-shell-mobile.png'),
    fullPage: true,
  });
  const statusInsideBusyRegion = await delayed.page
    .locator('[role="status"]')
    .evaluate((element) => Boolean(element.closest('[aria-busy="true"]')));
  assert(
    !statusInsideBusyRegion,
    'Loading status must remain announceable outside the busy decorative region.',
  );
  assert(
    (await delayed.page.getByRole('navigation').count()) === 0,
    'Decorative loading placeholders must not create an empty navigation landmark.',
  );
  await delayed.page.emulateMedia({ reducedMotion: 'reduce' });
  const animatedPlaceholderCount = await delayed.page.evaluate(
    () =>
      [...document.querySelectorAll('.animate-pulse')].filter(
        (element) => getComputedStyle(element).animationName !== 'none',
      ).length,
  );
  assert(
    animatedPlaceholderCount === 0,
    'Loading placeholders must stop pulsing when reduced motion is requested.',
  );
  await delayed.page.getByText('Still checking your access securely…').waitFor({
    timeout: 9_000,
  });
  assert(
    await delayed.page.getByRole('button', { name: 'Sign out' }).isVisible(),
    'A stalled access check should expose Sign out.',
  );

  delayed.releaseResolver();
  await delayed.page.getByRole('heading', { name: 'Welcome back', level: 1 }).waitFor();
  await waitForPerformanceMark(delayed.page, 'bloomjoy.portal.dashboard_visible');
  await waitForPerformanceMark(delayed.page, 'bloomjoy.portal.dashboard_data_ready');
  assertSingleCriticalBootstrap(delayed.state, 'Delayed baseline');
  assertAccessStartsAfterResolution(delayed.state, 'Delayed baseline');
  await delayed.context.close();

  const normal = await createHarness(browser, personas.baseline, {
    resolverDelayMs: 100,
    accessDelayMs: 75,
  });
  await normal.page.goto(`${appUrl}/portal`, { waitUntil: 'domcontentloaded' });
  await normal.page.getByRole('heading', { name: 'Welcome back', level: 1 }).waitFor();
  await waitForPerformanceMark(normal.page, 'bloomjoy.portal.dashboard_visible');
  await waitForPerformanceMark(normal.page, 'bloomjoy.portal.dashboard_data_ready');
  const normalTiming = await getPerformanceState(normal.page);

  assert(
    normalTiming.navigationToShell !== null && normalTiming.navigationToShell < 2_000,
    `Normal bootstrap shell should appear within 2s of navigation; measured ${normalTiming.navigationToShell}ms.`,
  );
  assert(
    normalTiming.sessionToDashboard !== null && normalTiming.sessionToDashboard < 3_000,
    `Useful portal content should appear in under 3s; measured ${normalTiming.sessionToDashboard}ms.`,
  );
  assert(
    normalTiming.sessionToDashboardData !== null &&
      normalTiming.sessionToDashboardData >= normalTiming.sessionToDashboard,
    'Dashboard data-ready timing must be recorded after useful dashboard content is visible.',
  );
  assert(
    normalTiming.sessionToDashboardData !== null &&
      normalTiming.sessionToDashboardData < 3_000,
    `Normal dashboard data should be ready within 3s; measured ${normalTiming.sessionToDashboardData}ms.`,
  );
  assertSingleCriticalBootstrap(normal.state, 'Normal baseline');
  assertAccessStartsAfterResolution(normal.state, 'Normal baseline');

  const timingEvents = normalTiming.events.filter(
    (event) => event.name === 'portal_bootstrap_timing',
  );
  assert(timingEvents.length === 1, 'Portal bootstrap timing analytics should emit exactly once.');
  const timingPayloadText = JSON.stringify(timingEvents[0]);
  assert(
    !timingPayloadText.includes(personas.baseline.email) &&
      !timingPayloadText.includes(personas.baseline.id) &&
      !timingPayloadText.includes('uat-access-token') &&
      normalTiming.names.every((name) => /^bloomjoy\.portal\.[a-z_]+$/.test(name)),
    'Portal timing marks and analytics must not contain identity, token, machine, or account data.',
  );

  const countsBeforeRefresh = new Map(normal.state.rpcCounts);
  await broadcastAuthEvent(normal.page, 'TOKEN_REFRESHED', makeSession(personas.baseline));
  await broadcastAuthEvent(normal.page, 'SIGNED_IN', makeSession(personas.baseline));
  await normal.page.waitForTimeout(200);
  for (const rpcName of ['resolve_my_technician_entitlements', ...criticalAccessRpcs]) {
    assert(
      normal.state.rpcCounts.get(rpcName) === countsBeforeRefresh.get(rpcName),
      `${rpcName} must not rerun for TOKEN_REFRESHED or repeated SIGNED_IN events.`,
    );
  }
  assert(
    await normal.page.getByRole('heading', { name: 'Welcome back', level: 1 }).isVisible(),
    'Token refresh and repeated SIGNED_IN events must not replace a ready dashboard.',
  );
  await normal.page.screenshot({
    path: path.join(outputDir, 'portal-bootstrap-normal-dashboard.png'),
    fullPage: true,
  });
  await normal.context.close();

  const technician = await createHarness(browser, personas.pendingTechnician, {
    resolverDelayMs: 150,
    accessDelayMs: 50,
  });
  await technician.page.goto(`${appUrl}/portal`, { waitUntil: 'domcontentloaded' });
  await technician.page.getByRole('heading', { name: 'Welcome back', level: 1 }).waitFor();
  assertSingleCriticalBootstrap(technician.state, 'Pending Technician');
  assertAccessStartsAfterResolution(technician.state, 'Pending Technician');
  assert(
    (await technician.page.locator('aside nav a[href="/portal/training"]').count()) === 1,
    'Newly resolved Technician should receive Training access on the first login.',
  );
  assert(
    (await technician.page.locator('aside nav a[href="/portal/reports"]').count()) === 1,
    'Newly resolved Technician should receive Reporting access on the first login.',
  );
  await technician.context.close();

  const accountRoute = await createHarness(browser, personas.baseline);
  await accountRoute.page.goto(`${appUrl}/portal/account`, { waitUntil: 'domcontentloaded' });
  await accountRoute.page
    .getByRole('heading', { name: 'Account Settings', level: 1 })
    .waitFor();
  await accountRoute.page.waitForTimeout(150);
  assert(
    accountRoute.state.dashboardRequestAt === null,
    'Portal subroutes must not preload the dashboard chunk and compete with their own route chunk.',
  );
  await accountRoute.context.close();

  const localized = await createHarness(browser, personas.baseline, {
    blockResolver: true,
    language: 'zh-Hans',
    viewport: { width: 390, height: 844 },
  });
  await localized.page.goto(`${appUrl}/portal`, { waitUntil: 'domcontentloaded' });
  await localized.page.getByText('正在准备您的工作区…').waitFor();
  localized.releaseResolver();
  await waitForPerformanceMark(localized.page, 'bloomjoy.portal.access_ready');
  await localized.context.close();

  const login = await createHarness(browser, personas.baseline, {
    seedSession: false,
  });
  await login.page.goto(`${appUrl}/login`, { waitUntil: 'domcontentloaded' });
  await login.page.getByLabel('Email address').fill(personas.baseline.email);
  await login.page.getByLabel('Password').fill('uat-password');
  await login.page.getByRole('button', { name: 'Sign in with password' }).click();
  await login.page.waitForURL((url) => url.pathname === '/portal');
  await login.page.getByRole('heading', { name: 'Welcome back', level: 1 }).waitFor();
  assertSingleCriticalBootstrap(login.state, 'Password sign-in');
  await login.context.close();

  const nonAdmin = await createHarness(browser, personas.baseline);
  await nonAdmin.page.goto(`${appUrl}/admin`, { waitUntil: 'domcontentloaded' });
  await nonAdmin.page
    .getByRole('heading', { name: 'Admin Access Required', level: 1 })
    .waitFor();
  assert(
    (await nonAdmin.page.getByRole('heading', { name: 'Overview', level: 1 }).count()) === 0,
    'A baseline session must not render Admin Console content after access resolves.',
  );
  await nonAdmin.context.close();

  const admin = await createHarness(browser, personas.admin, {
    blockResolver: true,
  });
  await admin.page.goto(`${appUrl}/admin`, { waitUntil: 'domcontentloaded' });
  await admin.page
    .getByText(/Checking your secure session|Preparing your workspace/)
    .first()
    .waitFor();
  const adminPendingBody = await admin.page.locator('body').innerText();
  assert(
    !/Admin Console|Administration|Customers|Partners & Reporting/.test(adminPendingBody),
    'Direct Admin load must not expose admin navigation until server-backed access is ready.',
  );
  admin.releaseResolver();
  await admin.page.getByRole('heading', { name: 'Overview', level: 1 }).waitFor();
  assertSingleCriticalBootstrap(admin.state, 'Delayed admin');
  await admin.context.close();

  const stale = await createHarness(browser, personas.baseline, {
    blockResolver: true,
  });
  await stale.page.goto(`${appUrl}/portal`, { waitUntil: 'domcontentloaded' });
  await waitForNodeCondition(
    () => stale.state.rpcCounts.get('resolve_my_technician_entitlements') === 1,
    'Stale-work test did not start entitlement resolution.',
  );
  await broadcastAuthEvent(stale.page, 'SIGNED_OUT', null);
  await stale.page.waitForURL((url) => url.pathname === '/login');
  stale.releaseResolver();
  await stale.page.waitForTimeout(250);
  assert(
    stale.page.url().includes('/login') &&
      (await stale.page.getByRole('heading', { name: 'Welcome back', level: 1 }).count()) === 0,
    'A stale in-flight bootstrap must not restore the signed-out user.',
  );
  const staleTiming = await getPerformanceState(stale.page);
  assert(
    !staleTiming.names.includes('bloomjoy.portal.access_ready'),
    'Stale bootstrap work must not mark authoritative access ready after sign-out.',
  );
  await stale.context.close();

  const rapidSignOut = await createHarness(browser, personas.baseline, {
    blockResolver: true,
    seedSession: false,
  });
  await rapidSignOut.page.goto(`${appUrl}/login`, { waitUntil: 'domcontentloaded' });
  await broadcastAuthEvents(rapidSignOut.page, [
    { event: 'SIGNED_IN', session: makeSession(personas.baseline) },
    { event: 'SIGNED_OUT', session: null },
  ]);
  await rapidSignOut.page.waitForTimeout(100);
  rapidSignOut.releaseResolver();
  await rapidSignOut.page.waitForTimeout(250);
  const rapidTiming = await getPerformanceState(rapidSignOut.page);
  assert(
    new URL(rapidSignOut.page.url()).pathname === '/login' &&
      !rapidTiming.names.includes('bloomjoy.portal.access_ready'),
    'A queued sign-in bootstrap must not resurrect a session after an immediate sign-out event.',
  );
  await rapidSignOut.context.close();

  const forcedRefresh = await createHarness(browser, personas.baseline, {
    blockResolver: true,
  });
  await forcedRefresh.page.goto(`${appUrl}/portal`, { waitUntil: 'domcontentloaded' });
  await waitForNodeCondition(
    () => forcedRefresh.state.rpcCounts.get('resolve_my_technician_entitlements') === 1,
    'Forced-refresh test did not start the initial entitlement resolution.',
  );
  await broadcastAuthEvents(forcedRefresh.page, [
    { event: 'USER_UPDATED', session: makeSession(personas.baseline) },
    { event: 'PASSWORD_RECOVERY', session: makeSession(personas.baseline) },
    { event: 'USER_UPDATED', session: makeSession(personas.baseline) },
  ]);
  await forcedRefresh.page.waitForTimeout(100);
  assert(
    forcedRefresh.state.rpcCounts.get('resolve_my_technician_entitlements') === 1,
    'Forced auth updates must coalesce while the current bootstrap is in flight.',
  );
  forcedRefresh.releaseResolver();
  await forcedRefresh.page.getByRole('heading', { name: 'Welcome back', level: 1 }).waitFor();
  await waitForNodeCondition(
    () => forcedRefresh.state.rpcCounts.get('resolve_my_technician_entitlements') === 2,
    'Coalesced auth update did not run one authoritative follow-up hydration.',
  );
  assert(
    forcedRefresh.state.rpcCounts.get('resolve_my_technician_entitlements') === 2 &&
      criticalAccessRpcs.every(
        (rpcName) => forcedRefresh.state.rpcCounts.get(rpcName) === 2,
      ),
    'Multiple forced auth events should coalesce into one sequential follow-up bootstrap.',
  );
  const resolverStarts = forcedRefresh.state.rpcTimeline.filter(
    (entry) =>
      entry.rpcName === 'resolve_my_technician_entitlements' && entry.phase === 'start',
  );
  const firstAccessEnds = criticalAccessRpcs.map(
    (rpcName) =>
      forcedRefresh.state.rpcTimeline.find(
        (entry) => entry.rpcName === rpcName && entry.phase === 'end',
      )?.at ?? 0,
  );
  assert(
    resolverStarts[1]?.at >= Math.max(...firstAccessEnds),
    'Forced access refresh must run sequentially after the current bootstrap, never concurrently.',
  );
  await forcedRefresh.context.close();

  console.log(`Portal bootstrap performance UAT passed at ${appUrl}`);
  console.log(
    `Measured normal navigation-to-shell ${Math.round(normalTiming.navigationToShell)}ms, session-to-shell ${Math.round(normalTiming.sessionToShell)}ms, session-to-dashboard ${Math.round(normalTiming.sessionToDashboard)}ms, and session-to-dashboard-data ${Math.round(normalTiming.sessionToDashboardData)}ms.`,
  );
  console.log('Verified shell <2s, useful dashboard <3s, single hydration, first-login access, and privacy.');
  console.log(`Screenshots written to ${path.relative(repoRoot, outputDir)}`);
} finally {
  await browser.close();
}
