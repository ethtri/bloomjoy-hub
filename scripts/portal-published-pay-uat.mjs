import fs from 'node:fs';
import path from 'node:path';

// Synthetic statements only. The deliberately different summary amount reproduces
// the preparation-time mutable-item trap without using any real compensation.
export async function runPublishedPayScenarios({ browser, createPageForPersona, personas, makeWorkdayFixture, appUrl, outputDir, assert, assertNoHorizontalOverflow }) {
  const evidenceDir = path.join(outputDir, 'published-pay');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const makeFixture = () => {
    const rpc = makeWorkdayFixture();
    const summary = rpc.get_my_operator_pay_statement_context.profiles[0].statements[0];
    const july = { ...summary, id: 'published-july', statementNumber: 'SYNTHETIC-JUL-002', statementLabel: 'Pay Stub', version: 2, periodStartDate: '2026-07-01', periodEndDate: '2026-07-31', issuedAt: '2026-08-06T10:00:00Z', totalPayoutCents: 999999 };
    rpc.get_my_operator_pay_statement_context.profiles[0].statements = [{ ...summary, id: 'old-month-new-revision', version: 7, issuedAt: '2026-09-09T00:00:00Z' }, july];
    const current = { actualMinutes: 181, paidShifts: 5, shiftEarningsCents: 12500, commissionableSalesCents: 25455, commissionEarningsCents: 764, bonusCents: 1000, supplyCreditCents: 500, expenseReimbursementCents: 0, totalEarningsCents: 14764 };
    const statement = {
      schemaVersion: 'operator-pay-stub-v2', id: july.id, statementNumber: july.statementNumber, statementLabel: 'Pay Stub', status: 'issued', version: 2, issuedAt: july.issuedAt, statementDate: '2026-08-06',
      entity: { name: 'Synthetic Payer North' }, contractor: { displayName: 'Synthetic Technician With A Long Display Name', workerIdentifier: 'SYNTHETIC-01', positionTitle: 'Technician' },
      period: { periodStartDate: july.periodStartDate, periodEndDate: july.periodEndDate }, current,
      yearToDate: { ...current, paidShifts: 17, shiftEarningsCents: 40000, commissionEarningsCents: 2623, supplyCreditCents: 1500, totalEarningsCents: 45123 },
      machines: [{ machineId: 'synthetic-machine-a', machineLabel: 'Synthetic machine with a long name for narrow phone screens', grossSalesCents: 30000, refundAdjustmentCents: 2000, taxCents: 2545, commissionableSalesCents: 25455, commissionEarningsCents: 764, commissionSegments: [
        { segmentStartDate: '2026-07-01', segmentEndDate: '2026-07-15', taxRatePercent: 0, commissionBasisPoints: 200, grossSalesCents: 10000, refundAdjustmentCents: 0, taxCents: 0, commissionableSalesCents: 10000, commissionEarningsCents: 200 },
        { segmentStartDate: '2026-07-16', segmentEndDate: '2026-07-31', taxRatePercent: 9.09, commissionBasisPoints: 365, grossSalesCents: 20000, refundAdjustmentCents: 2000, taxCents: 2545, commissionableSalesCents: 15455, commissionEarningsCents: 564 },
      ] }, { machineId: 'synthetic-machine-b', machineLabel: 'Synthetic second machine', grossSalesCents: 0, refundAdjustmentCents: 0, taxCents: 0, commissionableSalesCents: 0, commissionEarningsCents: 0, commissionSegments: [] }],
      shiftRateLines: [
        { machineLabel: 'Synthetic first machine', shiftRateCents: 2400, paidShifts: 3, actualDurationMinutes: 121, shiftEarningsCents: 7200 },
        { machineLabel: 'Synthetic second machine', shiftRateCents: 2650, paidShifts: 2, actualDurationMinutes: 60, shiftEarningsCents: 5300 },
      ],
      otherEarnings: [{ description: 'Synthetic supply credit', amountCents: 500 }, { description: 'Synthetic bonus', amountCents: 1000 }],
      classificationNotice: 'Independent contractor statement. No payroll withholding or payment execution is represented.',
    };
    const artifact = value => ({ statement: value, artifact: { format: 'pdf', source: 'private_storage', storageBucket: 'operator-pay-statements', storagePath: `${value.id}.pdf`, downloadFileName: `${value.id}.pdf` } });
    return { rpc, july, artifacts: {
      [july.id]: artifact(statement),
      'old-month-new-revision': artifact({ ...statement, id: 'old-month-new-revision', version: 7, statementDate: '2026-09-09', period: { periodStartDate: '2026-06-01', periodEndDate: '2026-06-30' } }),
      'pay-stub-1': artifact({ ...statement, id: 'pay-stub-1', entity: { name: 'Synthetic Payer South' }, current: { ...current, totalEarningsCents: 6500 } }),
    } };
  };
  const create = async (viewport, options = {}) => {
    const fixture = makeFixture();
    const artifactCalls = [];
    const page = await createPageForPersona(browser, personas.timekeeper, viewport, { ...options, rpcOverrides: fixture.rpc });
    const state = { failures: 0, delay: 0 };
    await page.route('**/rest/v1/rpc/get_pay_statement_artifact', async route => {
      const id = route.request().postDataJSON().p_pay_statement_id;
      artifactCalls.push(id);
      if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
      if (state.failures > 0) { state.failures -= 1; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic statement unavailable.' }) }); }
      return route.fulfill({ status: fixture.artifacts[id] ? 200 : 403, contentType: 'application/json', body: JSON.stringify(fixture.artifacts[id] ?? { message: 'Published Pay Stub access required' }) });
    });
    await page.route('**/storage/v1/object/sign/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signedURL: '/object/sign/operator-pay-statements/synthetic.pdf?token=synthetic' }) }));
    await page.route('**/storage/v1/object/sign/operator-pay-statements/synthetic.pdf?**', route => route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'content-disposition': 'attachment; filename="synthetic.pdf"' }, body: '%PDF-1.4\n% Synthetic UAT download only\n%%EOF' }));
    return { page, fixture, artifactCalls, state };
  };
  const detailUrl = `${appUrl}/portal/time?profile=operator-profile-uat&statement=published-july#pay-stubs`;
  for (const width of [320, 390, 1366]) {
    const { page, fixture } = await create({ width, height: width < 600 ? 844 : 900 });
    await page.goto(`${appUrl}/portal`, { waitUntil: 'networkidle' });
    const card = page.locator('section[aria-labelledby="workday-pay-title"]');
    await card.locator('[data-published-pay-amount]').waitFor();
    await assert((await card.innerText()).includes('$147.64') && !(await card.innerText()).includes('$9,999.99'), 'Home must show the immutable published amount.');
    await assert((await card.getByRole('link', { name: 'View Pay Stub', exact: true }).getAttribute('href')).includes('statement=published-july'), 'Older-month revision must not replace latest period.');
    await assertNoHorizontalOverflow(page, `Published Pay Stub Home ${width}`);
    await page.screenshot({ path: path.join(evidenceDir, `home-${width}.png`), fullPage: true });
    await card.getByRole('link', { name: 'View Pay Stub', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.locator('[data-pay-stub-detail]').waitFor();
    await assert(await page.getByRole('heading', { name: 'Pay Stub', level: 1 }).evaluate(element => element === document.activeElement), 'Statement route must place keyboard focus on its heading.');
    const body = await page.locator('[data-pay-stub-detail]').innerText();
    for (const value of ['$147.64', '$451.23', '$125.00', '$7.64', '3 hr 1 min', 'Revised · Version 2']) await assert(body.includes(value), 'Published detail must preserve saved totals, duration and revision.');
    await assert(!body.includes('$9,999.99'), 'Detail must not use mutable summary total.');
    await assertNoHorizontalOverflow(page, `Published Pay Stub detail ${width}`);
    await page.screenshot({ path: path.join(evidenceDir, `detail-${width}.png`), fullPage: true });
    await page.getByText('Machine and rate details', { exact: true }).click();
    for (const value of ['$24.00', '$26.50', '$72.00', '$53.00', '3.65%', '9.09%', 'Synthetic second machine']) await assert((await page.locator('[data-pay-stub-detail]').innerText()).includes(value), 'Published machine/rate lines must use saved values.');
    await assertNoHorizontalOverflow(page, `Expanded published details ${width}`);
    if (width === 390) await page.screenshot({ path: path.join(evidenceDir, 'detail-expanded-390.png'), fullPage: true });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Pay Stub', exact: true }).click();
    await download;
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-pay-stub-detail]').waitFor();
    await assert(new URL(page.url()).searchParams.get('statement') === 'published-july', 'Reload must retain statement identity.');
    await page.getByRole('link', { name: 'Back to Pay Stubs', exact: true }).click();
    await page.locator('section#pay-stubs').waitFor();
    await assert(new URL(page.url()).searchParams.get('profile') === 'operator-profile-uat', 'Back must preserve profile.');
    await assert(!(await page.locator('section#pay-stubs').innerText()).includes('$9,999.99'), 'History must not expose a mutable amount.');
    await page.locator('#pay-profile').click();
    await page.getByRole('option', { name: 'Timekeeper UAT · Second UAT Account', exact: true }).click();
    await page.getByRole('link', { name: 'View Pay Stub', exact: true }).click();
    await page.getByRole('heading', { name: 'Synthetic Payer South' }).waitFor();
    await assert(!(await page.locator('[data-pay-stub-detail]').innerText()).includes('Synthetic Payer North'), 'Profile switch must replace statement identity.');
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Synthetic Payer South' }).waitFor();
    // New version is only current once the published context changes.
    const replacement = { ...fixture.july, id: 'published-july-v3', version: 3 };
    fixture.rpc.get_my_operator_pay_statement_context.profiles[0].statements[1] = replacement;
    fixture.artifacts[replacement.id] = { ...fixture.artifacts['published-july'], statement: { ...fixture.artifacts['published-july'].statement, id: replacement.id, version: 3, current: { ...fixture.artifacts['published-july'].statement.current, totalEarningsCents: 15900 } } };
    delete fixture.artifacts['published-july'];
    await page.goto(detailUrl, { waitUntil: 'networkidle' });
    await page.locator('main [role="alert"]').waitFor();
    await assert((await page.locator('[data-pay-stub-detail]').count()) === 0, 'Superseded direct link must not show the cached previous version.');
    await page.goto(`${appUrl}/portal`, { waitUntil: 'networkidle' });
    await card.getByText('$159.00', { exact: true }).waitFor();
    await assert((await card.getByRole('link', { name: 'View Pay Stub', exact: true }).getAttribute('href')).includes('published-july-v3'), 'Published replacement must become the current copy.');
    const stored = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join('\n'));
    await assert(!stored.includes('totalEarningsCents') && !stored.includes('SYNTHETIC-JUL-002') && !stored.includes('signedURL'), 'Pay data and signed URLs must remain out of persistent browser storage.');
    await page.context().close();
  }
  const { page: chinese } = await create({ width: 320, height: 844 }, { language: 'zh-Hans' });
  await chinese.goto(detailUrl, { waitUntil: 'networkidle' });
  await chinese.getByRole('heading', { name: '工资单详情', exact: true }).waitFor();
  await chinese.getByText('机器与费率明细', { exact: true }).click();
  await assertNoHorizontalOverflow(chinese, 'Chinese statement detail');
  await chinese.evaluate(() => window.scrollTo(0, 0));
  await chinese.screenshot({ path: path.join(evidenceDir, 'detail-zh-320.png'), fullPage: true });
  await chinese.context().close();

  const { page: recovery, state, fixture: recoveryFixture, artifactCalls } = await create({ width: 390, height: 844 }, { dashboardStatusFailureAttempts: 100, expectedArtifactStatuses: [403, 503] });
  state.delay = 800;
  await recovery.goto(detailUrl, { waitUntil: 'domcontentloaded' });
  await recovery.getByText('Loading published statement…', { exact: true }).waitFor();
  await recovery.locator('[data-pay-stub-detail]').waitFor();
  await assert((await recovery.locator('#work-date').count()) === 0, 'Pay detail must work independently of unavailable timekeeping.');
  state.delay = 0; state.failures = 1;
  await recovery.reload({ waitUntil: 'networkidle' });
  await recovery.locator('main [role="alert"]').waitFor();
  await assert((await recovery.locator('[data-pay-stub-detail]').count()) === 0, 'Failure must not present an old cached amount as a successful read.');
  await recovery.getByRole('button', { name: 'Retry status' }).click();
  await recovery.locator('[data-pay-stub-detail]').waitFor();
  const before = artifactCalls.length;
  for (const id of ['another-profile-statement', 'unpublished-draft', 'superseded-copy']) {
    await recovery.goto(`${appUrl}/portal/time?profile=operator-profile-uat&statement=${id}#pay-stubs`, { waitUntil: 'networkidle' });
    await recovery.locator('main [role="alert"]').waitFor();
  }
  await assert(artifactCalls.length === before, 'Unlisted statement identities must not initiate artifact reads.');
  recoveryFixture.artifacts['published-july'].statement = { schemaVersion: 'imported-pdf', id: 'published-july', status: 'issued' };
  await recovery.goto(detailUrl, { waitUntil: 'networkidle' });
  await recovery.getByText('A readable breakdown is not available for this statement.', { exact: false }).waitFor();
  await assert((await recovery.locator('[data-published-pay-amount]').count()) === 0, 'Unknown payload must not invent a zero amount.');
  await recovery.getByRole('button', { name: 'Download Pay Stub' }).waitFor();
  recoveryFixture.artifacts['published-july'].statement = { schemaVersion: 'operator-pay-statement-v1', id: 'published-july', status: 'issued', totals: { totalPayoutCents: 12345 } };
  await recovery.reload({ waitUntil: 'networkidle' });
  await recovery.getByText('$123.45', { exact: true }).waitFor();
  await assert((await recovery.getByRole('table').count()) === 0, 'Legacy statement must not manufacture v2 YTD or rate details.');
  delete recoveryFixture.artifacts['published-july'];
  await recovery.reload({ waitUntil: 'networkidle' });
  await recovery.locator('main [role="alert"]').waitFor();
  await recovery.context().close();
  console.log('Published Pay Stub immutable amounts, versions, profiles, private download, fallback, bilingual and responsive scenarios passed.');
}
