#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  buildContext, initialEntries, installRoutes, makeEntry, mockUser, pageOverflows,
  PROFILE_ID, ACCOUNT_ID, MACHINE_A, MACHINE_B, FIXED_NOW, jsonResponse,
} from './validate-operator-timekeeping-uat.mjs';

const appUrl = process.env.OPERATOR_TIMEKEEPING_UAT_APP_URL || 'http://127.0.0.1:8087';
const artifactDir = path.resolve('output/playwright/time-entry-drafts');
const SECOND_PROFILE = '66000000-0000-4000-8000-000000000099';
const PREFIX = 'bloomjoy-time-draft:v1:';
const browser = await chromium.launch({ headless: true });
await mkdir(artifactDir, { recursive: true });
const state = { entries: initialEntries(), nextEntryId: 1, rpcCalls: [], contextMode: 'normal' };
const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
await installRoutes(context, state);
let removeMachine = false;
let delaySave = null;
let heldResponse = null;
await context.route('**/rest/v1/rpc/get_my_operator_timekeeping_context', async (route) => {
  const body = route.request().postDataJSON();
  state.rpcCalls.push({ rpcName: 'get_my_operator_timekeeping_context', body });
  const result = buildContext(state, body.p_work_date);
  result.profiles[0].currentEntries = result.profiles[0].currentEntries.filter((entry) => entry.operatorProfileId === PROFILE_ID);
  if (removeMachine) result.profiles[0].assignedMachines = result.profiles[0].assignedMachines.filter((machine) => machine.machineId !== MACHINE_B);
  result.profiles.push({ ...result.profiles[0], id: SECOND_PROFILE, accountId: 'account-b', accountName: 'Second account',
    currentEntries: state.entries.filter((entry) => entry.operatorProfileId === SECOND_PROFILE && entry.workDate.slice(0, 7) === body.p_work_date.slice(0, 7)),
  });
  await route.fulfill(jsonResponse(result));
});
await context.route('**/rest/v1/rpc/save_operator_time_entry', async (route) => {
  if (delaySave) {
    const response = heldResponse;
    await delaySave;
    if (response) return route.fulfill(jsonResponse(response));
  }
  await route.fallback();
});
const page = await context.newPage();
await page.clock.setFixedTime(FIXED_NOW);
page.setDefaultTimeout(12_000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const url = (profile = PROFILE_ID, date = '2026-09-02') => `${appUrl}/portal/time/new?date=${date}&profile=${profile}`;
const stored = () => page.evaluate((prefix) => Object.entries(localStorage).filter(([key]) => key.startsWith(prefix)).map(([key, raw]) => ({ key, ...JSON.parse(raw) })), PREFIX);
const clear = () => page.evaluate((prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)).forEach((key) => localStorage.removeItem(key)), PREFIX);
const fill = async (start, end) => { await page.locator('#start-time').fill(start); await page.locator('#end-time').fill(end); };
const ready = async () => { await page.locator('#start-time').waitFor(); await page.waitForFunction(() => !document.querySelector('#start-time').matches(':disabled')); };
const resume = async () => {
  const button = page.getByRole('button', { name: 'Continue draft', exact: true });
  const date = await page.locator('section[aria-labelledby="time-draft-heading"] dd').first().innerText();
  await button.click();
  await button.waitFor({ state: 'hidden' });
  await ready();
  await page.waitForFunction((value) => document.querySelector('#work-date').value === value, date);
};
const check = (name, condition = true) => { assert(condition, name); console.log(`PASS ${name}`); };
const screenshot = async (name) => page.screenshot({ path: path.join(artifactDir, name), fullPage: true });

