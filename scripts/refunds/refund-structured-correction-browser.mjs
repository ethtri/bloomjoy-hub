// Run with playwright-cli run-code --filename after opening localhost:4174.
// Local demo routes only; this script sends no network request or customer message.
async (page) => {
  const base = 'http://127.0.0.1:4174';
  const check = (value, message) => { if (!value) throw new Error(message); };
  const evidence = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(`${base}/refunds/correct?demo=on&context=ambiguous`);
    await page.getByRole('heading', { name: 'Update your refund request' }).waitFor();
    for (const label of [
      'How you paid', 'Card last four digits', 'Where the last four came from',
      'Card type', 'Nearby attempts or charges',
    ]) check(await page.getByText(label, { exact: false }).count() > 0, `Missing ${label}`);
    check(await page.getByText('wallet or device card can show different digits', { exact: false }).count() > 0,
      'Last-four source explanation is visible');
    await page.locator('#correction-payment_interaction-answer').selectOption('changed');
    await page.locator('#correction-payment_interaction').selectOption('tap_card');
    await page.locator('#correction-card_last4-answer').selectOption('changed');
    await page.locator('#correction-card_last4').fill('6768');
    await page.locator('#correction-card_last4_source-answer').selectOption('changed');
    await page.locator('#correction-card_last4_source').selectOption('bank_record');
    await page.locator('#correction-card_network-answer').selectOption('confirmed');
    await page.locator('#correction-nearby_attempt_count-answer').selectOption('changed');
    await page.locator('#correction-nearby_attempt_count').selectOption('multiple');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Correction page overflows');
    await page.screenshot({ path: `output/playwright/refund-structured-correction-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Save my response' }).click();
    await page.getByRole('heading', { name: 'Your response is saved.' }).waitFor();

    await page.goto(`${base}/refunds/correct?demo=on&payment=wallet`);
    await page.getByText('exact phone or watch you used', { exact: false }).waitFor();
    check(await page.getByText('phone and watch can show different', { exact: false }).count() > 0,
      'Exact-device wallet suffix guidance is visible');

    await page.goto(`${base}/refunds/correct?demo=on&context=time`);
    await page.locator('#correction-incident_time-answer').selectOption('confirmed');
    check(await page.locator('#correction-incident_time-confidence').isVisible(),
      'A confirmed clock time can still provide confidence');
    await page.locator('#correction-incident_time-confidence').selectOption('exact');
    await page.locator('#correction-incident_time_source-answer').selectOption('changed');
    await page.locator('#correction-incident_time_source').selectOption('transaction_alert_or_receipt');
    await page.getByRole('button', { name: 'Save my response' }).click();
    await page.getByRole('heading', { name: 'Your response is saved.' }).waitFor();

    await page.goto(`${base}/refunds/request?demo=on`);
    await page.getByRole('heading', { name: 'Request a refund' }).waitFor();
    check(await page.getByText('Add optional details', { exact: true }).count() === 0, 'Optional intake menu was removed');
    for (const label of ['Name (optional)', 'Phone (optional)', 'How close is the time? (optional)',
      'How did you use the card? (optional)', 'Card type (optional)',
      'Where did you find the last 4? (optional)', 'How did you find the time? (optional)']) {
      check(await page.getByLabel(label, { exact: true }).count() === 0, `Initial intake still contains ${label}`);
    }
    check(await page.getByLabel('What happened? (optional)', { exact: true }).isVisible(), 'Optional description remains available');
    await page.getByText('I used Apple Pay or another phone/watch wallet', { exact: true }).click();
    check(await page.getByLabel('Device used (optional)').isVisible(), 'Phone/watch device choice is visible');
    check(await page.getByText('exact phone or watch you used', { exact: false }).count() > 0,
      'Initial wallet suffix guidance names the exact device');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Intake page overflows');
    await page.screenshot({ path: `output/playwright/refund-structured-intake-${width}.png`, fullPage: true });
    evidence.push({ width, correctionSaved: true, intakeOptionalRemoved: true, noHorizontalOverflow: true });
  }
  console.log(JSON.stringify({ ok: true, evidence }));
}
