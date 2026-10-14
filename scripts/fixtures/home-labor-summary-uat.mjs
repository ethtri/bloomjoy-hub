// Synthetic data only. No credentials or production records are read by this harness.
export const FIXED_NOW = '2026-10-13T19:00:00.000Z';
export const MACHINE_A = '19230000-0000-4000-8000-000000000011';
export const LOCATION_A = '19230000-0000-4000-8000-000000000012';

const base = {
  id: '19230000-0000-4000-8000-000000000001',
  email: 'home-summary@example.test',
  capabilities: ['timekeeping.review'],
  surfaces: [],
  isSuperAdmin: false,
  technician: false,
  hasAccess: true,
  canViewPay: false,
};

export const personas = {
  machineManager: { ...base },
  payManager: { ...base, canViewPay: true },
  payOnly: { ...base, hasAccess: false, canViewPay: true },
  scopedAdmin: { ...base, surfaces: ['overview', 'payouts'], canViewPay: true },
  adminWithoutPayouts: { ...base, surfaces: ['overview', 'machines'], canViewPay: true },
  superAdmin: { ...base, surfaces: ['*'], isSuperAdmin: true, canViewPay: true },
  technician: { ...base, capabilities: ['operator.timekeeping'], technician: true, hasAccess: false },
  noAccess: { ...base, capabilities: [], hasAccess: false },
};

export const dimensions = [{ machineId: MACHINE_A, machineLabel: 'Account A · Atrium machine', locationId: LOCATION_A, locationName: 'Account A Atrium' }];
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

export function makeReport(persona, body, state) {
  const current = body.p_date_from === state.currentFrom;
  return {
    access: state.reportAccess ?? { hasAccess: persona.hasAccess, canViewPay: persona.canViewPay },
    dateFrom: (current && state.malformedCurrent) || (!current && state.malformedPrevious) ? '2000-01-01' : body.p_date_from,
    dateTo: body.p_date_to,
    generatedAt: state.now,
    dateBasis: 'work_date',
    calculationVersion: 'synthetic-v1',
    rows: persona.hasAccess && !state.empty ? [
      { ...dimensions[0], week: body.p_date_from, entryCount: state.entryCount, actualMinutes: state.actualMinutes, paidShifts: state.paidShifts },
    ] : [],
    pay: persona.canViewPay ? {
      // Deliberately different current/previous values expose accidental query reuse.
      shiftEarningsCents: 123456, commissionEarningsCents: 98765,
      missingShiftRateEntries: state.empty ? 0 : current ? 91 : state.missingRates,
      calculationIssueCount: state.empty ? 0 : current ? 92 : state.calculationIssues,
      // Account B pay inputs deliberately accompany Account A's manageable machine.
      // Revision count models the corrected #1912 contract; SQL freshness belongs to that dependency's tests.
      readyCalculationCount: 10, revisionRequiredCount: state.empty ? 0 : current ? 93 : state.revisions,
      partialMonthCalculationCount: 17, publishedStatementCount: 23,
      unallocatedOtherEarningsCents: 76543,
      coverage: 'account',
      statementBasis: 'latest_published',
    } : null,
  };
}