try {
  await page.goto(url());
  await page.waitForURL(/\/login/);
  await page.locator('#email-password').fill(mockUser.email);
  await page.locator('#password').fill('synthetic-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await ready();
  check('Untouched form creates no draft', (await stored()).length === 0);
  await fill('12:00', '12:30');
  await page.getByText('Draft saved on this device', { exact: true }).waitFor();
  const first = (await stored())[0];
  check('Only fields and draft metadata are stored', Object.keys(first.fields).sort().join(',') === 'endTime,machineId,startTime,workDate');
  check('Initial machine matches date assignment', first.fields.machineId === MACHINE_B);
  await page.goto(url(PROFILE_ID, '2026-09-03'));
  await page.getByRole('button', { name: 'Continue draft', exact: true }).waitFor();
  check('An explicit date link is not silently replaced', await page.locator('#work-date').inputValue() === '2026-09-03');
  await screenshot('draft-recovery-desktop.png');
  await resume();
  check('Navigation restores exact date and times', await page.locator('#work-date').inputValue() === '2026-09-02' && await page.locator('#start-time').inputValue() === '12:00' && await page.locator('#end-time').inputValue() === '12:30');
  await page.reload(); await resume();
  check('Refresh recovers the same fields', await page.locator('#start-time').inputValue() === '12:00');
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await ready();
  await page.waitForFunction(() => document.querySelector('#start-time').value === '');
  check('Explicit discard removes only this draft', (await stored()).length === 0 && await page.locator('#start-time').inputValue() === '');

  await page.goto(url(PROFILE_ID, '2026-08-24')); await ready();
  await fill('12:05', '12:50');
  await page.goto(url(PROFILE_ID, '2026-09-03')); await resume();
  check('Older-month draft restores its original machine and date', await page.locator('#work-date').inputValue() === '2026-08-24' && (await stored())[0].fields.machineId === MACHINE_A);
  await page.getByRole('button', { name: 'Back to week' }).click();
  check('Recovery updates the week together with the date', new URL(page.url()).searchParams.get('week') === '2026-08-24');
  await clear();

  await page.goto(url()); await ready(); await fill('12:00', '12:30');
  await page.locator('#technician-profile').click();
  await page.getByRole('option', { name: /Second account/ }).click();
  await ready();
  await page.waitForFunction(() => document.querySelector('#start-time').value === '');
  check('Switching accounts opens that account own blank form', await page.locator('#start-time').inputValue() === '');
  await fill('13:00', '13:20');
  await page.locator('#technician-profile').click();
  await page.getByRole('option', { name: /Bloomjoy UAT/ }).click(); await resume();
  check('Switching back restores the first account without mixing values', await page.locator('#start-time').inputValue() === '12:00' && (await stored()).length === 2);
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  check('Discard preserves another account draft', (await stored()).length === 1 && (await stored())[0].key.includes(SECOND_PROFILE));
  await clear();

  await page.goto(url()); await ready(); await fill('12:00', '12:30');
  removeMachine = true;
  await page.reload(); await resume();
  check('Removed machine never silently falls back', await page.locator('#work-machine').innerText() === 'Original machine unavailable' && (await stored())[0].fields.machineId === MACHINE_B);
  check('Removed assignment retains times', await page.locator('#start-time').inputValue() === '12:00');
  removeMachine = false; await clear();

  // An edit without a profile parameter must still locate the owning account.
  const secondEntry = { ...makeEntry({ id: 'second-entry', workDate: '2026-09-02', startTime: '09:00', endTime: '09:20' }), operatorProfileId: SECOND_PROFILE, accountId: 'account-b' };
  state.entries.push(secondEntry);
  await page.goto(`${appUrl}/portal/time/second-entry/edit?date=2026-09-02`); await ready();
  check('Direct edit finds the second account without a profile parameter', await page.locator('#start-time').inputValue() === '09:00');
  await fill('09:05', '09:25');
  check('Edit draft uses original profile and entry identity', (await stored())[0].key.includes(SECOND_PROFILE) && (await stored())[0].key.includes('edit%3Asecond-entry'));
  secondEntry.updatedAt = '2026-09-03T18:00:00.000Z';
  await page.reload();
  await page.getByRole('heading', { name: 'Your saved draft needs review' }).waitFor();
  check('Changed edit is preserved read-only without overwriting current entry', await page.getByText('09:05', { exact: true }).isVisible() && await page.locator('#start-time').isDisabled());
  await screenshot('draft-conflict-desktop.png');
  state.entries = state.entries.filter((entry) => entry.id !== secondEntry.id);
  await page.reload();
  await page.getByText('The original entry is no longer available.', { exact: false }).waitFor();
  check('Deleted original retains readable draft without creating a new entry', await page.getByText('09:05', { exact: true }).isVisible() && !(await page.getByRole('button', { name: 'Save time', exact: true }).count()));
  state.entries.push({ ...secondEntry, updatedAt: '2026-09-03T16:00:00.000Z', technicianEditable: false });
  await page.reload();
  await page.getByText('Editing has closed for the original entry.', { exact: false }).waitFor();
  check('Closed edit keeps local values and cannot save', await page.locator('#start-time').isDisabled());
  await clear();

  await page.goto(url()); await ready(); await fill('12:00', '12:30');
  state.failNextSave = true;
  await page.getByRole('button', { name: 'Save time', exact: true }).click();
  await page.locator('#time-form-error').waitFor();
  check('Network save failure preserves form and draft', await page.locator('#start-time').inputValue() === '12:00' && (await stored()).length === 1);
  let release;
  delaySave = new Promise((resolve) => { release = resolve; });
  await page.getByRole('button', { name: 'Save time', exact: true }).click();
  await page.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
  await page.locator('#end-time').fill('12:45');
  release(); delaySave = null;
  await page.getByRole('button', { name: 'Save time', exact: true }).waitFor();
  check('Delayed success keeps newer typed work and stays on the form', new URL(page.url()).pathname.endsWith('/new') && (await stored())[0].fields.endTime === '12:45');
  // Clear saved fixture row to exercise a distinct subsequent successful new entry.
  state.entries = initialEntries(); await page.reload(); await resume(); await page.locator('#end-time').fill('12:50');
  await page.getByRole('button', { name: 'Save time', exact: true }).click();
  await page.waitForURL(/\/portal\/time\?week=/);
  check('Confirmed save clears its matching draft', (await stored()).length === 0);

  state.entries = initialEntries();
  await page.goto(url()); await ready(); await fill('12:00', '12:30');
  const tab = await context.newPage(); await tab.clock.setFixedTime(FIXED_NOW);
  await tab.goto(url()); await tab.getByRole('button', { name: 'Continue draft', exact: true }).click();
  await tab.locator('#end-time').fill('12:40');
  await page.getByText('This draft changed in another tab.', { exact: false }).waitFor();
  await page.locator('#end-time').fill('12:55');
  check('Concurrent tab edits preserve the newer stored draft and local on-screen values', (await stored())[0].fields.endTime === '12:40' && await page.locator('#end-time').inputValue() === '12:55');
  await tab.close(); await clear();

  await page.goto(url()); await ready();
  await page.evaluate((prefix) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith(prefix)) throw new DOMException('Synthetic quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  }, PREFIX);
  await fill('13:00', '13:30');
  await page.getByText('Device recovery is unavailable.', { exact: false }).waitFor();
  check('Storage quota failure keeps entered values and makes recovery limitation clear', await page.locator('#start-time').inputValue() === '13:00');
  await page.getByRole('button', { name: 'Save time', exact: true }).click();
  await page.waitForURL(/\/portal\/time\?week=/);
  check('Saving time still works when draft storage is blocked');
  state.entries = initialEntries();
  await page.goto(url()); await ready();
  await page.evaluate(({ prefix, userId, accountId, profileId }) => {
    localStorage.setItem(`${prefix}${userId}:${accountId}:${profileId}:new`, '{broken');
  }, { prefix: PREFIX, userId: mockUser.id, accountId: ACCOUNT_ID, profileId: PROFILE_ID });
  await page.reload(); await ready();
  check('Corrupt draft data leaves a usable clean form', await page.locator('#start-time').inputValue() === '');
  await clear();

  await page.goto(url()); await ready(); await fill('12:00', '12:30');
  delaySave = new Promise((resolve) => { release = resolve; });
  await page.getByRole('button', { name: 'Save time', exact: true }).click();
  await page.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await page.waitForURL(/\/portal$/);
  const homeResponse = page.waitForResponse((response) => response.url().includes('/rpc/save_operator_time_entry'));
  release(); delaySave = null;
  await homeResponse; await page.waitForLoadState('networkidle');
  check('A save that finishes after leaving Time never pulls the user away from Home', new URL(page.url()).pathname === '/portal');
  state.entries = initialEntries();

  await page.goto(url()); await ready(); await fill('12:00', '12:30');
  const savedState = await context.storageState();
  const restarted = await browser.newContext({ storageState: savedState, viewport: { width: 390, height: 844 } });
  await installRoutes(restarted, { ...state, entries: initialEntries() });
  const restartPage = await restarted.newPage(); await restartPage.clock.setFixedTime(FIXED_NOW);
  await restartPage.goto(url());
  await restartPage.getByRole('button', { name: 'Continue draft', exact: true }).waitFor();
  check('Browser restart retains recoverable private draft');
  await restarted.close();

  await page.reload();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: 'Continue draft', exact: true }).waitFor();
    check(`Recovery actions fit ${width}px`, !(await pageOverflows(page)).overflows);
    await screenshot(`draft-recovery-${width}.png`);
  }
  await page.evaluate(() => localStorage.setItem('bloomjoy.language.v1', 'zh-Hans'));
  await page.reload();
  await page.getByRole('button', { name: '继续草稿', exact: true }).waitFor();
  check('Chinese recovery is readable at 320px', !(await pageOverflows(page)).overflows);
  await screenshot('draft-recovery-chinese-320.png');
  await page.getByRole('button', { name: '继续草稿', exact: true }).focus(); await page.keyboard.press('Enter');
  await ready();
  await page.waitForFunction(() => document.querySelector('#work-date') === document.activeElement);
  check('Keyboard Continue restores form and focuses work date', await page.locator('#work-date').evaluate((element) => element === document.activeElement));
  await page.evaluate(() => localStorage.setItem('bloomjoy.language.v1', 'en')); await page.reload(); await resume();
  await page.setViewportSize({ width: 1365, height: 900 });
  const logoutTab = await context.newPage(); await logoutTab.clock.setFixedTime(FIXED_NOW); await logoutTab.goto(url());
  await logoutTab.getByRole('button', { name: 'Continue draft', exact: true }).waitFor();
  const previousUserEntry = { ...makeEntry({ id: 'private-previous-user', workDate: '2026-09-02', startTime: '12:00', endTime: '12:30' }), machineLabel: 'Private previous-user record' };
  heldResponse = { timeEntry: previousUserEntry, context: buildContext({ ...state, entries: [previousUserEntry] }, '2026-09-02') };
  delaySave = new Promise((resolve) => { release = resolve; });
  await page.getByRole('button', { name: 'Save time', exact: true }).click();
  await page.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open profile menu', exact: true }).click();
  await page.getByRole('menuitem', { name: /sign out/i }).click();
  await page.waitForURL(/\/login|\/$/);
  await logoutTab.waitForURL(/\/login|\/$/);
  check('Sign-out clears device drafts and updates other tabs', (await stored()).length === 0);
  await logoutTab.close();
  await page.evaluate(({ key, draft }) => localStorage.setItem(key, JSON.stringify(draft)), { key: first.key, draft: first });
  mockUser.id = '66000000-0000-4000-8000-000000000002';
  await page.locator('#email-password').fill(mockUser.email);
  await page.locator('#password').fill('synthetic-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/portal$/);
  await page.getByRole('link', { name: 'Time', exact: true }).click();
  await page.getByRole('button', { name: 'Add time', exact: true }).first().click();
  await ready();
  check('A different signed-in identity cannot see the previous user draft', (await stored()).length === 0 && await page.locator('#start-time').inputValue() === '');
  const identityResponse = page.waitForResponse((response) => response.url().includes('/rpc/save_operator_time_entry'));
  release(); delaySave = null; heldResponse = null;
  await identityResponse; await page.waitForLoadState('networkidle');
  check('Previous user held save cannot navigate the newly signed-in user', new URL(page.url()).pathname.endsWith('/new'));
  await page.getByRole('button', { name: 'Back to week' }).click();
  await page.getByRole('heading', { name: 'Time', exact: true }).waitFor();
  check('Previous user held save cannot repopulate the new identity time cache', !(await page.locator('body').innerText()).includes('Private previous-user record'));
  await page.getByRole('button', { name: 'Add time', exact: true }).first().click(); await ready();
  await fill('13:00', '13:10');
  check('New identity draft has its own namespace', (await stored())[0].key.includes(mockUser.id));
  check('No unexpected browser exceptions', errors.length === 0);
  console.log(`Draft browser UAT passed. Screenshots: ${artifactDir}`);
} finally {
  await browser.close();
}
