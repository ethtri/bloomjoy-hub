// Independent acceptance: synthetic authentication and database requests only.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { installMockSupabaseRoutes, buildMockSetup, mockUser, machineId, valleyMachineId, firstManagerEmail } from './refunds/validate-machine-manager-uat.mjs';
const url = process.env.MACHINE_SIMPLE_UAT_APP_URL || 'http://127.0.0.1:8087';
const dir = path.resolve('output/playwright/machine-simple');
await mkdir(dir, { recursive: true });
const checks = [];
const check = (name, value) => { checks.push({ name, pass: Boolean(value) }); console.log(`${value ? 'PASS' : 'FAIL'} ${name}`); };
const json = data => ({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }, body: JSON.stringify(data) });
for (const [engine, browserType, width] of [['desktop', chromium, 1440], ['touch390', webkit, 390], ['touch320', webkit, 320]]) {
 const browser = await browserType.launch();
 const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 500 });
 const state = { machineType: 'snapcase', managerEmails: [firstManagerEmail], rpcCalls: [], accessInviteBodies: [], inviteDeliveries: [], globalRefundsAvailable: true, globalRefundsPaused: false, globalRefundsBlockReason: null,
  refundSetup: { refundIntakeEnabled: false, refundPublicDisplayLabel: 'Great Mall - SnapCase', nayaxMachineId: null, nayaxAccountKey: null, customerIntakeAccepting: true, cardRefundsEnabled: false, cardRefundLimitCents: null, paymentDisabledReason: 'awaiting_reviewed_activation', readinessState: 'setup_needed', readinessBlockReason: 'transaction_matching_off' } };
 await installMockSupabaseRoutes(context, state);
 await context.route('**/rest/v1/**', route => {
  if (new URL(route.request().url()).pathname.includes('/rpc/')) return route.fallback();
  if(new URL(route.request().url()).pathname.endsWith('/reporting_partnerships')) return route.fulfill(json([{id:'77777777-7777-4777-8777-777777777777',name:'Synthetic report',status:'active',effective_start_date:'2026-01-01',effective_end_date:null}]));
  if(new URL(route.request().url()).pathname.endsWith('/reporting_machines')) return route.fulfill(json(buildMockSetup(state).machines.map(m=>({...m,machine_label:m.id===machineId?name:m.machine_label,sunze_machine_id:m.id===machineId?null:m.sunze_machine_id,reporting_locations:{name:m.location_name,timezone:m.location_timezone},customer_accounts:{name:m.account_name}}))));
  return route.fulfill(json([]));
 });
 let name = 'Great Mall - SnapCase'; let extraCompanies = false; const writes = []; let mapped = false;
 await context.route('**/rest/v1/rpc/admin_get_reporting_company_choices', route => { const m = buildMockSetup(state).machines[0]; return route.fulfill(json({canCreateCompany:true,companies:[{accountId:m.account_id,accountName:m.account_name,status:'active',locations:[{locationId:m.location_id,locationName:m.location_name,timezone:m.location_timezone,status:'active'}]}, ...(extraCompanies ? [{accountId:'11111111-1111-4111-8111-111111111111',accountName:'Empty company',status:'active',locations:[]},{accountId:'22222222-2222-4222-8222-222222222222',accountName:'Multiple venues',status:'active',locations:[{locationId:'33333333-3333-4333-8333-333333333333',locationName:'Must not guess A',timezone:'America/New_York',status:'active'},{locationId:'44444444-4444-4444-8444-444444444444',locationName:'Must not guess B',timezone:'America/Chicago',status:'active'}]},{accountId:'55555555-5555-4555-8555-555555555555',accountName:'One venue',status:'active',locations:[{locationId:'66666666-6666-4666-8666-666666666666',locationName:'Do not reuse shared venue',timezone:'America/Chicago',status:'active'}]}] : [])]})); });
 const metadata = () => [{ machineId, venueLabel: 'Shared reporting venue must stay unchanged', nayaxMachineId: mapped ? 'UAT-NAYAX-002' : null, nayaxAccountKey: mapped ? 'UAT_ACCOUNT' : null, nayaxName: mapped ? 'SnapCase setup needed' : null, lastRecordedTransaction: '2026-08-01', transactionSource: 'snapcase_browser', lastSuccessfulSalesImport: '2026-08-01', sources: [{ platform: 'Kexiaozhan', name: 'Original source name with a deliberately long suffix near food court', id: '1000696', account: 'bloomjoy-production', lastSeenAt: new Date().toISOString(), lastTransaction: null, lastSuccessfulImport: null }] }, { machineId: valleyMachineId, venueLabel: null, nayaxMachineId: null, nayaxAccountKey: null, sources: [], lastRecordedTransaction: null, transactionSource: null, lastSuccessfulSalesImport: null }];
 await context.route('**/rest/v1/rpc/admin_get_partnership_reporting_setup', route => {
  const setup = buildMockSetup(state); setup.machines[0].machine_label = name; setup.machines[0].stored_machine_label = 'Internal alias'; setup.machines[0].sunze_machine_id = null; setup.partnerships=[{id:'77777777-7777-4777-8777-777777777777',name:'Synthetic report',status:'active',effective_start_date:'2026-01-01',effective_end_date:null}];
  return route.fulfill(json(setup));
 });
 await context.route('**/rest/v1/rpc/admin_get_machine_workspace_metadata', route => route.fulfill(json(metadata())));
 await context.route('**/rest/v1/rpc/admin_save_named_machine', route => {
  const body = route.request().postDataJSON(); writes.push({ rpc: 'name', body }); name = body.p_machine_label; state.refundSetup.refundPublicDisplayLabel = name;
  return route.fulfill(json({ ...buildMockSetup(state).machines[0], machine_label: name }));
 });
 await context.route('**/rest/v1/rpc/admin_save_machine_workspace_mapping', route => {
  writes.push({ rpc: 'mapping', body: route.request().postDataJSON() }); mapped = true; state.refundSetup.nayaxMachineId = 'UAT-NAYAX-002'; state.refundSetup.nayaxAccountKey = 'UAT_ACCOUNT'; return route.fulfill(json(metadata()[0]));
 });
 await context.route('**/rest/v1/rpc/admin_save_machine_refund_settings', route => { writes.push({ rpc: 'refund', body: route.request().postDataJSON() }); return route.fulfill(json({})); });
 await context.route('**/rest/v1/rpc/admin_get_sunze_machine_mapping_queue',route=>route.fulfill(json([{sunzeMachineId:'synthetic-sunze-001',sunzeMachineName:'Imported cotton candy',status:'pending',pendingRowCount:1,pendingRevenueCents:700}])));
 await context.route('**/rest/v1/rpc/admin_get_snapcase_machine_mapping_queue',route=>route.fulfill(json([{providerAccountId:'88888888-8888-4888-8888-888888888888',sourceMachineId:'synthetic-snap-001',sourceLabel:'Imported SnapCase',mappingStatus:'pending',stagedObservationCount:1}])));
 for(const rpc of ['admin_map_source_machine_to_partnership_by_id','admin_map_snapcase_machine','admin_link_sunze_source_to_machine']) await context.route(`**/rest/v1/rpc/${rpc}`,route=>{writes.push({rpc:'source',name:rpc,body:route.request().postDataJSON()});return route.fulfill(json({machineId,machineLabel:'Imported machine',partnershipName:'Synthetic report',promotedRowCount:1,promotedRevenueCents:700}));});
 const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
 try {
  await page.goto(`${url}/admin/machines`); await page.locator('#email-password').fill(mockUser.email); await page.locator('#password').fill('synthetic-password'); await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByText('1000696', { exact: false }).first().waitFor();
  await page.screenshot({ path: path.join(dir, `${engine}-portfolio.png`), fullPage: true });
  await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: /manage/i }).click();
  const sheet = page.getByRole('dialog').filter({ has: page.locator('#machine-label') }); await sheet.waitFor(); await page.waitForTimeout(350); await page.locator('[data-sonner-toast]').filter({hasText:'Signed in. Redirecting'}).waitFor({state:'hidden'});
  check(`${engine}: one legacy-public name preserved`, await page.locator('#machine-label').inputValue() === name);
  check(`${engine}: no second location/name input`, await sheet.locator('#machine-saved-location,#machine-refund-public-display-label,input[id*="venue"]').count()===0);
  check(`${engine}: no second Location disclosure or label`, await sheet.getByText(/^(Reporting details|Reporting location|Location|New location name|Location time zone)$/).count()===0 && await sheet.locator('[id$="-location"],[id$="-new-location"],[id$="-timezone"]').count()===0);
  check(`${engine}: source ID text present; legacy inputs removed`, (await sheet.innerText()).includes('1000696') && await sheet.locator('#external-machine-id, #nayax-machine-id, #physical-venue').count() === 0);
  const picker = page.getByRole('combobox', { name: 'Nayax machine', exact: true });
  check(`${engine}: one combined picker`, await picker.count() === 1 && await sheet.locator('input[id^="nayax-search"]').count() === 0);
  await page.screenshot({ path: path.join(dir, `${engine}-editor.png`) });
  await picker.click(); const search = page.getByRole('combobox', { name: 'Search Nayax machines', exact: true });
  await search.fill('no exact record matches this'); await page.getByText('No imported Nayax machines found.', {exact:true}).waitFor();
  check(`${engine}: empty search gives visible feedback`, await page.getByText('No imported Nayax machines found.', {exact:true}).isVisible());
  await search.fill(''); await search.pressSequentially('UAT-NAYAX-002');
  check(`${engine}: typing retains search focus`, await search.evaluate(e=>e===document.activeElement));
  const option = page.getByRole('option').filter({ hasText: 'UAT-NAYAX-002' }); await option.waitFor(); await page.waitForTimeout(300);
  check(`${engine}: search opens visible exact result`, await option.isVisible() && (await option.innerText()).includes('UAT_ACCOUNT'));
  await page.screenshot({ path: path.join(dir, `${engine}-picker.png`) });
  if (engine === 'desktop') { await search.press('ArrowDown'); await search.press('Enter'); } else await option.tap();
  check(`${engine}: selected record remains visible`, (await picker.innerText()).includes('UAT-NAYAX-002'));
  await search.waitFor({ state: 'hidden' }); await page.waitForTimeout(100); await picker.focus();
  let guarded = false; page.once('dialog', async dialog => { guarded = true; await dialog.dismiss(); }); await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  check(`${engine}: draft close guarded`, guarded && await sheet.isVisible());
  await page.getByRole('button', { name: 'Save Nayax match', exact: true }).click(); await page.getByText('Exact Nayax match saved.', { exact: true }).waitFor();
  const mapping = writes.find(w => w.rpc === 'mapping').body;
  check(`${engine}: exact inventory UUID; venue untouched`, mapping.p_inventory_id === '55555555-5555-4555-8555-555555555552' && mapping.p_venue_label === metadata()[0].venueLabel && !('p_nayax_machine_id' in mapping));
  const geometry = await sheet.locator('select, [role="combobox"]').evaluateAll(els => els.filter(e => e.offsetParent).map(e => ({ id: e.id || e.getAttribute('aria-label'), height: e.getBoundingClientRect().height, font: parseFloat(getComputedStyle(e).fontSize) })));
  console.log(JSON.stringify({ engine, geometry }));
  check(`${engine}: actual dropdown height/font`, geometry.length >= 3 && geometry.every(g => g.height >= 44 && g.font >= 16));
  check(`${engine}: document fits width`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const help = page.getByRole('button', { name: 'Source and import details', exact: true }); await help.click(); await page.waitForTimeout(300); check(`${engine}: help opens by touch/click`, await page.getByText('Original provider names and IDs', { exact: false }).isVisible()); await page.getByText('Original provider names and IDs', { exact: false }).focus(); await page.keyboard.press('Escape'); await page.getByText('Original provider names and IDs', {exact:false}).waitFor({state:'hidden'});
  check(`${engine}: help Escape preserves sheet and restores focus`, await sheet.isVisible() && await help.evaluate(e=>e===document.activeElement));
  await page.locator('#machine-label').fill('Great Mall - Phone Cases');
  let nameGuard = false; page.once('dialog', async dialog => {nameGuard=true; await dialog.dismiss();}); await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  check(`${engine}: unsaved name close preserves draft`, nameGuard && await page.locator('#machine-label').inputValue() === 'Great Mall - Phone Cases');
  await sheet.getByRole('button', { name: 'Save machine changes', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });
  check(`${engine}: deliberate name save uses original expected name`, writes.find(w => w.rpc === 'name')?.body.p_expected_display_name === 'Great Mall - SnapCase' && name === 'Great Mall - Phone Cases');
  await page.reload(); await page.getByRole('row').filter({ hasText: name }).waitFor();
  check(`${engine}: saved canonical name survives reload`, await page.getByRole('row').filter({ hasText: name }).count() === 1);
  await page.getByRole('button', { name: /Needs review/ }).click();
  check(`${engine}: source-less exception accessible`, await page.getByRole('row').filter({ hasText: 'Valley Mall' }).count() === 1);
  await page.goto(`${url}/admin/machines/${machineId}?tab=refunds`);
  await page.getByRole('button', { name: 'Save refund setup', exact: true }).waitFor();
  check(`${engine}: refund settings contain no mapping controls`, await page.getByRole('combobox', { name: 'Nayax machine', exact: true }).count() === 0 && await page.locator('#page-nayax-machine-id,#nayax-machine-id').count() === 0);
  const before = writes.filter(w => w.rpc === 'mapping').length;
  await page.locator('#page-refund-intake').click(); await page.getByRole('button', { name: 'Save refund setup', exact: true }).click();
  await page.waitForTimeout(150);
  const refund = writes.find(w => w.rpc === 'refund')?.body;
  check(`${engine}: refund save never sends name or mapping`, refund && Object.keys(refund).sort().join(',') === 'p_machine_id,p_reason,p_refund_intake_enabled' && writes.filter(w => w.rpc === 'mapping').length === before && !state.rpcCalls.includes('admin_set_machine_nayax_refund_config'));
  await page.goto(`${url}/admin/machines/${machineId}?tab=overview`); await page.locator('#page-machine-type').waitFor();
  const directGeometry = await page.locator('#page-machine-type,#page-machine-phase,#page-machine-company').evaluateAll(els=>els.map(e=>({height:e.getBoundingClientRect().height,font:parseFloat(getComputedStyle(e).fontSize)})));
  check(`${engine}: retained direct-route controls meet height/font`, directGeometry.length===3 && directGeometry.every(g=>g.height>=44&&g.font>=16));
  check(`${engine}: direct setup has no Location disclosure or label`, await page.getByText(/^(Reporting details|Reporting location|Location|New location name|Location time zone)$/).count()===0);
  check(`${engine}: name-only save preserves saved company/timezone association`, writes.find(w=>w.rpc==='name').body.p_location_id===buildMockSetup(state).machines[0].location_id && writes.find(w=>w.rpc==='name').body.p_new_location_name===null && writes.find(w=>w.rpc==='name').body.p_new_location_timezone===null);
  if (engine==='desktop') {
    extraCompanies=true; await page.reload(); await page.locator('#page-machine-company').waitFor();
    for (const target of ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555']) {
      await page.locator('#page-machine-company').selectOption(target);
      check(`desktop: company ${target} needs no location UI`, await page.getByText(/^(Reporting details|Reporting location|Location|New location name)$/).count()===0);
      await page.getByRole('button',{name:'Save changes',exact:true}).click(); await page.waitForTimeout(250);
      const saved=writes.filter(w=>w.rpc==='name').at(-1).body;
      check(`desktop: company ${target} creates explicit internal association without choosing shared venue`, saved.p_account_id===target && saved.p_location_id===null && saved.p_new_location_name===`Unmapped Hub ${machineId}` && saved.p_new_location_timezone==='America/Los_Angeles');
      await page.reload(); await page.locator('#page-machine-company').waitFor();
    }
    await page.goto(`${url}/admin/machines`); await page.getByRole('button',{name:'Add machine',exact:true}).click();
    const creation=page.getByRole('dialog').filter({has:page.locator('#machine-label')}); await creation.waitFor();
    await page.locator('#machine-label').fill('New mall - Cotton Candy'); await page.locator('#machine-company').selectOption('11111111-1111-4111-8111-111111111111');
    check('desktop: new machine requires only machine name/company/time zone, no Location', await creation.getByText(/^(Reporting details|Reporting location|Location|New location name)$/).count()===0 && await page.getByLabel('Machine time zone',{exact:true}).isVisible());
    check('desktop: unknown new machine timezone is not guessed', await page.getByLabel('Machine time zone',{exact:true}).inputValue()==='');
    await page.getByLabel('Machine time zone',{exact:true}).fill('America/New_York'); await creation.getByRole('button',{name:'Save machine changes',exact:true}).click(); await creation.waitFor({state:'hidden'});
    const created=writes.filter(w=>w.rpc==='name').at(-1).body;
    check('desktop: new machine emits unique internal association and explicit reporting time zone', created.p_machine_id===null && created.p_location_id===null && /^Unmapped Hub [0-9a-f-]{36}$/.test(created.p_new_location_name) && created.p_new_location_timezone==='America/New_York' && created.p_machine_label==='New mall - Cotton Candy');
    for(const [source,id] of [['Imported cotton candy','synthetic-sunze-001'],['Imported SnapCase','synthetic-snap-001']]) {
      await page.reload(); await page.getByText(source,{exact:true}).waitFor();
      await page.locator('div.border-b').filter({has:page.getByText(source,{exact:true})}).getByRole('button',{name:'Set up',exact:true}).click();
      const setup=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Set Up Imported Machine',exact:true})}); await setup.waitFor();
      await page.locator('#imported-machine-company').selectOption('11111111-1111-4111-8111-111111111111');
      check(`desktop: ${source} discovery hides Location and keeps exact source ID`, await setup.getByText(/^(Reporting details|Reporting location|Location|New location name)$/).count()===0 && await page.locator('#imported-machine-external-id').inputValue()===id && await page.locator('#imported-machine-external-id').getAttribute('readonly')!==null);
      check(`desktop: ${source} unknown timezone explicit`, await page.getByLabel('Machine time zone',{exact:true}).isVisible() && await page.getByLabel('Machine time zone',{exact:true}).inputValue()==='');
      await page.getByLabel('Machine time zone',{exact:true}).fill('America/New_York');
      if(id.includes('sunze')) await page.locator('#imported-machine-partnership').selectOption('77777777-7777-4777-8777-777777777777');
      await page.screenshot({path:path.join(dir,`desktop-discovery-${id}.png`)});
      await setup.getByRole('button',{name:'Finish Setup',exact:true}).click(); await setup.waitFor({state:'hidden'});
      const submitted=writes.filter(w=>w.rpc==='source').at(-1).body;
      check(`desktop: ${source} source identity and explicit internal association saved`, (submitted.p_external_machine_id||submitted.p_source_machine_id)===id && submitted.p_location_id===null && submitted.p_location_name.includes(id) && submitted.p_location_timezone==='America/New_York' && (!id.includes('snap')||submitted.p_provider_account_id==='88888888-8888-4888-8888-888888888888'));
    }
    await page.reload(); await page.locator('#existing-sunze-synthetic-sunze-001').selectOption(machineId); await page.getByRole('button',{name:'Connect source',exact:true}).click(); await page.getByText('Source connected to the existing Hub machine. Open Manage to choose its Nayax match.',{exact:true}).waitFor();
    check('desktop: Sunze existing link preserves exact source and Hub IDs without name/location rewrite', writes.filter(w=>w.name==='admin_link_sunze_source_to_machine').at(-1).body.p_source_machine_id==='synthetic-sunze-001' && Object.keys(writes.filter(w=>w.name==='admin_link_sunze_source_to_machine').at(-1).body).sort().join(',')==='p_machine_id,p_source_machine_id');
    await page.reload(); await page.locator('div.border-b').filter({has:page.getByText('Imported SnapCase',{exact:true})}).getByRole('button',{name:'Set up',exact:true}).click();
    await page.locator('#imported-machine-mode').selectOption('existing'); await page.locator('#imported-machine-existing').selectOption(machineId);
    check('desktop: Kexiaozhan existing link has no name/location/company prompt', await page.locator('#imported-machine-label,#imported-machine-company,#imported-machine-location').count()===0);
    await page.getByRole('button',{name:'Finish Setup',exact:true}).click(); await page.getByRole('heading',{name:'Set Up Imported Machine',exact:true}).waitFor({state:'hidden'});
    const linked=writes.filter(w=>w.name==='admin_map_snapcase_machine').at(-1).body;
    check('desktop: Kexiaozhan existing link preserves source account/ID and existing Hub context', linked.p_source_machine_id==='synthetic-snap-001' && linked.p_provider_account_id==='88888888-8888-4888-8888-888888888888' && linked.p_reporting_machine_id===machineId && linked.p_location_name===null && linked.p_location_timezone===null && linked.p_machine_label===null);
  }
  console.log(JSON.stringify({ engine, errors })); check(`${engine}: no application exceptions`, errors.length === 0);
 } finally { await browser.close(); }
}
await writeFile(path.join(dir, 'results.json'), JSON.stringify(checks, null, 2));
assert(checks.every(c => c.pass), 'Independent acceptance failures; see results.json');