export async function createHarness(browser, { persona = personas.payManager, width = 1366, language = 'en', now = FIXED_NOW, ...overrides } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1000 }, timezoneId: 'Asia/Shanghai' });
  const state = {
    now, currentFrom: '2026-10-01', actualMinutes: 181, paidShifts: 5, entryCount: 3,
    calculationIssues: 7, missingRates: 2, revisions: 4, empty: false,
    accessFailures: 0, currentFailures: 0, previousFailures: 0,
    rpcCalls: [], forbidden: [], errors: [], expectedFailures: [],
    ...overrides,
  };
  const user = {
    id: persona.id, email: persona.email, aud: 'authenticated', role: 'authenticated',
    email_confirmed_at: now, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: now, updated_at: now,
  };
  const session = { access_token: 'synthetic-home-summary-token', refresh_token: 'synthetic-home-summary-refresh', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(new Date(now).getTime() / 1000) + 86400, user };
  await context.addInitScript(({ session, language }) => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      return /^sb-.+-auth-token$/.test(key) ? JSON.stringify(session) : originalGetItem.call(this, key);
    };
    localStorage.setItem('bloomjoy.language.v1', language);
  }, { session, language });

  const baselineRpc = (name, body) => {
    switch (name) {
      // Existing auth bootstrap resolvers are mocked separately from the read-only Home contract.
      case 'resolve_my_technician_entitlements':
        return { technicianEmail: persona.email, resolvedGrantCount: 0, resolvedOperatorTrainingGrantCount: 0, upsertedReportingEntitlementCount: 0, skippedGrantCount: 0 };
      case 'resolve_my_scoped_admin_invites':
        return { targetEmail: persona.email, resolvedInviteCount: 0, grantId: null, machineCount: 0 };
      case 'get_my_plus_access':
        return { has_plus_access: false, membership_status: 'none', paid_subscription_active: false, free_grant_active: false };
      case 'get_my_admin_access_context':
        return { isSuperAdmin: persona.isSuperAdmin, isScopedAdmin: persona.surfaces.length > 0 && !persona.isSuperAdmin, canAccessAdmin: persona.surfaces.length > 0, allowedSurfaces: persona.surfaces, scopedMachineIds: [MACHINE_A] };
      case 'get_my_portal_access_context':
        return { access_tier: 'baseline', is_plus_member: false, is_training_operator: false, is_admin: persona.surfaces.length > 0, can_manage_operator_training: false, is_corporate_partner: false, has_supply_discount: false, can_request_support: false, can_manage_technicians: false, capabilities: persona.capabilities, effective_presets: [] };
      case 'get_my_reporting_access_context':
        return { has_reporting_access: false, accessible_machine_count: 0, accessible_location_count: 0, can_manage_reporting: false };
      case 'get_my_time_report_access': return !persona.technician && (persona.hasAccess || persona.canViewPay);
      case 'get_my_email_alert_preferences':
        return { schemaVersion: 'email_alert_preferences_v1', revision: 0, email: persona.email, eligible: false, machines: [], alerts: [], settings: { timezone: 'America/Los_Angeles', dailyTime: '09:00', weeklyDay: 1, weeklyTime: '09:00', quietEnabled: false, quietStart: '22:00', quietEnd: '07:00' } };
      case 'get_refund_analytics_access': return { hasAccess: false, dimensions: [] };
      case 'get_my_technician_management_context': return { canManage: false, seatCap: 0, accounts: [] };
      case 'get_my_operator_timekeeping_context':
        return { workDate: body.p_work_date ?? state.currentFrom, profiles: persona.technician ? [{ id: 'technician-profile', accountId: 'account-a', accountName: 'Account A', displayName: 'Synthetic technician', status: 'active', workerType: 'hourly', assignedMachines: [], currentEntries: [], currentPeriod: { periodStartDate: state.currentFrom, periodEndDate: '2026-10-31', status: 'open' } }] : [] };
      case 'get_my_operator_pay_statement_context': return { profiles: [] };
      case 'get_my_time_review_context':
        return { workDate: state.currentFrom, periodStartDate: state.currentFrom, periodEndDate: '2026-10-31', hasAccess: persona.hasAccess, entries: [], machines: dimensions, technicians: [], entryOptions: [] };
      case 'get_my_time_review_entry_options':
      case 'admin_get_account_summaries':
      case 'admin_get_audit_log':
      case 'admin_list_scoped_admin_grants': return [];
      case 'admin_get_refund_manager_setup': return { machines: [] };
      case 'get_refund_request_access': return { hasAccess: false, machines: [] };
      default: return undefined;
    }
  };

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.includes('/auth/v1/')) {
      if (url.pathname.endsWith('/user')) return route.fulfill(json(user));
      if (url.pathname.endsWith('/token')) return route.fulfill(json(session));
      state.forbidden.push(`Unexpected auth: ${request.method()} ${url.pathname}`);
      return route.fulfill(json({ message: 'Blocked synthetic auth request' }, 400));
    }
    if (url.pathname.includes('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop();
      const body = request.postDataJSON() ?? {};
      state.rpcCalls.push({ name, body });
      if (name === 'get_labor_analytics_access') {
        if (state.holdAccess) await state.holdAccess;
        if (state.accessFailures-- > 0) {
          state.expectedFailures.push(name);
          return route.fulfill(json({ message: 'Synthetic access failure' }, 503));
        }
        return route.fulfill(json(state.access ?? { hasAccess: persona.hasAccess, canViewPay: persona.canViewPay, dimensions: persona.hasAccess ? dimensions : [] }));
      }
      if (name === 'get_labor_analytics_report') {
        const current = body.p_date_from === state.currentFrom;
        if (current && state.holdCurrent) await state.holdCurrent;
        if (!current && state.holdPrevious) await state.holdPrevious;
        const failures = current ? 'currentFailures' : 'previousFailures';
        if (state[failures]-- > 0) {
          state.expectedFailures.push(name);
          return route.fulfill(json({ message: 'Synthetic report failure' }, 503));
        }
        return route.fulfill(json(makeReport(persona, body, state)));
      }
      const response = baselineRpc(name, body);
      if (response !== undefined) return route.fulfill(json(response));
      state.forbidden.push(`Unexpected RPC: ${name}`);
      return route.fulfill(json({ message: 'Unexpected RPC blocked by Home UAT' }, 400));
    }
    if (url.pathname.includes('/rest/v1/')) {
      const table = url.pathname.split('/').pop();
      const allowed = ['admin_roles', 'customer_profiles', 'training_progress', 'training_tracks', 'trainings', 'training_certifications', 'orders', 'support_requests'];
      if (request.method() !== 'GET' || !allowed.includes(table)) {
        state.forbidden.push(`Unexpected REST: ${request.method()} ${table}`);
        return route.fulfill(json({ message: 'Unexpected REST blocked by Home UAT' }, 400));
      }
      return route.fulfill(json(table === 'customer_profiles' ? { user_id: persona.id, language_preference: language } : []));
    }
    if (url.pathname.includes('/functions/v1/')) {
      const body = request.postDataJSON();
      if (url.pathname.endsWith('/nayax-card-refund') && body?.operation === 'availability' && !body.caseId) {
        return route.fulfill(json({ available: false, status: 'unavailable', blockReason: 'configuration_missing', payloadRedacted: true }));
      }
      state.forbidden.push(`Unexpected Edge Function: ${url.pathname}`);
      return route.fulfill(json({ message: 'Edge Function blocked by Home UAT' }, 400));
    }
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return route.fulfill({ status: 204, body: '' });
    return route.continue();
  });

  const page = await context.newPage();
  await page.clock.install({ time: new Date(now) });
  page.on('pageerror', error => state.errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && response.status() !== 503) state.errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  return { context, page, state, persona };
}
