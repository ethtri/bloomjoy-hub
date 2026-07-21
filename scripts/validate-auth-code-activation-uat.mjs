import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_APP_URL = 'http://127.0.0.1:8081';
const DEFAULT_ARTIFACT_DIR = 'output/playwright/issue-609';
const TEST_EMAIL = 'invitee@example.test';
const TEST_PASSWORD = 'Bloomjoy-Test-609!';

const parseArgs = (argv) => {
  const args = {
    appUrl: process.env.AUTH_CODE_UAT_APP_URL || DEFAULT_APP_URL,
    artifactDir: process.env.AUTH_CODE_UAT_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR,
    headed: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--headed') args.headed = true;
    else if (arg === '--app-url') args.appUrl = argv[++index] || args.appUrl;
    else if (arg.startsWith('--app-url=')) args.appUrl = arg.slice('--app-url='.length);
    else if (arg === '--artifact-dir') args.artifactDir = argv[++index] || args.artifactDir;
    else if (arg.startsWith('--artifact-dir=')) args.artifactDir = arg.slice('--artifact-dir='.length);
  }

  args.appUrl = args.appUrl.replace(/\/+$/, '');
  args.artifactDir = path.resolve(process.cwd(), args.artifactDir);
  return args;
};

const jsonResponse = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  },
  body: JSON.stringify(body),
});

const buildUser = (email = TEST_EMAIL) => ({
  id: '60900000-0000-4000-8000-000000000609',
  aud: 'authenticated',
  role: 'authenticated',
  email,
  email_confirmed_at: new Date().toISOString(),
  confirmed_at: new Date().toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
});

const buildSession = (token, email = TEST_EMAIL) => ({
  access_token: token,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: `${token}-refresh`,
  user: buildUser(email),
});

const createRecorder = () => {
  const results = [];
  return {
    assert(name, condition, detail = '') {
      results.push({ name, pass: Boolean(condition), detail });
      console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
    },
    failed() {
      return results.filter((result) => !result.pass);
    },
  };
};

const installMockRoutes = async (context, state) => {
  await context.route('**/auth/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postDataJSON?.() ?? {};

    if (method === 'OPTIONS') return route.fulfill({ status: 204, body: '' });

    if (url.pathname.endsWith('/otp')) {
      state.otpRequests.push(body);
      return route.fulfill(jsonResponse({}));
    }

    if (url.pathname.endsWith('/verify')) {
      state.verifyRequests.push(body);
      if (Object.values(body).some((value) => value === '000000')) {
        return route.fulfill(jsonResponse({ code: 'otp_expired', message: 'Token has expired or is invalid' }, 403));
      }
      if (Object.values(body).some((value) => value === '111111')) {
        return route.fulfill(jsonResponse({ code: 'otp_disabled', message: 'Token has already been used or superseded' }, 403));
      }

      state.activationToken = `temporary-${body.type}-token`;
      return route.fulfill(jsonResponse(buildSession(state.activationToken, body.email)));
    }

    if (url.pathname.endsWith('/user') && method === 'PUT') {
      state.passwordUpdates.push({
        body,
        authorization: request.headers().authorization ?? '',
      });
      return route.fulfill(jsonResponse({ user: buildUser() }));
    }

    if (url.pathname.endsWith('/user')) {
      const authorization = request.headers().authorization ?? '';
      if (!authorization || authorization.endsWith('undefined')) {
        return route.fulfill(jsonResponse({ message: 'No session' }, 401));
      }
      return route.fulfill(jsonResponse(buildUser()));
    }

    if (url.pathname.endsWith('/logout')) {
      state.logoutRequests += 1;
      return route.fulfill({ status: 204, body: '' });
    }

    if (url.pathname.endsWith('/token')) {
      state.passwordSignIns.push(body);
      state.primaryToken = 'persistent-password-token';
      return route.fulfill(jsonResponse(buildSession(state.primaryToken, body.email)));
    }

    return route.fulfill(jsonResponse({}));
  });

  await context.route('**/rest/v1/**', (route) => route.fulfill(jsonResponse([])));
  await context.route('**/functions/v1/**', (route) => route.fulfill(jsonResponse({})));
};

const readSupabaseStorageKeys = (page) =>
  page.evaluate(() =>
    Object.keys(window.localStorage).filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token'))
  );

