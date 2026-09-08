#!/usr/bin/env node

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_APP_URL = 'http://127.0.0.1:8081';
const DEFAULT_ARTIFACT_DIR = 'output/playwright/technician-weekly-time';
const FIXED_NOW = new Date('2026-09-03T19:00:00.000Z');
const WEEK_START = '2026-08-31';
const PROFILE_ID = '66000000-0000-4000-8000-000000000010';
const ACCOUNT_ID = '66000000-0000-4000-8000-000000000011';
const POLICY_ID = '66000000-0000-4000-8000-000000000013';
const LOCATION_ID = '66000000-0000-4000-8000-000000000015';
const MACHINE_A = '66000000-0000-4000-8000-000000000014';
const MACHINE_B = '66000000-0000-4000-8000-000000000024';

const parseArgs = (argv) => {
  const args = {
    appUrl: process.env.OPERATOR_TIMEKEEPING_UAT_APP_URL || DEFAULT_APP_URL,
    artifactDir:
      process.env.OPERATOR_TIMEKEEPING_UAT_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR,
    headed: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--headed') args.headed = true;
    if (argv[index] === '--app-url') args.appUrl = argv[++index] || args.appUrl;
    if (argv[index]?.startsWith('--app-url=')) args.appUrl = argv[index].slice(10);
    if (argv[index] === '--artifact-dir') args.artifactDir = argv[++index] || args.artifactDir;
    if (argv[index]?.startsWith('--artifact-dir=')) args.artifactDir = argv[index].slice(15);
  }
  args.appUrl = args.appUrl.replace(/\/+$/, '');
  args.artifactDir = path.resolve(process.cwd(), args.artifactDir);
  return args;
};

const mockUser = {
  id: '66000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'technician-time@example.test',
  email_confirmed_at: '2026-08-01T12:00:00.000Z',
  confirmed_at: '2026-08-01T12:00:00.000Z',
  last_sign_in_at: FIXED_NOW.toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
};

const mockSession = {
  access_token: 'mock-technician-time-access-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(FIXED_NOW.getTime() / 1000) + 3600,
  refresh_token: 'mock-technician-time-refresh-token',
  user: mockUser,
};

const jsonResponse = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const rpcError = (message, code = 'MOCK_UAT_FAILURE') =>
  jsonResponse({ code, details: null, hint: null, message }, 500);

