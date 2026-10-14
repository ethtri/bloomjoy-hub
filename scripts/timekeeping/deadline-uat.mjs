import path from 'node:path';

export async function verifyTimeDeadlines({ page, state, args, check, profileId }) {
  state.contextLocked = false;
  state.contextMode = 'empty';
  state.loadError = false;
  await page.clock.install({ time: new Date('2026-10-05T06:59:59Z') });
  await page.goto(`${args.appUrl}/portal/time/new?date=2026-09-30&profile=${profileId}`);
  await page.getByRole('heading', { name: 'Add time', exact: true }).waitFor();
  await page.locator('#start-time').fill('12:00');
  await page.locator('#end-time').fill('13:00');
  const save = page.getByRole('button', { name: 'Save time', exact: true });
  check.assert('Deadline form is editable immediately before Pacific cutoff', await save.isEnabled());
  check.assert('Machine timezone does not change Pacific deadline',
    (await page.locator('[data-time-deadline]').innerText()).includes('October 4, 2026 at 11:59 PM Pacific'));
  const callsBefore = state.rpcCalls.filter((call) => call.rpcName === 'get_my_operator_timekeeping_context').length;
  await page.clock.fastForward(1500);
  await page.waitForFunction(() => document.querySelector('[data-time-deadline]')?.textContent.includes('closed'));
  check.assert('Open form disables save at the exact Pacific cutoff', await save.isDisabled());
  check.assert('Crossing cutoff preserves unsaved date and times',
    await page.locator('#work-date').inputValue() === '2026-09-30' &&
    await page.locator('#start-time').inputValue() === '12:00' &&
    await page.locator('#end-time').inputValue() === '13:00');
  await page.waitForFunction(() => !document.querySelector('[aria-label="Loading Timekeeping"]'));
  check.assert('Cutoff refreshes the current account context',
    state.rpcCalls.filter((call) => call.rpcName === 'get_my_operator_timekeeping_context').length > callsBefore);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#end-time').blur();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: path.join(args.artifactDir, 'deadline-closed-form-mobile.png'), fullPage: true });

  state.contextMode = 'normal';
  state.entries.push({ ...state.entries[0], id: 'cross-month-edit', workDate: '2026-10-01',
    technicianEditable: true, technicianCutoffAt: '2026-11-05T08:00:00Z', status: 'submitted' });
  await page.goto(`${args.appUrl}/portal/time/cross-month-edit/edit?date=2026-10-01&month=2026-10&profile=${profileId}`);
  await page.locator('#work-date').waitFor();
  await page.locator('#work-date').fill('2026-09-30');
  check.assert('Moving an open entry into a closed month disables saving', await save.isDisabled());
  check.assert('Moved edit uses the selected month deadline, never the original later cutoff',
    (await page.locator('[data-time-deadline]').innerText()).includes('October 4, 2026 at 11:59 PM Pacific') &&
    !(await page.locator('[data-time-deadline]').innerText()).includes('November 4'));
  state.contextMode = 'empty';

  await page.clock.setSystemTime(new Date('2026-09-04T19:00:00Z'));
  await page.goto(`${args.appUrl}/portal`);
  await page.locator('[data-time-deadline]').waitFor();
  const deadlineLink = page.locator('[data-time-deadline] a');
  check.assert('Home prioritizes previous month during days one through four',
    (await deadlineLink.getAttribute('href')).includes('date=2026-08-31') &&
    (await deadlineLink.getAttribute('href')).includes(`profile=${profileId}`));
  check.assert('Home deadline never invents missing work in an empty month',
    !(await page.locator('[data-time-deadline]').innerText()).match(/missing|overdue|unsubmitted/i));
  for (const width of [320, 390, 1365]) {
    await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
    check.assert(`Deadline fits at ${width}px`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(args.artifactDir, `deadline-home-${width}.png`), fullPage: true });
  }
  await deadlineLink.focus();
  await page.keyboard.press('Enter');
  await page.getByText('Week of', { exact: true }).waitFor();
  check.assert('Keyboard review link opens the intended cross-month week',
    new URL(page.url()).searchParams.get('date') === '2026-08-31' &&
    await page.locator('[data-time-deadline]').count() === 2);
  check.assert('Cross-month week names both independent deadlines',
    (await page.locator('[data-time-deadline]').allTextContents()).join(' ').includes('September 4, 2026 at 11:59 PM Pacific') &&
    (await page.locator('[data-time-deadline]').allTextContents()).join(' ').includes('October 4, 2026 at 11:59 PM Pacific'));

  await page.clock.setSystemTime(new Date('2026-09-05T07:00:00Z'));
  await page.goto(`${args.appUrl}/portal`);
  await page.locator('[data-time-deadline] a').waitFor();
  check.assert('Home advances to current month once the previous one closes',
    (await page.locator('[data-time-deadline] a').getAttribute('href')).includes('date=2026-09-05'));
  await page.evaluate(() => localStorage.setItem('bloomjoy.language.v1', 'zh-Hans'));
  await page.reload();
  await page.locator('[data-time-deadline]').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-time-deadline]')?.textContent.includes('太平洋时间'));
  check.assert('Deadline and action have Chinese copy',
    (await page.locator('[data-time-deadline]').innerText()).includes('太平洋时间') &&
    (await page.locator('[data-time-deadline] a').innerText()).includes('查看'));
  await page.setViewportSize({ width: 320, height: 844 });
  check.assert('Chinese deadline fits narrow mobile', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(args.artifactDir, 'deadline-home-chinese-320.png'), fullPage: true });
}
