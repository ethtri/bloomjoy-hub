// Run with playwright-cli run-code --filename on the local demo server.
// The demo saves locally and sends no customer messages or production writes.
async (page) => {
  const base = 'http://127.0.0.1:4174/refunds/correct?demo=on&payment=cash&context=cash-change';
  const check = (value, message) => { if (!value) throw new Error(message); };
  const evidence = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(base);
    await page.getByRole('heading', { name: 'Update your refund request' }).waitFor();
    for (const field of ['issue_summary','cash_inserted_amount','expected_change_amount']) await page.locator(`#correction-${field}-answer`).selectOption('changed');
    await page.locator('#correction-zelle_payment_contact-answer').selectOption('cannot_provide');
    await page.locator('#correction-issue_summary').fill('The case was $25. I received it but got no change. I am asking for the $15 change.');
    await page.locator('#correction-cash_inserted_amount').fill('40');
    await page.locator('#correction-expected_change_amount').fill('40');
    await page.getByRole('button', {name:'Save my response',exact:true}).click();
    await page.getByRole('alert').waitFor();
    check(await page.locator('#correction-cash_inserted_amount').inputValue() === '40', 'Invalid response loses entered cash');
    await page.locator('#correction-expected_change_amount').fill('15');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Cash form overflows');
    await page.screenshot({path:`output/playwright/refund-cash-clarification-${width}.png`,fullPage:true});
    await page.getByRole('button', {name:'Save my response',exact:true}).click();
    await page.getByRole('heading', {name:'Your response is saved.',exact:true}).waitFor();
    check(await page.getByText('Someone at Bloomjoy will review your response', {exact:false}).isVisible(), 'Confirmation does not leave reviewer ownership');
    await page.goto(`${base}&lang=es`);
    await page.getByRole('heading', {name:'Actualice su solicitud de reembolso',exact:true}).waitFor();
    for (const field of ['issue_summary','cash_inserted_amount','expected_change_amount','zelle_payment_contact']) await page.locator(`#correction-${field}-answer`).selectOption('cannot_provide');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Spanish form overflows');
    await page.screenshot({path:`output/playwright/refund-cash-clarification-es-${width}.png`,fullPage:true});
    await page.getByRole('button', {name:'Guardar mi respuesta',exact:true}).click();
    await page.getByRole('heading', {name:'Su respuesta se guardó.',exact:true}).waitFor();
    evidence.push({width,englishSave:true,spanishUnknownSave:true,invalidChangeRejected:true,noHorizontalOverflow:true});
  }
  console.log(JSON.stringify({ok:true,evidence}));
}
