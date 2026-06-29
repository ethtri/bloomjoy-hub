import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_APP_URL = 'http://127.0.0.1:8081';
const DEFAULT_ARTIFACT_DIR = 'output/playwright';

const parseArgs = (argv) => {
  const args = {
    appUrl: process.env.ADMIN_ACCESS_INVITE_UAT_APP_URL || DEFAULT_APP_URL,
    artifactDir: process.env.ADMIN_ACCESS_INVITE_UAT_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR,
    headed: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--headed') {
      args.headed = true;
      continue;
    }

    if (arg === '--app-url') {
      args.appUrl = argv[index + 1] || args.appUrl;
      index += 1;
      continue;
    }

    if (arg.startsWith('--app-url=')) {
      args.appUrl = arg.slice('--app-url='.length) || args.appUrl;
      continue;
    }

    if (arg === '--artifact-dir') {
      args.artifactDir = argv[index + 1] || args.artifactDir;
      index += 1;
      continue;
    }

    if (arg.startsWith('--artifact-dir=')) {
      args.artifactDir = arg.slice('--artifact-dir='.length) || args.artifactDir;
    }
  }

  args.appUrl = args.appUrl.replace(/\/+$/, '');
  args.artifactDir = path.resolve(process.cwd(), args.artifactDir);
  return args;
};

const now = new Date();
const isoHoursAgo = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
const isoHoursFromNow = (hours) => new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();

const adminUser = {
  id: '11111111-1111-4111-8111-111111111111',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'super-admin@example.test',
  email_confirmed_at: isoHoursAgo(24),
  confirmed_at: isoHoursAgo(24),
  last_sign_in_at: now.toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
};

const targetEmail = 'new-partner-manager@example.test';
const partnerId = '22222222-2222-4222-8222-222222222222';
const noPortalPartnerId = '22222222-2222-4222-8222-333333333333';
const partyId = '33333333-3333-4333-8333-333333333333';
const noPortalPartyId = '33333333-3333-4333-8333-444444444444';
const partnershipId = '44444444-4444-4444-8444-444444444444';
const noPortalPartnershipId = '44444444-4444-4444-8444-555555555555';
const machineId = '55555555-5555-4555-8555-555555555555';
const machineTwoId = '55555555-5555-4555-8555-555555555556';
const accountId = '66666666-6666-4666-8666-666666666666';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info, x-supabase-auth-token',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

const jsonResponse = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  headers: corsHeaders,
  body: JSON.stringify(body),
});

const buildSession = () => ({
  access_token: `mock-access-token-${adminUser.id}`,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: `mock-refresh-token-${adminUser.id}`,
  user: adminUser,
});

const waitForCondition = async (predicate, label, timeoutMs = 10000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await delay(100);
  }

  throw new Error(`${label} timed out after ${timeoutMs}ms`);
};