const getMonthPeriod = (dateValue, locked = false, statusOverride = null) => {
  const month = dateValue.slice(0, 7);
  const [year, monthNumber] = month.split('-').map(Number);
  const end = new Date(Date.UTC(year, monthNumber, 0, 12));
  const endValue = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(
    end.getUTCDate()
  ).padStart(2, '0')}`;
  const lock = new Date(end);
  lock.setUTCDate(lock.getUTCDate() + 5);
  const lockValue = `${lock.getUTCFullYear()}-${String(lock.getUTCMonth() + 1).padStart(2, '0')}-${String(
    lock.getUTCDate()
  ).padStart(2, '0')}`;
  return {
    id: `period-${month}`,
    periodStartDate: `${month}-01`,
    periodEndDate: endValue,
    submissionDueDate: lockValue,
    lockDate: lockValue,
    targetPayoutDate: lockValue,
    status: locked ? 'locked' : statusOverride || 'open',
  };
};

const machineAssignments = [
  {
    assignmentId: 'assignment-machine-a',
    machineId: MACHINE_A,
    machineLabel: 'Cotton Candy 01',
    locationId: LOCATION_ID,
    locationName: 'Mall Atrium',
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: '2026-09-01',
  },
  {
    assignmentId: 'assignment-machine-b',
    machineId: MACHINE_B,
    machineLabel: 'Cotton Candy 02',
    locationId: LOCATION_ID,
    locationName: 'Mall Atrium',
    effectiveStartDate: '2026-09-02',
    effectiveEndDate: null,
  },
];

const zonedParts = (value) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value])
  );

const makeEntry = ({
  id,
  workDate,
  startTime,
  endTime,
  machineId = workDate <= '2026-09-01' ? MACHINE_A : MACHINE_B,
  editable = true,
}) => {
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  const duration = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  const offset = workDate < '2026-11-01' ? '-07:00' : '-08:00';
  const paidShifts = Math.ceil(duration / 60);
  return {
    id,
    accountId: ACCOUNT_ID,
    operatorProfileId: PROFILE_ID,
    machineId,
    machineLabel: machineId === MACHINE_A ? 'Cotton Candy 01' : 'Cotton Candy 02',
    locationId: LOCATION_ID,
    locationName: 'Mall Atrium',
    payoutPolicyId: POLICY_ID,
    payoutPeriodId: `period-${workDate.slice(0, 7)}`,
    workDate,
    startTime,
    endTime,
    actualStartAt: `${workDate}T${startTime}:00${offset}`,
    actualEndAt: `${workDate}T${endTime}:00${offset}`,
    actualDurationMinutes: duration,
    rawDurationMinutes: duration,
    paidShifts,
    roundedPaidMinutes: paidShifts * 60,
    notes: null,
    status: 'submitted',
    managerReviewStatus: 'pending',
    managerReviewReason: null,
    managerReviewedAt: null,
    technicianCutoffAt: `${workDate.slice(0, 7)}-05T07:00:00.000Z`,
    technicianEditable: editable,
    lockedAt: editable ? null : '2026-09-05T07:00:00.000Z',
    createdAt: '2026-09-03T16:00:00.000Z',
    updatedAt: '2026-09-03T16:00:00.000Z',
  };
};

const initialEntries = () => [
  makeEntry({ id: 'entry-aug-20', workDate: '2026-08-31', startTime: '08:00', endTime: '08:20' }),
  makeEntry({ id: 'entry-sep-20-a', workDate: '2026-09-01', startTime: '08:00', endTime: '08:20' }),
  makeEntry({ id: 'entry-sep-20-b', workDate: '2026-09-01', startTime: '09:00', endTime: '09:20' }),
  makeEntry({ id: 'entry-sep-61', workDate: '2026-09-02', startTime: '10:00', endTime: '11:01' }),
];

const buildContext = (state, requestedDate) => {
  const target = typeof requestedDate === 'string' ? requestedDate : '2026-09-03';
  const period = getMonthPeriod(
    target,
    state.contextLocked && target.startsWith('2026-09'),
    state.periodStatus
  );
  if (state.contextMode === 'no_profile' && typeof requestedDate === 'string') {
    return { workDate: target, profiles: [] };
  }
  const assignments = state.contextMode === 'no_assignment' ? [] : machineAssignments;
  return {
    workDate: target,
    profiles: [
      {
        id: PROFILE_ID,
        accountId: ACCOUNT_ID,
        accountName: 'Bloomjoy UAT',
        displayName: 'Technician Time',
        workerType: 'contractor_1099',
        status: 'active',
        policy: {
          id: POLICY_ID,
          name: 'Monthly Technician pay',
          frequency: 'monthly',
          roundingRule: 'round_up_60_minutes',
          reviewModel: 'no_review_required',
        },
        currentPeriod: period,
        assignedMachines: assignments,
        currentEntries:
          state.contextMode === 'empty'
            ? []
            : state.entries.filter(
                (entry) =>
                  entry.status !== 'voided' &&
                  entry.workDate >= period.periodStartDate &&
                  entry.workDate <= period.periodEndDate
              ),
        recentEntries: [],
      },
    ],
  };
};

const entryFromSave = (body, state) => {
  const start = zonedParts(body.p_actual_start_at);
  const end = zonedParts(body.p_actual_end_at);
  const workDate = `${start.year}-${start.month}-${start.day}`;
  const startTime = `${start.hour}:${start.minute}`;
  const endTime = `${end.hour}:${end.minute}`;
  return makeEntry({
    id: body.p_time_entry_id || `entry-created-${state.nextEntryId++}`,
    workDate,
    startTime,
    endTime,
    machineId: body.p_reporting_machine_id,
  });
};

const installRoutes = async (context, state) => {
  await context.route('**/auth/v1/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/token')) return route.fulfill(jsonResponse(mockSession));
    if (url.includes('/user')) return route.fulfill(jsonResponse(mockUser));
    if (url.includes('/logout')) return route.fulfill({ status: 204, body: '' });
    return route.fulfill(jsonResponse({}));
  });

  await context.route('**/rest/v1/customer_profiles**', (route) =>
    route.fulfill(jsonResponse(route.request().method() === 'GET' ? [] : {}))
  );

  await context.route('**/rest/v1/rpc/**', async (route) => {
    const rpcName = new URL(route.request().url()).pathname.split('/').pop() || '';
    const body = route.request().postDataJSON() || {};
    state.rpcCalls.push({ rpcName, body });

    if (rpcName === 'get_my_admin_access_context') {
      return route.fulfill(
        jsonResponse({
          isSuperAdmin: false,
          isScopedAdmin: false,
          canAccessAdmin: false,
          allowedSurfaces: [],
          scopedMachineIds: [],
        })
      );
    }
    if (rpcName === 'get_my_plus_access') {
      return route.fulfill(
        jsonResponse({
          has_plus_access: false,
          membership_status: null,
          paid_subscription_active: false,
          free_grant_active: false,
        })
      );
    }
    if (rpcName === 'get_my_portal_access_context') {
      return route.fulfill(
        jsonResponse({
          access_tier: 'baseline',
          is_plus_member: false,
          is_training_operator: false,
          is_admin: false,
          is_corporate_partner: false,
          can_request_support: true,
          capabilities: [],
          effective_presets: ['customer'],
        })
      );
    }
    if (rpcName === 'get_my_reporting_access_context') {
      return route.fulfill(jsonResponse({ has_reporting_access: false }));
    }
    if (rpcName === 'resolve_my_technician_entitlements') {
      return route.fulfill(jsonResponse({ technicianEmail: mockUser.email }));
    }
    if (rpcName === 'get_my_operator_timekeeping_context') {
      if (state.loadError && typeof body.p_work_date === 'string') {
        return route.fulfill(rpcError('Mock weekly time load failed.'));
      }
      return route.fulfill(jsonResponse(buildContext(state, body.p_work_date)));
    }
    if (rpcName === 'get_my_operator_pay_statement_context') {
      return route.fulfill(
        jsonResponse({
          profiles: [
            {
              id: PROFILE_ID,
              accountId: ACCOUNT_ID,
              accountName: 'Bloomjoy UAT',
              displayName: 'Technician Time',
              workerType: 'contractor_1099',
              statements: [],
            },
          ],
        })
      );
    }
    if (rpcName === 'save_operator_time_entry') {
      if (state.lockNextSave) {
        state.lockNextSave = false;
        state.contextLocked = true;
        return route.fulfill(rpcError('This month is closed for Technician editing'));
      }
      if (state.failNextSave) {
        state.failNextSave = false;
        return route.fulfill(rpcError('Mock time save failed. Try again.'));
      }
      const saved = entryFromSave(body, state);
      const index = state.entries.findIndex((entry) => entry.id === saved.id);
      if (index >= 0) state.entries[index] = saved;
      else state.entries.push(saved);
      return route.fulfill(
        jsonResponse({ timeEntry: saved, context: buildContext(state, saved.workDate) })
      );
    }
    if (rpcName === 'void_operator_time_entry') {
      const entry = state.entries.find((candidate) => candidate.id === body.p_time_entry_id);
      if (state.lockNextDelete) {
        state.lockNextDelete = false;
        state.contextLocked = true;
        return route.fulfill(rpcError('This time entry can no longer be deleted by the Technician'));
      }
      if (state.failNextDelete) {
        state.failNextDelete = false;
        return route.fulfill(rpcError('Mock time delete failed. Try again.'));
      }
      state.entries = state.entries.map((candidate) =>
        candidate.id === body.p_time_entry_id ? { ...candidate, status: 'voided' } : candidate
      );
      return route.fulfill(
        jsonResponse({ timeEntryId: body.p_time_entry_id, context: buildContext(state, entry.workDate) })
      );
    }
    return route.fulfill(jsonResponse({}));
  });
};

const waitForServer = async (appUrl) => {
  try {
    const response = await fetch(appUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(
      `Unable to reach ${appUrl}. Start the app with npm run dev -- --host 127.0.0.1 --port 8081 --strictPort. ${error.message}`
    );
  }
};

const recorder = () => {
  const failures = [];
  return {
    assert(name, condition, detail = '') {
      console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
      if (!condition) failures.push(name);
    },
    finish() {
      if (failures.length) throw new Error(`${failures.length} UAT checks failed: ${failures.join(', ')}`);
    },
  };
};

const pageOverflows = (page) =>
  page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const offenders = [...document.querySelectorAll('body *')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (getComputedStyle(element).position === 'fixed') return false;
        if (element.closest('[data-sonner-toaster]')) return false;
        return rect.right > viewportWidth + 1 || rect.left < -1;
      })
      .slice(0, 8)
      .map((element) => ({ tag: element.tagName, text: element.textContent?.trim().slice(0, 80) }));
    return {
      overflows: document.documentElement.scrollWidth > viewportWidth + 1 || offenders.length > 0,
      offenders,
    };
  });

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const check = recorder();
  const state = {
    entries: initialEntries(),
    nextEntryId: 1,
    rpcCalls: [],
    contextMode: 'normal',
    contextLocked: false,
    periodStatus: null,
    loadError: false,
    failNextSave: false,
    failNextDelete: false,
    lockNextSave: false,
    lockNextDelete: false,
  };

  await mkdir(args.artifactDir, { recursive: true });
  await waitForServer(args.appUrl);
  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  await installRoutes(context, state);
  const page = await context.newPage();
  await page.clock.setFixedTime(FIXED_NOW);
  const browserErrors = [];
  page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
  page.on('pageerror', (error) => browserErrors.push(error.message));

  const openWeek = async (date = '2026-09-02') => {
    await page.goto(`${args.appUrl}/portal/time?week=${WEEK_START}&date=${date}`, {
      waitUntil: 'domcontentloaded',
    });
    await Promise.race([
      page.waitForURL(/\/login(?:\?|$)/),
      page.getByRole('heading', { name: /^Time$/ }).waitFor(),
    ]);
    if (new URL(page.url()).pathname === '/login') {
      await page.fill('#email-password', mockUser.email);
      await page.fill('#password', 'mock-password');
      await Promise.all([
        page.waitForURL(/\/portal\/time/),
        page.getByRole('button', { name: /sign in/i }).click(),
      ]);
    }
    await page.getByRole('heading', { name: /^Time$/ }).waitFor();
  };

  try {
    await openWeek();
    check.assert('Technician lands on the weekly Time page', new URL(page.url()).pathname === '/portal/time');
    const loadedMonths = state.rpcCalls
      .filter((call) => call.rpcName === 'get_my_operator_timekeeping_context')
      .map((call) => call.body.p_work_date);
    check.assert(
      'Cross-month week loads both calendar months',
      loadedMonths.includes('2026-08-01') && loadedMonths.includes('2026-09-01'),
      JSON.stringify(loadedMonths)
    );
    check.assert(
      'Weekly summary preserves independent shift rounding',
      await page.getByText('2 hr 1 min actual · 5 paid shifts', { exact: true }).isVisible()
    );
    check.assert(
      '61 minutes visibly produces two paid shifts',
      (await page.getByText('1 hr 1 min actual ·', { exact: false }).isVisible()) &&
        (await page.getByText('2 paid shifts', { exact: true }).isVisible())
    );
    check.assert(
      'Technician page contains no approval workflow language',
      !(await page.locator('body').innerText()).match(
        /waiting for review|correction requested|submit for review|approve|reject|included in pay/i
      )
    );

    state.periodStatus = 'review';
    await openWeek();
    check.assert(
      'Legacy payout workflow status does not lock Technician time before cutoff',
      (await page.getByRole('button', { name: /^Add time$/ }).first().isEnabled()) &&
        (await page.getByRole('button', { name: /Edit .*10:00 AM to 11:01 AM/i }).isVisible())
    );
    state.periodStatus = null;
    await openWeek();
    await page
      .getByText('Signed in. Redirecting...', { exact: true })
      .waitFor({ state: 'detached', timeout: 6000 })
      .catch(() => undefined);

    for (const viewport of [
      { width: 360, height: 800 },
      { width: 390, height: 844 },
      { width: 414, height: 896 },
      { width: 768, height: 1024 },
      { width: 1365, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      const overflow = await pageOverflows(page);
      check.assert(
        `${viewport.width}px weekly page has no horizontal overflow`,
        !overflow.overflows,
        JSON.stringify(overflow.offenders)
      );
      if (viewport.width === 390 || viewport.width === 1365) {
        await page.screenshot({
          path: path.join(args.artifactDir, `weekly-time-${viewport.width}.png`),
          fullPage: true,
        });
      }
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const calendarButtons = page.locator('[aria-label="Choose a day"] button');
    const calendarSizes = await calendarButtons.evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      })
    );
    check.assert(
      'Mobile day targets remain at least 44px in both dimensions',
      calendarSizes.every((size) => size.width >= 44 && size.height >= 44),
      JSON.stringify(calendarSizes)
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const transitionDuration = await calendarButtons.first().evaluate(
      (element) => getComputedStyle(element).transitionDuration
    );
    check.assert('Reduced motion removes the day transition', transitionDuration === '0s', transitionDuration);

    await page.getByRole('button', { name: /Thursday, September 3/i }).click();
    await page.getByRole('button', { name: /^Add time$/ }).first().click();
    await page.getByRole('heading', { name: 'Add time' }).waitFor();
    check.assert(
      'Add time starts blank on the selected day',
      (await page.locator('#work-date').inputValue()) === '2026-09-03' &&
        (await page.locator('#start-time').inputValue()) === '' &&
        (await page.locator('#end-time').inputValue()) === ''
    );
    await page.getByRole('button', { name: 'Back to week' }).click();
    await page.getByRole('button', { name: /Wednesday, September 2/i }).click();

    const primaryAddTime = page.getByRole('button', { name: /^Add time$/ }).first();
    await primaryAddTime.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Add time' }).waitFor();
    check.assert('Keyboard activates the primary Add time action', true);
    await page.locator('#start-time').fill('10:30');
    await page.locator('#end-time').fill('11:30');
    const callsBeforeOverlap = state.rpcCalls.filter(
      (call) => call.rpcName === 'save_operator_time_entry'
    ).length;
    await page.getByRole('button', { name: 'Save time' }).click();
    await page.getByText(/Times may touch, but they cannot overlap/).waitFor();
    check.assert(
      'Cross-machine overlap is blocked before the RPC',
      state.rpcCalls.filter((call) => call.rpcName === 'save_operator_time_entry').length ===
        callsBeforeOverlap
    );

    await page.locator('#start-time').fill('12:00');
    await page.locator('#end-time').fill('13:01');
    check.assert(
      'Form previews 61 minutes as two paid shifts',
      (await page.getByText(/1 hr 1 min actual/).isVisible()) &&
        (await page.getByText(/2 paid shifts/).isVisible())
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'add-time-390.png'),
      fullPage: true,
    });
    state.failNextSave = true;
    await page.getByRole('button', { name: 'Save time' }).click();
    await page.getByText('Mock time save failed. Try again.', { exact: true }).waitFor();
    check.assert(
      'Save failure preserves the form',
      (await page.locator('#start-time').inputValue()) === '12:00' &&
        (await page.locator('#end-time').inputValue()) === '13:01'
    );
    await page.getByRole('button', { name: 'Save time' }).click();
    await page.waitForURL(/\/portal\/time\?/);
    await page.getByText('12:00 PM to 1:01 PM', { exact: true }).waitFor();
    const canonicalSave = state.rpcCalls.find(
      (call) =>
        call.rpcName === 'save_operator_time_entry' &&
        call.body.p_actual_start_at === '2026-09-02T19:00:00.000Z'
    );
    check.assert(
      'Save uses the canonical Pacific timestamp RPC',
      Boolean(canonicalSave?.body.p_actual_end_at === '2026-09-02T20:01:00.000Z')
    );

    await page.getByRole('button', { name: /Edit .*12:00 PM to 1:01 PM/i }).click();
    await page.locator('#end-time').fill('13:02');
    await page.getByRole('button', { name: 'Save time' }).click();
    await page.waitForURL(/\/portal\/time\?/);
    check.assert(
      'Edit reuses the same canonical save contract',
      state.rpcCalls.some(
        (call) => call.rpcName === 'save_operator_time_entry' && call.body.p_time_entry_id
      )
    );

    await page.getByRole('button', { name: /^Add time$/ }).first().click();
    await page.getByRole('heading', { name: 'Add time' }).waitFor();
    check.assert(
      'Add time clears values retained by a prior edit',
      (await page.locator('#work-date').inputValue()) === '2026-09-02' &&
        (await page.locator('#start-time').inputValue()) === '' &&
        (await page.locator('#end-time').inputValue()) === ''
    );
    await page.getByRole('button', { name: 'Back to week' }).click();

    const deleteButton = page.getByRole('button', { name: /Delete .*12:00 PM to 1:02 PM/i });
    await deleteButton.click();
    const deleteDialog = page.getByRole('alertdialog');
    await deleteDialog.waitFor();
    check.assert(
      'Delete confirmation gives keyboard focus to the safe action',
      await page.getByRole('button', { name: 'Keep entry' }).evaluate(
        (element) => element === document.activeElement
      )
    );
    await page.keyboard.press('Escape');
    await deleteDialog.waitFor({ state: 'detached' });
    check.assert(
      'Canceling delete returns focus to the entry action',
      await deleteButton.evaluate((element) => element === document.activeElement)
    );
    await deleteButton.click();
    await deleteDialog.waitFor();
    state.failNextDelete = true;
    await page.getByRole('button', { name: 'Delete time' }).click();
    await page.getByText('Mock time delete failed. Try again.', { exact: true }).waitFor();
    check.assert(
      'Delete failure leaves the entry visible',
      await page.getByText('12:00 PM to 1:02 PM', { exact: true }).isVisible()
    );
    check.assert(
      'Delete failure returns focus to the same entry',
      await deleteButton.evaluate((element) => element === document.activeElement)
    );

    await deleteButton.click();
    await page.getByRole('button', { name: 'Delete time' }).click();
    await page.getByText('12:00 PM to 1:02 PM', { exact: true }).waitFor({ state: 'detached' });
    check.assert(
      'Delete success uses the audited void RPC',
      state.rpcCalls.some((call) => call.rpcName === 'void_operator_time_entry')
    );

    await page.getByRole('button', { name: /^Add time$/ }).first().click();
    await page.locator('#start-time').fill('14:00');
    await page.locator('#end-time').fill('14:20');
    state.lockNextSave = true;
    await page.getByRole('button', { name: 'Save time' }).click();
    await page.getByText(/Technician editing has closed for this month/).waitFor();
    check.assert(
      'Cutoff race preserves unsaved time and refreshes the lock state',
      (await page.locator('#start-time').inputValue()) === '14:00' &&
        (await page.getByRole('button', { name: 'Save time' }).isDisabled())
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'cutoff-race-390.png'),
      fullPage: true,
    });

    state.contextLocked = false;
    state.contextMode = 'no_profile';
    await openWeek();
    await page.getByText(/does not have an active Technician profile yet/).waitFor();
    check.assert('No-profile state provides a manager next step', true);

    state.contextMode = 'no_assignment';
    await openWeek();
    await page.getByText('No machine assignment for this day', { exact: true }).waitFor();
    check.assert('No-assignment state explains what to do', true);

    state.contextMode = 'empty';
    await openWeek();
    await page.getByText('No time recorded for this day', { exact: true }).waitFor();
    check.assert('Empty week keeps Add time discoverable', true);

    state.contextMode = 'normal';
    state.loadError = true;
    await openWeek();
    await page.getByRole('button', { name: 'Try again' }).waitFor();
    state.loadError = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByText('Week of', { exact: true }).waitFor();
    check.assert('Load error can recover in place', true);

    const unexpectedBrowserErrors = browserErrors.filter(
      (message) => !message.includes('Failed to load resource: the server responded with a status of 500')
    );
    check.assert(
      'Rendered flow has no unexpected browser errors',
      unexpectedBrowserErrors.length === 0,
      unexpectedBrowserErrors.join(' | ')
    );
  } finally {
    await browser.close();
  }

  check.finish();
  console.log(`Technician weekly Timekeeping UAT passed. Screenshots: ${args.artifactDir}`);
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