const fillOtp = async (page, selector, value) => {
  const input = page.locator(selector);
  await input.focus();
  await input.fill(value);
};

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const recorder = createRecorder();
  await mkdir(args.artifactDir, { recursive: true });

  const response = await fetch(args.appUrl).catch(() => null);
  if (!response?.ok) {
    throw new Error(`Unable to reach ${args.appUrl}. Start the app with npm run dev:uat first.`);
  }

  const browser = await chromium.launch({ headless: !args.headed });
  try {
    {
      const state = {
        otpRequests: [],
        verifyRequests: [],
        passwordUpdates: [],
        passwordSignIns: [],
        logoutRequests: 0,
      };
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await installMockRoutes(context, state);
      const page = await context.newPage();
      const inviteUrl = `${args.appUrl}/login?intent=technician&email=${encodeURIComponent(TEST_EMAIL)}`;

      await page.goto(inviteUrl, { waitUntil: 'domcontentloaded' });
      await page.getByText('Technician invite').waitFor();
      recorder.assert(
        'Stable invite URL prefetch consumes no authentication token',
        state.verifyRequests.length === 0 && state.otpRequests.length === 0
      );
      recorder.assert(
        'Invite landing defaults to Email Code',
        (await page.getByRole('button', { name: 'Email Code', exact: true }).getAttribute('aria-pressed')) === 'true'
      );

      await page.getByRole('button', { name: 'Send Email Code' }).click();
      await page.getByText('Check your email').waitFor();
      recorder.assert(
        'Invite requests a code for the invited email',
        state.otpRequests.length === 1 && state.otpRequests[0]?.email === TEST_EMAIL
      );

      await fillOtp(page, '#email-code', '000000');
      await page.getByRole('button', { name: 'Verify Email Code' }).click();
      await page.waitForTimeout(500);
      recorder.assert(
        'Invalid invite code stays on login with recovery guidance',
        new URL(page.url()).pathname === '/login' && /invalid|expired/i.test(await page.locator('body').innerText()),
        JSON.stringify(state.verifyRequests.at(-1) ?? {})
      );
      recorder.assert(
        'Expired invite code retains a fresh-code recovery action',
        /Try again in \d+s|Send another code/i.test(await page.locator('body').innerText())
      );

      await fillOtp(page, '#email-code', '111111');
      await page.getByRole('button', { name: 'Verify Email Code' }).click();
      await page.waitForTimeout(500);
      recorder.assert(
        'Consumed or superseded invite code fails closed with recovery guidance',
        new URL(page.url()).pathname === '/login' &&
          state.verifyRequests.at(-1)?.token === '111111' &&
          /invalid|expired/i.test(await page.locator('body').innerText())
      );

      await fillOtp(page, '#email-code', '123456');
      await page.getByRole('button', { name: 'Verify Email Code' }).click();
      await page.waitForURL('**/reset-password?**');
      recorder.assert(
        'Invite code uses explicit email OTP verification',
        state.verifyRequests.at(-1)?.type === 'email'
      );
      recorder.assert(
        'Invite verification does not persist an application session',
        (await readSupabaseStorageKeys(page)).length === 0
      );
      recorder.assert(
        'Portal remains closed until password creation',
        new URL(page.url()).pathname === '/reset-password'
      );
      await page.getByRole('heading', { name: 'Finish setting up your access' }).waitFor();
      await page
        .locator('[data-sonner-toast]')
        .evaluateAll((toasts) => toasts.forEach((toast) => toast.remove()));
      await page.screenshot({
        path: path.join(args.artifactDir, 'invite-create-password.png'),
        fullPage: true,
      });

      await page.fill('#new-password', TEST_PASSWORD);
      await page.fill('#confirm-password', TEST_PASSWORD);
      await page.getByRole('button', { name: 'Create password and sign in' }).click();
      await page.waitForURL('**/portal', { timeout: 10000 });
      recorder.assert(
        'Password update uses the temporary activation bearer',
        state.passwordUpdates.length === 1 &&
          state.passwordUpdates[0].authorization.includes('temporary-email-token')
      );
      recorder.assert(
        'Successful activation signs in with the new password',
        state.passwordSignIns.length === 1 &&
          state.passwordSignIns[0]?.email === TEST_EMAIL &&
          state.passwordSignIns[0]?.password === TEST_PASSWORD
      );
      await context.close();
    }

    {
      const state = {
        otpRequests: [],
        verifyRequests: [],
        passwordUpdates: [],
        passwordSignIns: [],
        logoutRequests: 0,
      };
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await installMockRoutes(context, state);
      const page = await context.newPage();
      await page.goto(`${args.appUrl}/login`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Choose the fastest way back in' }).waitFor();
      recorder.assert(
        'Existing password and Google sign-in choices remain available',
        (await page.getByRole('button', { name: 'Password', exact: true }).isVisible()) &&
          (await page.getByRole('button', { name: /Continue with Google/i }).isVisible())
      );
      await page.getByRole('button', { name: 'Email Code', exact: true }).click();
      await page.fill('#email-code-address', TEST_EMAIL);
      await page.getByRole('button', { name: 'Send Email Code' }).click();
      await fillOtp(page, '#email-code', '123456');
      await page.getByRole('button', { name: 'Verify Email Code' }).click();
      await page.waitForURL('**/portal', { timeout: 10000 });
      recorder.assert(
        'Ordinary Email Code login verifies an email OTP and opens the portal',
        state.verifyRequests.length === 1 && state.verifyRequests[0]?.type === 'email'
      );
      recorder.assert(
        'Ordinary Email Code login persists the application session',
        (await readSupabaseStorageKeys(page)).length === 1 && state.passwordUpdates.length === 0
      );
      await context.close();
    }

    {
      const state = {
        otpRequests: [],
        verifyRequests: [],
        passwordUpdates: [],
        passwordSignIns: [],
        logoutRequests: 0,
      };
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await installMockRoutes(context, state);
      const page = await context.newPage();
      await page.goto(
        `${args.appUrl}/login?intent=technician&email=${encodeURIComponent(TEST_EMAIL)}`,
        { waitUntil: 'domcontentloaded' }
      );
      await page.getByRole('button', { name: 'Send Email Code' }).click();
      await fillOtp(page, '#email-code', '123456');
      await page.getByRole('button', { name: 'Verify Email Code' }).click();
      await page.waitForURL('**/reset-password?**');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: 'Request a fresh activation code' }).waitFor();
      recorder.assert(
        'Reloaded or abandoned activation fails closed',
        new URL(page.url()).pathname === '/reset-password' && (await readSupabaseStorageKeys(page)).length === 0
      );
      recorder.assert(
        'Failed-closed activation provides a fresh-code path',
        (await page.getByRole('link', { name: 'Request a fresh activation code' }).getAttribute('href'))?.includes('/login?')
      );
      await page.screenshot({
        path: path.join(args.artifactDir, 'invite-expired-mobile.png'),
        fullPage: true,
      });
      await context.close();
    }

    {
      const state = {
        otpRequests: [],
        verifyRequests: [],
        passwordUpdates: [],
        passwordSignIns: [],
        logoutRequests: 0,
      };
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await installMockRoutes(context, state);
      const page = await context.newPage();
      await page.goto(`${args.appUrl}/login`, { waitUntil: 'domcontentloaded' });
      await page.fill('#email-password', TEST_EMAIL);
      await page.fill('#password', TEST_PASSWORD);
      await page.getByRole('button', { name: /Sign in with Password/i }).click();
      await page.waitForURL('**/portal', { timeout: 10000 });
      await page.goto(`${args.appUrl}/reset-password?email=other%40example.test`, {
        waitUntil: 'domcontentloaded',
      });
      await page.getByRole('button', { name: 'Verify recovery code' }).waitFor();
      recorder.assert(
        'An unrelated existing app session is not accepted as password-recovery proof',
        !(await page.getByLabel('New password').isVisible().catch(() => false)) &&
          state.verifyRequests.length === 0 &&
          state.passwordUpdates.length === 0
      );
      await context.close();
    }

    {
      const state = {
        otpRequests: [],
        verifyRequests: [],
        passwordUpdates: [],
        passwordSignIns: [],
        logoutRequests: 0,
      };
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await installMockRoutes(context, state);
      const page = await context.newPage();
      await page.goto(`${args.appUrl}/reset-password?email=${encodeURIComponent(TEST_EMAIL)}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.getByRole('heading', { name: 'Reset your password' }).waitFor();
      recorder.assert(
        'Recovery page load neither sends nor consumes an authentication code',
        state.verifyRequests.length === 0 && state.otpRequests.length === 0
      );
      await fillOtp(page, '#recovery-code', '123456');
      await page.getByRole('button', { name: 'Verify recovery code' }).click();
      await page.getByLabel('New password').waitFor();
      recorder.assert(
        'Recovery verifies only after form submission',
        state.verifyRequests.length === 1 && state.verifyRequests[0]?.type === 'recovery'
      );
      recorder.assert(
        'Recovery token never appears in browser URL',
        !page.url().includes('123456') && !/token(hash)?=/i.test(page.url())
      );
      await page.fill('#new-password', TEST_PASSWORD);
      await page.fill('#confirm-password', TEST_PASSWORD);
      await page.getByRole('button', { name: 'Update password and sign in' }).click();
      await page.waitForURL('**/portal', { timeout: 10000 });
      recorder.assert(
        'Recovery update uses temporary recovery session',
        state.passwordUpdates[0]?.authorization.includes('temporary-recovery-token')
      );
      await page.screenshot({
        path: path.join(args.artifactDir, 'recovery-complete.png'),
        fullPage: true,
      });
      await context.close();
    }

    {
      const state = {
        otpRequests: [],
        verifyRequests: [],
        passwordUpdates: [],
        passwordSignIns: [],
        logoutRequests: 0,
      };
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await installMockRoutes(context, state);
      const page = await context.newPage();
      await page.goto(`${args.appUrl}/login?activation=admin-invite`, {
        waitUntil: 'domcontentloaded',
      });
      await page.getByText(/Enter the email address that received this invitation/i).waitFor();
      recorder.assert(
        'Manual invite landing neither sends nor consumes an authentication code',
        state.verifyRequests.length === 0 && state.otpRequests.length === 0
      );
      await page.fill('#admin-invite-email', TEST_EMAIL);
      await fillOtp(page, '#email-code', '123456');
      await page.getByRole('button', { name: 'Verify Email Code' }).click();
      await page.waitForURL('**/reset-password?**');
      recorder.assert(
        'Legacy manual Supabase invite is converted to manual invite-code verification',
        state.verifyRequests.length === 1 && state.verifyRequests[0]?.type === 'invite'
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const failed = recorder.failed();
  if (failed.length > 0) {
    console.error(`Auth activation UAT failed: ${failed.length} assertion(s).`);
    process.exitCode = 1;
  } else {
    console.log('Auth activation UAT passed with synthetic data and intercepted network requests.');
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