const createRecorder = () => {
  const results = [];

  return {
    pass(name, detail = '') {
      results.push({ name, pass: true, detail });
      console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`);
    },
    fail(name, detail = '') {
      results.push({ name, pass: false, detail });
      console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
    },
    assert(name, condition, detail = '') {
      if (condition) {
        this.pass(name, detail);
      } else {
        this.fail(name, detail);
      }
    },
    failed() {
      return results.filter((result) => !result.pass);
    },
  };
};

const buildCorporateOptions = (state) => ({
  partners: [
    {
      partnerId,
      partnerName: 'Bubble Planet',
      partnerType: 'revenue_share_partner',
      status: 'active',
      memberships: state.memberships,
      portalPartnerships: [
        {
          partyId,
          partnershipId,
          partnershipName: 'Bubble Planet Revenue Share',
          partnershipStatus: 'active',
          portalAccessEnabled: true,
          machineCount: 1,
          machines: [
            {
              machineId,
              machineLabel: 'Bubble Planet Kiosk 01',
              accountId,
              accountName: 'Bubble Planet Pier 39',
              locationId: '77777777-7777-4777-8777-777777777777',
              locationName: 'Pier 39',
              status: 'active',
            },
          ],
        },
      ],
    },
    {
      partnerId: noPortalPartnerId,
      partnerName: 'Portal Setup Missing Partner',
      partnerType: 'revenue_share_partner',
      status: 'active',
      memberships: [],
      portalPartnerships: [
        {
          partyId: noPortalPartyId,
          partnershipId: noPortalPartnershipId,
          partnershipName: 'Portal Setup Missing Revenue Share',
          partnershipStatus: 'active',
          portalAccessEnabled: false,
          machineCount: 1,
          machines: [
            {
              machineId,
              machineLabel: 'Bubble Planet Kiosk 01',
              accountId,
              accountName: 'Bubble Planet Pier 39',
              locationId: '77777777-7777-4777-8777-777777777777',
              locationName: 'Pier 39',
              status: 'active',
            },
          ],
        },
      ],
    },
  ],
});

const buildEffectiveAccess = (state) => ({
  userId: null,
  email: targetEmail,
  presets: [
    ...(state.memberships.length > 0 ? ['Corporate Partner'] : []),
    ...(state.technicianGrants.length > 0 ? ['Technician'] : []),
  ],
  capabilities: [
    ...(state.memberships.length > 0 ? ['training.view', 'reports.partner.view'] : []),
    ...(state.technicianGrants.length > 0 ? ['reports.machine.view'] : []),
  ],
  sources: {
    plusAccess: {
      hasPlusAccess: false,
      source: 'none',
      membershipStatus: 'none',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      paidSubscriptionActive: false,
      freeGrantId: null,
      freeGrantStartsAt: null,
      freeGrantExpiresAt: null,
      freeGrantActive: false,
    },
    corporatePartnerMemberships: state.memberships.map((membership) => ({
      id: membership.id,
      partnerId,
      partnerName: 'Bubble Planet',
      memberEmail: membership.memberEmail,
      status: membership.status,
      startsAt: membership.startsAt,
      expiresAt: membership.expiresAt,
      grantReason: membership.grantReason,
      revokedAt: membership.revokedAt,
      isActive: membership.isActive,
    })),
    technicianGrants: state.technicianGrants.map((grant) => ({
      id: grant.grantId,
      accountId: grant.accountId,
      accountName: 'Bubble Planet Pier 39',
      sponsorType: 'plus_customer_account',
      partnerId: null,
      partnerName: null,
      status: grant.status,
      startsAt: grant.startsAt,
      expiresAt: grant.expiresAt,
      grantReason: grant.grantReason,
      revokedAt: null,
      isActive: true,
      machineIds: grant.machineIds,
    })),
  },
  scopes: {
    partnerIds: state.memberships.length > 0 ? [partnerId] : [],
    partnershipIds: state.memberships.length > 0 ? [partnershipId] : [],
    machineIds: [
      ...(state.memberships.length > 0 ? [machineId] : []),
      ...state.technicianGrants.flatMap((grant) => grant.machineIds),
    ],
    corporatePartnerMachineIds: state.memberships.length > 0 ? [machineId] : [],
    technicianMachineIds: state.technicianGrants.flatMap((grant) => grant.machineIds),
    scopedAdminMachineIds: [],
  },
  warnings: [],
});

const installMockRoutes = async (context, state) => {
  await context.route('**/auth/v1/**', async (route) => {
    const url = route.request().url();

    if (url.includes('/token')) {
      state.isLoggedIn = true;
      return route.fulfill(jsonResponse(buildSession()));
    }

    if (url.includes('/otp')) {
      return route.fulfill(jsonResponse({}));
    }

    if (url.includes('/user')) {
      if (!state.isLoggedIn) {
        return route.fulfill(jsonResponse({ message: 'No active mock session' }, 401));
      }
      return route.fulfill(jsonResponse(adminUser));
    }

    if (url.includes('/logout')) {
      state.isLoggedIn = false;
      return route.fulfill({ status: 204, body: '' });
    }

    return route.fulfill(jsonResponse({}));
  });

  await context.route('**/rest/v1/customer_profiles**', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill(jsonResponse([]));
    }

    return route.fulfill(jsonResponse({ user_id: adminUser.id, language_preference: 'en' }));
  });

  await context.route('**/rest/v1/access_invite_deliveries**', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill(jsonResponse(state.inviteDeliveries));
    }

    return route.fulfill(jsonResponse({}));
  });

  await context.route('**/rest/v1/customer_machine_inventory**', async (route) => {
    return route.fulfill(jsonResponse([]));
  });

  await context.route('**/functions/v1/access-invite', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders, body: '' });
    }

    const body = route.request().postDataJSON();
    state.accessInviteBodies.push(body);
    state.inviteDeliveries.unshift({
      id: `invite-${state.accessInviteBodies.length}`,
      invite_type: body?.inviteType ?? 'corporate_partner',
      source_type:
        body?.inviteType === 'technician' ? 'technician_grant' : 'corporate_partner_membership',
      source_id: body?.sourceId,
      target_email: body?.targetEmail,
      sent_by: adminUser.id,
      sent_at: new Date().toISOString(),
      delivery_status: 'sent',
      error_message: null,
    });

    return route.fulfill(jsonResponse({ ok: true }));
  });

  await context.route('**/rest/v1/rpc/**', async (route) => {
    const url = route.request().url();
    const rpcName = new URL(url).pathname.split('/').pop() ?? '';
    const body = route.request().postDataJSON();
    state.rpcCalls.push({ rpcName, body });

    if (rpcName === 'get_my_admin_access_context') {
      return route.fulfill(
        jsonResponse({
          isSuperAdmin: true,
          isScopedAdmin: false,
          canAccessAdmin: true,
          allowedSurfaces: ['all'],
          scopedMachineIds: [],
        })
      );
    }

    if (rpcName === 'get_my_plus_access') {
      return route.fulfill(
        jsonResponse({
          has_plus_access: true,
          source: 'admin',
          membership_status: 'active',
          current_period_end: null,
          cancel_at_period_end: false,
          paid_subscription_active: false,
          free_grant_id: null,
          free_grant_starts_at: null,
          free_grant_expires_at: null,
          free_grant_active: false,
        })
      );
    }

    if (rpcName === 'get_my_portal_access_context') {
      return route.fulfill(
        jsonResponse({
          access_tier: 'admin',
          is_plus_member: true,
          is_training_operator: false,
          is_admin: true,
          can_manage_operator_training: false,
          is_corporate_partner: false,
          has_supply_discount: true,
          can_request_support: true,
          can_manage_technicians: false,
          capabilities: ['admin.global'],
          effective_presets: ['super_admin'],
        })
      );
    }

    if (rpcName === 'admin_get_account_summaries') {
      return route.fulfill(jsonResponse([]));
    }

    if (rpcName === 'admin_get_effective_access_context') {
      return route.fulfill(jsonResponse(buildEffectiveAccess(state)));
    }

    if (rpcName === 'admin_get_corporate_partner_access_options') {
      return route.fulfill(jsonResponse(buildCorporateOptions(state)));
    }

    if (rpcName === 'admin_grant_corporate_partner_membership') {
      const membership = {
        id: '88888888-8888-4888-8888-888888888888',
        partnerId,
        userId: null,
        memberEmail: String(body?.p_target_email ?? targetEmail).toLowerCase(),
        status: 'active',
        startsAt: new Date().toISOString(),
        expiresAt: isoHoursFromNow(24 * 365),
        grantReason: String(body?.p_reason ?? 'Agent UAT grant'),
        revokedAt: null,
        revokeReason: null,
        isActive: true,
      };
      state.memberships = [membership];
      return route.fulfill(jsonResponse(membership));
    }

    if (rpcName === 'admin_set_partnership_party_portal_access') {
      return route.fulfill(jsonResponse({ ok: true }));
    }

    if (rpcName === 'admin_get_technician_access_context') {
      return route.fulfill(
        jsonResponse({
          targetEmail,
          targetUserId: null,
          activeAccountCount: 1,
          eligibleAccountCount: 1,
          ineligibleAccountCount: 0,
          accounts: [
            {
              accountId,
              accountName: 'Bubble Planet Pier 39',
              accountStatus: 'active',
              sponsorUserId: adminUser.id,
              sponsorType: 'plus_customer_account',
              machineCount: 2,
              machines: [
                {
                  machineId,
                  machineLabel: 'Bubble Planet Kiosk 01',
                  machineType: 'commercial',
                  accountId,
                  accountName: 'Bubble Planet Pier 39',
                  locationId: '77777777-7777-4777-8777-777777777777',
                  locationName: 'Pier 39',
                  status: 'active',
                },
                {
                  machineId: machineTwoId,
                  machineLabel: 'Bubble Planet Kiosk 02',
                  machineType: 'commercial',
                  accountId,
                  accountName: 'Bubble Planet Pier 39',
                  locationId: '77777777-7777-4777-8777-777777777778',
                  locationName: 'Market Street',
                  status: 'active',
                },
              ],
            },
          ],
          grants: state.technicianGrants.map((grant) => ({
            grantId: grant.grantId,
            accountId,
            accountName: 'Bubble Planet Pier 39',
            sponsorUserId: adminUser.id,
            sponsorType: 'plus_customer_account',
            partnerId: null,
            partnerName: null,
            technicianEmail: targetEmail,
            technicianUserId: null,
            operatorTrainingGrantId: `${grant.grantId}-training`,
            status: grant.status,
            startsAt: grant.startsAt,
            expiresAt: grant.expiresAt,
            grantReason: grant.grantReason,
            revokedAt: null,
            revokeReason: null,
            createdAt: grant.startsAt,
            updatedAt: new Date().toISOString(),
            isActive: true,
            activeReportingEntitlementCount: grant.machineIds.length,
            machines: grant.machineIds.map((assignedMachineId) => ({
              assignmentId: `${grant.grantId}-${assignedMachineId}`,
              machineId: assignedMachineId,
              machineLabel:
                assignedMachineId === machineId ? 'Bubble Planet Kiosk 01' : 'Bubble Planet Kiosk 02',
              machineType: 'commercial',
              accountId,
              accountName: 'Bubble Planet Pier 39',
              locationId:
                assignedMachineId === machineId
                  ? '77777777-7777-4777-8777-777777777777'
                  : '77777777-7777-4777-8777-777777777778',
              locationName: assignedMachineId === machineId ? 'Pier 39' : 'Market Street',
              status: 'active',
              startsAt: grant.startsAt,
              expiresAt: grant.expiresAt,
              revokedAt: null,
              revokeReason: null,
              isActive: true,
            })),
          })),
        })
      );
    }

    if (rpcName === 'admin_grant_technician_access') {
      const machineIds = Array.isArray(body?.p_machine_ids) ? body.p_machine_ids : [];
      const grant = {
        grantId: '99999999-9999-4999-8999-999999999999',
        accountId,
        partnerId: null,
        sponsorType: 'plus_customer_account',
        technicianEmail: String(body?.p_target_email ?? targetEmail).toLowerCase(),
        technicianUserId: null,
        status: 'pending',
        startsAt: new Date().toISOString(),
        expiresAt: isoHoursFromNow(24 * 365),
        grantReason: String(body?.p_reason ?? 'Agent UAT Technician grant'),
        machineIds,
        operatorTrainingGrantId: '99999999-9999-4999-8999-999999999998',
      };
      state.technicianGrants = [grant];
      return route.fulfill(
        jsonResponse({
          grantId: grant.grantId,
          accountId: grant.accountId,
          partnerId: grant.partnerId,
          sponsorType: grant.sponsorType,
          technicianEmail: grant.technicianEmail,
          technicianUserId: grant.technicianUserId,
          status: grant.status,
          expiresAt: grant.expiresAt,
          operatorTrainingGrantId: grant.operatorTrainingGrantId,
        })
      );
    }

    if (rpcName === 'admin_get_reporting_access_matrix') {
      return route.fulfill(jsonResponse({ people: [], machines: [], grants: [] }));
    }

    if (
      rpcName === 'admin_get_audit_log' ||
      rpcName === 'admin_get_roles' ||
      rpcName === 'admin_get_scoped_admin_grants' ||
      rpcName === 'admin_list_scoped_admin_grants' ||
      rpcName === 'admin_list_super_admin_roles'
    ) {
      return route.fulfill(jsonResponse([]));
    }

    if (rpcName === 'get_my_reporting_access_context') {
      return route.fulfill(
        jsonResponse({
          has_reporting_access: true,
          accessible_machine_count: 1,
          accessible_location_count: 1,
          can_manage_reporting: true,
          latest_sale_date: '2026-06-01',
          latest_import_completed_at: isoHoursAgo(1),
        })
      );
    }

    return route.fulfill(jsonResponse({}));
  });
};

const waitForServer = async (appUrl) => {
  try {
    const response = await fetch(appUrl, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `Unable to reach ${appUrl}. Start the app first, for example: npm run dev:uat. ${error.message}`
    );
  }
};

const login = async (page) => {
  await page.waitForURL('**/login', { timeout: 10000 }).catch(() => undefined);
  if (new URL(page.url()).pathname !== '/login') return;

  await page.waitForSelector('#email-password', { timeout: 10000 });
  await page.fill('#email-password', adminUser.email);
  await page.fill('#password', 'mock-password');
  await page.getByRole('button', { name: /sign in/i }).click();
};

const unexpectedConsoleErrors = (errors) =>
  errors.filter((error) => !error.includes('400 (Bad Request)'));

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const recorder = createRecorder();
  const state = {
    accessInviteBodies: [],
    inviteDeliveries: [],
    memberships: [],
    technicianGrants: [],
    rpcCalls: [],
    isLoggedIn: false,
  };

  await mkdir(args.artifactDir, { recursive: true });
  await waitForServer(args.appUrl);

  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installMockRoutes(context, state);
  const page = await context.newPage();
  const consoleErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });

  try {
    await page.goto(
      `${args.appUrl}/login?intent=technician&email=${encodeURIComponent(targetEmail)}`,
      { waitUntil: 'domcontentloaded' }
    );
    await page.getByText('Technician invite').waitFor({ timeout: 10000 });
    await page.screenshot({
      path: path.join(args.artifactDir, 'technician-invite-login-email-link.png'),
      fullPage: true,
    });

    recorder.assert(
      'Technician invite link opens Email Link sign-in by default',
      (await page.getByRole('button', { name: 'Email Link', exact: true }).getAttribute('aria-pressed')) === 'true'
    );
    recorder.assert(
      'Technician invite link prefills the invited email',
      (await page.locator('#email-link').inputValue()) === targetEmail
    );
    recorder.assert(
      'Technician invite link does not start in create-account mode',
      !(await page.getByRole('button', { name: /Create Account with Password/i }).isVisible().catch(() => false))
    );

    await page.getByRole('button', { name: /Continue with Email Link/i }).click();
    await page.getByText('Check your email').waitFor({ timeout: 10000 });

    const inviteLoginBody = await page.locator('body').innerText();
    recorder.assert(
      'Technician invite email-link confirmation does not mention signup confirmation',
      !/signup confirmation/i.test(inviteLoginBody)
    );

    await page.goto(`${args.appUrl}/admin/access`, { waitUntil: 'domcontentloaded' });
    await login(page);
    await page.waitForURL('**/admin/access', { timeout: 20000 });
    await page.getByRole('heading', { name: 'Access' }).waitFor({ timeout: 10000 });

    recorder.assert(
      'Admin Access exposes a direct Add Technician action',
      await page.getByRole('button', { name: 'Add Technician' }).isVisible()
    );
    await page.getByRole('button', { name: 'Add Technician' }).click();
    await page.getByRole('heading', { name: 'Add Technician' }).waitFor({ timeout: 10000 });
    recorder.assert(
      'Direct Add Technician opens the focused Technician launcher',
      await page.getByText(/Invite a Technician with training access/i).isVisible()
    );
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('heading', { name: 'Add Technician' }).waitFor({
      state: 'hidden',
      timeout: 10000,
    });

    await page.getByLabel('Search by email or user ID').fill(targetEmail);
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('button', { name: 'Open email workspace' }).click();
    await page.getByRole('heading', { name: targetEmail }).waitFor({ timeout: 10000 });
    await page.getByText('Portal-ready partnerships').waitFor({ timeout: 10000 });
    recorder.assert(
      'Selected-person workspace separates common grant work from admin authority',
      await page.getByText('Common access work', { exact: true }).isVisible() &&
        await page.getByText('Customer, partner, and Technician access', { exact: true }).isVisible() &&
        await page.getByText('Admin authority', { exact: true }).isVisible()
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'admin-access-corporate-partner-before-save.png'),
      fullPage: true,
    });

    if (!(await page.getByRole('button', { name: 'Grant and send invite' }).isVisible().catch(() => false))) {
      console.log(await page.locator('body').innerText());
      console.log('Console/page errors:', unexpectedConsoleErrors(consoleErrors));
      console.log('RPC calls:', state.rpcCalls.map((call) => call.rpcName).join(', '));
    }

    recorder.assert(
      'Corporate Partner selected-person card removed grant-only CTA',
      !(await page.getByRole('button', { name: 'Grant access only' }).isVisible().catch(() => false))
    );
    recorder.assert(
      'Corporate Partner selected-person card exposes one grant-and-send CTA',
      await page.getByRole('button', { name: 'Grant and send invite' }).isVisible()
    );
    recorder.assert(
      'Partner-wide setup is separated from person invite form',
      await page.getByText('Partner portal setup').first().isVisible()
    );
    recorder.assert(
      'Partner portal setup starts collapsed when partner scope is ready',
      await page.evaluate(() => {
        const details = [...document.querySelectorAll('details')].find((element) =>
          element.textContent?.includes('Partner portal setup')
        );
        return details ? !details.open : false;
      })
    );
    recorder.assert(
      'Corporate Partner person workspace shows prerequisite checklist',
      await page.getByText('Grant this person partner access').first().isVisible() &&
        await page.getByText('Person email').first().isVisible() &&
        await page.getByText('Partner portal access').first().isVisible()
    );
    recorder.assert(
      'Corporate Partner checklist shows missing grant reason before save',
      await page.getByText('5 of 6 requirements ready').isVisible()
    );

    await page.selectOption('#person-corporate-partner', noPortalPartnerId);
    await page.getByText('Partner portal setup is required before invite.').waitFor({ timeout: 10000 });
    await page.fill('#person-corporate-reason', 'Missing prerequisite UAT check');
    recorder.assert(
      'Corporate Partner save stays disabled when portal access prerequisite is missing',
      await page.getByRole('button', { name: 'Grant and send invite' }).isDisabled()
    );
    recorder.assert(
      'Corporate Partner missing prerequisite checklist names portal access',
      await page.getByText('Enable partner portal access below before inviting this person.').isVisible()
    );

    await page.selectOption('#person-corporate-partner', partnerId);

    await page.fill('#person-corporate-reason', 'Agent UAT Corporate Partner grant');
    await page.getByRole('button', { name: 'Grant and send invite' }).click();
    await waitForCondition(() => state.accessInviteBodies.length === 1, 'Corporate Partner invite');
    await page.getByText(/Last invite sent/i).waitFor({ timeout: 10000 });

    const inviteBody = state.accessInviteBodies[0];
    recorder.assert(
      'Corporate Partner grant calls access-invite during save',
      inviteBody?.inviteType === 'corporate_partner' &&
        inviteBody?.sourceId === state.memberships[0]?.id &&
        inviteBody?.targetEmail === targetEmail &&
        String(inviteBody?.loginUrl ?? '').includes('intent=corporate_partner'),
      JSON.stringify(inviteBody)
    );
    recorder.assert(
      'Corporate Partner invite delivery evidence is visible',
      state.inviteDeliveries.length === 1 &&
        state.inviteDeliveries[0]?.delivery_status === 'sent' &&
        state.inviteDeliveries[0]?.target_email === targetEmail,
      JSON.stringify(state.inviteDeliveries[0])
    );

    await page.locator(`label[for="admin-technician-machine-${machineId}"]`).click();
    await page.locator(`label[for="admin-technician-machine-${machineTwoId}"]`).click();
    await page.fill('#admin-technician-reason', 'Agent UAT Technician multi-machine grant');
    await page.getByRole('button', { name: 'Save and send Technician invite' }).click();
    await waitForCondition(() => state.accessInviteBodies.length === 2, 'Technician invite');

    const technicianGrantCall = state.rpcCalls.find(
      (call) => call.rpcName === 'admin_grant_technician_access'
    );
    recorder.assert(
      'Admin Technician save sends selected machine array',
      Array.isArray(technicianGrantCall?.body?.p_machine_ids) &&
        technicianGrantCall.body.p_machine_ids.length === 2 &&
        technicianGrantCall.body.p_machine_ids.includes(machineId) &&
        technicianGrantCall.body.p_machine_ids.includes(machineTwoId),
      JSON.stringify(technicianGrantCall?.body)
    );
    recorder.assert(
      'Admin Technician save calls access-invite during save',
      state.accessInviteBodies[1]?.inviteType === 'technician' &&
        state.accessInviteBodies[1]?.sourceId === state.technicianGrants[0]?.grantId &&
        state.accessInviteBodies[1]?.targetEmail === targetEmail &&
        String(state.accessInviteBodies[1]?.loginUrl ?? '').includes('intent=technician'),
      JSON.stringify(state.accessInviteBodies[1])
    );

    await page.getByTestId('machine-scope-source-map').getByText('Why machines are visible').waitFor({
      timeout: 10000,
    });
    const sourceMapText = await page.getByTestId('machine-scope-source-map').innerText();
    recorder.assert(
      'Machine source map explains Corporate Partner visibility',
      sourceMapText.includes('Corporate Partner') &&
        sourceMapText.includes('Bubble Planet') &&
        sourceMapText.includes(machineId),
      sourceMapText
    );
    recorder.assert(
      'Machine source map explains Technician visibility',
      sourceMapText.includes('Technician') &&
        sourceMapText.includes('Bubble Planet Pier 39') &&
        sourceMapText.includes(machineTwoId),
      sourceMapText
    );

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    recorder.assert('Admin Access desktop has no horizontal overflow', !overflow);

    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(250);
    await page.screenshot({
      path: path.join(args.artifactDir, 'admin-access-corporate-partner-invite-desktop.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(250);
    await page.screenshot({
      path: path.join(args.artifactDir, 'admin-access-corporate-partner-invite-mobile.png'),
      fullPage: true,
    });

    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    recorder.assert('Admin Access mobile has no horizontal overflow', !mobileOverflow);
    recorder.assert(
      'No browser console/page errors during Admin Access invite UAT pass',
      unexpectedConsoleErrors(consoleErrors).length === 0,
      unexpectedConsoleErrors(consoleErrors).slice(0, 3).join(' | ')
    );
  } finally {
    await context.close();
    await browser.close();
  }

  const failed = recorder.failed();
  if (failed.length > 0) {
    console.error(`\n${failed.length} Admin Access invite UAT assertion(s) failed.`);
    process.exit(1);
  }

  console.log('\nAdmin Access invite UAT passed.');
  console.log(`Screenshots: ${args.artifactDir}`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
