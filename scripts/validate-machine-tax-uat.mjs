// Independent acceptance: synthetic authentication and database requests only.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { installMockSupabaseRoutes, buildMockSetup, mockUser, machineId, valleyMachineId, firstManagerEmail } from './refunds/validate-machine-manager-uat.mjs';
const url = process.env.MACHINE_SIMPLE_UAT_APP_URL || 'http://127.0.0.1:8087';
const dir = path.resolve('output/playwright/machine-tax');
await mkdir(dir, { recursive: true });
const checks = [];
const check = (name, value) => { checks.push({ name, pass: Boolean(value) }); console.log(`${value ? 'PASS' : 'FAIL'} ${name}`); };
const json = data => ({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }, body: JSON.stringify(data) });
for (const [engine, browserType, width] of (process.env.TAX_UAT_SCOPED_ONLY ? [['scoped',chromium,1440]] : [['desktop', chromium, 1440], ['touch390', webkit, 390], ['touch320', webkit, 320], ['scoped',chromium,1440]])) {
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
 let taxRates = []; let name = 'Great Mall - SnapCase'; let extraCompanies = false; const writes = []; let mapped = false;
 await context.route('**/rest/v1/rpc/admin_get_reporting_company_choices', route => { const m = buildMockSetup(state).machines[0]; return route.fulfill(json({canCreateCompany:true,companies:[{accountId:m.account_id,accountName:m.account_name,status:'active',locations:[{locationId:m.location_id,locationName:m.location_name,timezone:m.location_timezone,status:'active'}]}, ...(extraCompanies ? [{accountId:'11111111-1111-4111-8111-111111111111',accountName:'Empty company',status:'active',locations:[]},{accountId:'22222222-2222-4222-8222-222222222222',accountName:'Multiple venues',status:'active',locations:[{locationId:'33333333-3333-4333-8333-333333333333',locationName:'Must not guess A',timezone:'America/New_York',status:'active'},{locationId:'44444444-4444-4444-8444-444444444444',locationName:'Must not guess B',timezone:'America/Chicago',status:'active'}]},{accountId:'55555555-5555-4555-8555-555555555555',accountName:'One venue',status:'active',locations:[{locationId:'66666666-6666-4666-8666-666666666666',locationName:'Do not reuse shared venue',timezone:'America/Chicago',status:'active'}]}] : [])]})); });
 const metadata = () => [{ machineId, venueLabel: 'Shared reporting venue must stay unchanged', nayaxMachineId: mapped ? 'UAT-NAYAX-002' : null, nayaxAccountKey: mapped ? 'UAT_ACCOUNT' : null, nayaxName: mapped ? 'SnapCase setup needed' : null, lastRecordedTransaction: '2026-08-01', transactionSource: 'snapcase_browser', lastSuccessfulSalesImport: '2026-08-01', sources: [{ platform: 'Kexiaozhan', name: 'Original source name with a deliberately long suffix near food court', id: '1000696', account: 'bloomjoy-production', lastSeenAt: new Date().toISOString(), lastTransaction: null, lastSuccessfulImport: null }] }, { machineId: valleyMachineId, venueLabel: null, nayaxMachineId: null, nayaxAccountKey: null, sources: [], lastRecordedTransaction: null, transactionSource: null, lastSuccessfulSalesImport: null }];
 await context.route('**/rest/v1/rpc/admin_get_partnership_reporting_setup', route => {
  const setup = buildMockSetup(state); setup.machines[0].machine_label = name; setup.machines[0].stored_machine_label = 'Internal alias'; setup.machines[0].sunze_machine_id = null; setup.taxRates = taxRates; setup.partnerships=[{id:'77777777-7777-4777-8777-777777777777',name:'Synthetic report',status:'active',effective_start_date:'2026-01-01',effective_end_date:null}];
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

 if(engine==='scoped') await context.route('**/rest/v1/rpc/get_my_admin_access_context',r=>r.fulfill(json({isSuperAdmin:false,isScopedAdmin:true,canAccessAdmin:true,allowedSurfaces:['machines'],scopedMachineIds:[machineId]})));
 const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 try {
 await page.goto(`${url}/admin/machines`); await page.locator('#email-password').fill(mockUser.email); await page.locator('#password').fill('synthetic-password'); await page.getByRole('button',{name:/sign in/i}).click();
 await page.getByText('1000696',{exact:false}).first().waitFor();
 await page.getByRole('row').filter({hasText:name}).getByRole('button',{name:/manage/i}).click();
 let tax=page.getByRole('region',{name:'Tax rate',exact:true}); await tax.waitFor();
 check(`${engine}: missing tax explicitly Not set`,(await tax.innerText()).includes('Not set'));
 check(`${engine}: no Location control`,await page.getByRole('dialog').getByText(/^(Location|Reporting details)$/).count()===0);
 await tax.getByRole('button',{name:'Set tax rate',exact:true}).click();
 await page.getByRole('heading',{name:'Set reporting tax rate',exact:true}).waitFor();
 check(`${engine}: initial tax date retained`,await page.locator('#tax-change-start').inputValue()==='2026-01-01');
 await page.getByRole('dialog').filter({has:page.locator('#tax-change-rate')}).getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Close',exact:true}).click();
 taxRates=[{id:'tax-1',machine_id:machineId,tax_rate_percent:9.25,effective_start_date:'2026-01-01',effective_end_date:null,status:'active'}];
 await page.reload(); await page.getByText('1000696',{exact:false}).first().waitFor();
 await page.getByRole('row').filter({hasText:name}).getByRole('button',{name:/manage/i}).click(); tax=page.getByRole('region',{name:'Tax rate',exact:true});
 await tax.getByText(/9.25%/).waitFor();
 check(`${engine}: percent and effective date visible`,(await tax.innerText()).includes('9.25%')&&(await tax.innerText()).includes('2026'));
 await tax.scrollIntoViewIfNeeded(); await page.screenshot({path:path.join(dir,`${engine}-tax.png`)});
 check(`${engine}: tax actions touch height`,await tax.getByRole('button').evaluateAll(es=>es.every(e=>e.getBoundingClientRect().height>=44)));
 await tax.getByRole('button',{name:'Change tax rate',exact:true}).click(); await page.getByRole('heading',{name:'Change reporting tax rate',exact:true}).waitFor();
 check(`${engine}: existing rate prefilled`,await page.locator('#tax-change-rate').inputValue()==='9.25');
 await page.getByRole('dialog').filter({has:page.locator('#tax-change-rate')}).getByRole('button',{name:'Cancel',exact:true}).click();
 await tax.getByRole('button',{name:'Rate history (1)',exact:true}).click(); await page.getByRole('heading',{name:'Reporting tax history'}).waitFor();
 check(`${engine}: history rate visible`,await page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Reporting tax history'})}).getByText('9.25%',{exact:true}).isVisible());
 await page.goto(`${url}/admin/machines/${machineId}?tab=overview`);
 tax=page.getByRole('region',{name:'Tax rate',exact:true}); await tax.getByText(/9.25%/).waitFor();
 check(`${engine}: Overview configured rate/date visible`,(await tax.innerText()).includes('2026'));
 await tax.getByRole('button',{name:'Change tax rate',exact:true}).click(); await page.getByRole('heading',{name:'Change reporting tax rate',exact:true}).waitFor();
 check(`${engine}: Overview effective date dialog`,await page.locator('#tax-change-start').inputValue()===new Date().toLocaleDateString('en-CA'));
 await page.getByRole('dialog').filter({has:page.locator('#tax-change-rate')}).getByRole('button',{name:'Cancel',exact:true}).click();
 await tax.getByRole('button',{name:'Rate history (1)',exact:true}).click(); await page.getByRole('heading',{name:'Reporting tax history'}).waitFor();
 check(`${engine}: Overview history visible`,await page.getByRole('dialog').getByText('9.25%',{exact:true}).isVisible());
 taxRates=[]; await page.reload(); tax=page.getByRole('region',{name:'Tax rate',exact:true}); await tax.getByText('Not set',{exact:true}).waitFor();
 await tax.getByRole('button',{name:'Set tax rate',exact:true}).click(); await page.getByRole('heading',{name:'Set reporting tax rate',exact:true}).waitFor();
 check(`${engine}: Overview unset initial date retained`,await page.locator('#tax-change-start').inputValue()==='2026-01-01');
 if(engine!=='scoped') { await page.goto(`${url}/admin/machines`); await page.getByText('1000696',{exact:false}).first().waitFor(); await page.getByRole('button',{name:'Add machine',exact:true}).click();
 tax=page.getByRole('region',{name:'Tax rate',exact:true}); await tax.waitFor();
 check(`${engine}: unsaved save-first instead of tax writer`,(await tax.innerText()).includes('Save the machine')&&await tax.getByRole('button').count()===0);
 }
 check(`${engine}: no tax writes`,!state.rpcCalls.some(x=>/set.*tax|change.*tax|save.*tax/.test(x)));
 check(`${engine}: no app errors`,errors.length===0);
 } finally {await context.close();await browser.close();}
}
await writeFile(path.join(dir,'results.json'),JSON.stringify(checks,null,2));
assert(checks.every(x=>x.pass)); console.log(`${checks.length} tax checks PASS`);
