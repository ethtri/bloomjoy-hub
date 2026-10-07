import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { installMockSupabaseRoutes, buildMockSetup, mockUser, machineId } from './refunds/validate-machine-manager-uat.mjs';
const origin = process.env.MACHINE_SOURCE_UAT_APP_URL || 'http://127.0.0.1:8091';
assert(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const output=`output/playwright/machine-source-manage${process.argv.includes('--webkit')?'/webkit':''}`; await mkdir(output,{recursive:true});
const json=value=>({contentType:'application/json',body:JSON.stringify(value)});
const reuseMode=process.argv.includes('--existing-reader'),readerChangeMode=process.argv.includes('--reader-change'),unboundMoveMode=process.argv.includes('--unbound-reader-change');
const timezoneMode=process.argv.includes('--timezone-validation');
async function assertConfirmationReset(confirmation){const end=Date.now()+5000;while(await confirmation.isChecked()&&Date.now()<end)await confirmation.page().waitForTimeout(50);assert.equal(await confirmation.isChecked(),false,'reviewed snapshot must reset actual physical confirmation');}
async function selectZone(page,scope,query,label){await scope.getByLabel('Machine time zone',{exact:true}).click();await page.getByPlaceholder('Search city or time zone',{exact:true}).fill(query);await page.getByRole('option',{name:label,exact:typeof label==='string'}).click();}
const checks=[],browser=await (process.argv.includes('--webkit')?webkit:chromium).launch();
async function runClearedReaderHistory(){
 const context=await browser.newContext({viewport:{width:390,height:1000},hasTouch:true});
 const state={machineType:'commercial',managerEmails:['manager-two@example.test'],rpcCalls:[],accessInviteBodies:[],inviteDeliveries:[],refundSetup:{refundIntakeEnabled:false,refundPublicDisplayLabel:'Existing chosen name',nayaxMachineId:null,nayaxAccountKey:null}};
 await installMockSupabaseRoutes(context,state);let previewReads=0;const restored=[];
 await context.route('**/rest/v1/rpc/admin_preview_machine_reader_change',r=>{previewReads++;const inventoryId=r.request().postDataJSON().p_inventory_id;return r.fulfill(json({machineId,machineName:'Existing chosen name',expectedMachineUpdatedAt:'2026-10-01T00:00:00Z',currentReaderId:null,currentAccountKey:null,previousReaderId:'UAT-NAYAX-001',previousAccountKey:'UAT_ACCOUNT',hasReaderHistory:true,inventoryId,newReaderId:inventoryId==='55555555-5555-4555-8555-555555555551'?'UAT-NAYAX-001':'UAT-NAYAX-TEST',newAccountKey:'UAT_ACCOUNT',ownerMachineId:null,ownerMachineName:null,expectedOwnerUpdatedAt:null,ownerArchived:false,historicalOwnerConflict:false,timezone:'America/Los_Angeles',effectiveInstants:[]}));});
 await context.route('**/rest/v1/rpc/admin_save_machine_workspace_mapping',r=>{const body=r.request().postDataJSON();assert.deepEqual(body,{p_machine_id:machineId,p_venue_label:'',p_inventory_id:'55555555-5555-4555-8555-555555555551',p_expected_nayax_machine_id:null,p_expected_nayax_account_key:null,p_expected_venue_label:null});restored.push(body);state.refundSetup.nayaxMachineId='UAT-NAYAX-001';state.refundSetup.nayaxAccountKey='UAT_ACCOUNT';return r.fulfill(json({ok:true}));});
 const page=await context.newPage(),errors=[],failed=[];page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push(new URL(r.url()).pathname));
 try{await page.goto(`${origin}/admin/machines`);await page.locator('#email-password').fill(mockUser.email);await page.locator('#password').fill('synthetic-password');await page.getByRole('button',{name:/sign in/i}).click();await page.getByRole('button',{name:'Manage',exact:true}).first().click();const editor=page.getByRole('dialog',{name:/Edit Machine/});await editor.getByRole('combobox',{name:'Nayax machine',exact:true}).click();await page.getByRole('combobox',{name:'Search Nayax machines',exact:true}).fill('UAT-NAYAX-TEST');await page.getByRole('option').filter({hasText:'UAT-NAYAX-TEST'}).click();
  await editor.getByLabel('Actual reader change date',{exact:true}).waitFor();assert(previewReads>0&&await editor.getByLabel('Actual reader change date',{exact:true}).inputValue()===''&&!await editor.getByRole('button',{name:'Save reader change',exact:true}).isEnabled()&&await editor.getByRole('button',{name:'Save Nayax match',exact:true}).count()===0);checks.push('Cleared current pointer with original reader history still requires dated reviewed change');
  assert((await editor.innerText()).includes('Previous reader: UAT-NAYAX-001'));checks.push('Cleared-history different-reader review identifies the exact prior reader');
  assert(!state.rpcCalls.some(x=>/admin_change_machine_reader|admin_save_machine_workspace_mapping|admin_set_reporting_machine_nayax_config/.test(x)));checks.push('Cleared-history review makes no undated assignment or financial writer');
  await page.getByText('Signed in. Redirecting...',{exact:true}).waitFor({state:'hidden'});await page.screenshot({path:`${output}/cleared-reader-history-390.png`,fullPage:true});assert(errors.length===0&&failed.length===0);checks.push('Cleared-history mobile review has no app or failed-request errors');
  await editor.getByRole('combobox',{name:'Nayax machine',exact:true}).click();await page.getByRole('combobox',{name:'Search Nayax machines',exact:true}).fill('UAT-NAYAX-001');await page.getByRole('option').filter({hasText:'UAT-NAYAX-001'}).click();const restore=editor.getByRole('button',{name:'Save Nayax match',exact:true});await restore.waitFor();await page.waitForFunction(element=>!element.disabled,await restore.elementHandle(),{timeout:5000});assert(await restore.isEnabled()&&await editor.getByLabel('Actual reader change date',{exact:true}).count()===0&&await editor.getByRole('button',{name:'Save reader change',exact:true}).count()===0);checks.push('Restoring the exact prior account and reader requests no manufactured hardware-change date');
  await restore.click();await editor.getByRole('combobox',{name:'Nayax machine',exact:true}).filter({hasText:'UAT-NAYAX-001'}).waitFor();await page.waitForLoadState('networkidle');await page.reload();await page.getByRole('button',{name:'Manage',exact:true}).first().click();await editor.getByRole('combobox',{name:'Nayax machine',exact:true}).filter({hasText:'UAT-NAYAX-001'}).waitFor();assert(restored.length===1&&!state.rpcCalls.includes('admin_change_machine_reader')&&!state.machineSavePayload&&!state.refundSavePayload&&errors.length===0&&failed.length===0);checks.push('Identical restoration persists on the same Hub with one configuration writer and no dated change or unrelated saves');
 }finally{await page.waitForLoadState('networkidle');await context.close();}
}
async function runReaderChange() { for(const platform of ['Sunze','Kexiaozhan']) for(const width of [1440,390]) {
 const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width===390});
 const state={machineType:platform==='Sunze'?'commercial':'snapcase',managerEmails:['manager-two@example.test'],rpcCalls:[],accessInviteBodies:[],inviteDeliveries:[],refundSetup:{refundIntakeEnabled:false,refundPublicDisplayLabel:'Chosen machine name',nayaxMachineId:'OLD-READER-001',nayaxAccountKey:'UAT_ACCOUNT'}};
 await installMockSupabaseRoutes(context,state);const base=buildMockSetup(state);base.machines=base.machines.slice(0,1);Object.assign(base.machines[0],{machine_label:'Chosen machine name',location_timezone:'America/Los_Angeles',nayax_machine_id:'OLD-READER-001',nayax_account_key:'UAT_ACCOUNT'});
 const original=JSON.stringify(base),source={sourceKey:`${platform}:reader-change`,platform,providerAccountId:platform==='Sunze'?null:'096ca52a-444a-4d4f-9a2b-8844ddd16a95',sourceId:platform==='Sunze'?'1683202662515916906439361':'1000703',sourceName:'Original app cabinet name',reportingMachineId:machineId,mappingConflict:false,archivedMapping:false,sourceTimezone:'America/Los_Angeles'};
 const newInventory='55555555-5555-4555-8555-555555555554',ownerId='bbbbbbbb-1111-4111-8111-111111111111';let currentReader='OLD-READER-001',historicalConflict=true,previewFailure=false,metadataFailure=false,stale=false,ownerStamp='2026-10-01T00:00:00Z';const writes=[],previewReads=[],errors=[],failed=[];
 const preview={machineId,machineName:'Chosen machine name',expectedMachineUpdatedAt:'2026-10-01T00:00:00Z',currentReaderId:currentReader,currentAccountKey:'UAT_ACCOUNT',inventoryId:newInventory,newReaderId:'OCCUPIED-READER-002',newAccountKey:'UAT_ACCOUNT',ownerMachineId:ownerId,ownerMachineName:'Original owning machine',expectedOwnerUpdatedAt:ownerStamp,ownerArchived:false,historicalOwnerConflict:true,timezone:'America/Los_Angeles',effectiveInstants:[]};
 await context.route('**/rest/v1/rpc/admin_get_partnership_reporting_setup',r=>r.fulfill(json(base)));
 await context.route('**/rest/v1/rpc/admin_get_machine_source_inventory',r=>r.fulfill(json({sources:[source],count:1})));
 await context.route('**/rest/v1/rpc/admin_get_machine_workspace_metadata',r=>r.fulfill(metadataFailure?{...json({message:'Synthetic committed reader refresh unavailable'}),status:500}:json([{machineId,machineName:'Chosen machine name',nayaxName:'Reader display name',nayaxMachineId:currentReader,nayaxAccountKey:'UAT_ACCOUNT',salesActivationPending:false,sources:[{platform,id:source.sourceId,name:source.sourceName,account:platform==='Sunze'?null:'synthetic-kex-account'}]}])));
 await context.route('**/rest/v1/rpc/admin_get_refund_nayax_inventory',r=>r.fulfill(json({machines:[{id:newInventory,accountKey:'UAT_ACCOUNT',nayaxMachineId:'OCCUPIED-READER-002',machineName:'Occupied reader',reportingMachineId:ownerId,state:'published',providerActive:true}],lastRun:null})));
 await context.route('**/rest/v1/rpc/admin_preview_machine_reader_change',r=>{
  const body=r.request().postDataJSON();assert.equal(body.p_machine_id,machineId);assert.equal(body.p_inventory_id,newInventory);previewReads.push(body);
  const instants=body.p_changed_at_local==='2026-11-01T01:30'?['2026-11-01T08:30:00Z','2026-11-01T09:30:00Z']:[];
  return r.fulfill(previewFailure?{...json({message:'Synthetic preview unavailable'}),status:500}:json({...preview,historicalOwnerConflict:historicalConflict,expectedOwnerUpdatedAt:ownerStamp,effectiveInstants:instants}));
 });
 await context.route('**/rest/v1/rpc/admin_change_machine_reader',r=>{
  const body=r.request().postDataJSON();assert.equal(body.p_machine_id,machineId);assert.equal(body.p_inventory_id,newInventory);assert.equal(body.p_expected_machine_updated_at,preview.expectedMachineUpdatedAt);assert.equal(body.p_expected_owner_updated_at,ownerStamp);assert.equal(body.p_expected_timezone,'America/Los_Angeles');assert.equal(body.p_changed_on,'2026-11-01');assert.equal(body.p_changed_at,'2026-11-01T09:30:00Z');assert(body.p_reason);
  if(stale)return r.fulfill({...json({message:'Synthetic ownership changed; reload preview'}),status:409});writes.push(body);currentReader='OCCUPIED-READER-002';metadataFailure=true;return r.fulfill(json({machineId}));
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>{if(r.url().includes('/rest/v1/'))failed.push(new URL(r.url()).pathname);});
 const pass=(name,value)=>{assert(value,`${platform}/${width}: ${name}`);checks.push(`${platform}/${width}: ${name}`);console.log(`PASS ${platform}/${width}: ${name}`);};
 try {
  await page.goto(`${origin}/admin/machines`);await page.locator('#email-password').fill(mockUser.email);await page.locator('#password').fill('synthetic-password');await page.getByRole('button',{name:/sign in/i}).click();await page.locator('[data-source-key]').getByRole('button',{name:'Manage',exact:true}).click();
  const editor=page.getByRole('dialog',{name:/Manage Machine|Edit Machine/}),mapping=editor.getByRole('region',{name:'Source identity and Nayax matching',exact:true});await mapping.waitFor();
  pass('one editable chosen name and distinct readonly original provider identity',await editor.getByLabel('Machine name',{exact:true}).inputValue()==='Chosen machine name'&&(await mapping.innerText()).includes(source.sourceId)&&(await mapping.innerText()).includes(source.sourceName));
  await mapping.getByRole('combobox',{name:'Nayax machine',exact:true}).click();await page.getByRole('combobox',{name:'Search Nayax machines',exact:true}).fill('OCCUPIED-READER-002');await page.getByRole('option').filter({hasText:'OCCUPIED-READER-002'}).click();
  await mapping.getByText('This reader needs its historical ownership reconciled before it can move. Existing connections remain unchanged.',{exact:true}).waitFor();
  pass('historically owned reader is not misclassified free and offers owning-machine review',await mapping.getByRole('link',{name:'Open machine',exact:true}).getAttribute('href')===`/admin/machines/${ownerId}`&&!await mapping.getByRole('button',{name:'Save reader change',exact:true}).isEnabled()&&writes.length===0);
  historicalConflict=false;await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));await mapping.getByLabel('Actual reader change date',{exact:true}).waitFor();
  pass('review displays both old and proposed reader IDs and current owner',(await mapping.innerText()).includes('OLD-READER-001')&&(await mapping.innerText()).includes('OCCUPIED-READER-002')&&(await mapping.innerText()).includes('Original owning machine'));
  const date=mapping.getByLabel('Actual reader change date',{exact:true}),time=mapping.getByLabel('Actual local change time',{exact:true}),confirm=mapping.getByRole('checkbox',{name:'I reviewed the two reader IDs, ownership and actual change date.',exact:true});
  pass('replacement date starts blank and no invented instant can save',await date.inputValue()===''&&await time.inputValue()===''&&!await mapping.getByRole('button',{name:'Save reader change',exact:true}).isEnabled());
  await date.fill('2026-03-08');await time.fill('2026-03-08T02:30');await mapping.getByText('This local time does not exist in the saved time zone. Review the actual time.',{exact:true}).waitFor();pass('DST nonexistent local time blocks cross-machine move',!await confirm.isEnabled()&&writes.length===0);
  await date.fill('2026-11-01');await time.fill('2026-11-01T01:30');await mapping.getByRole('radio').nth(1).waitFor();pass('repeated local time requires explicit real UTC occurrence',await mapping.getByRole('radio').count()===2&&!await confirm.isEnabled());
  await mapping.getByRole('radio').nth(1).check();await mapping.getByLabel('Reason for this change',{exact:true}).fill('Owner confirmed reviewed physical reader move');await confirm.check();
  previewFailure=true;await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));await mapping.getByText('Reader connection unavailable.',{exact:false}).waitFor();pass('cached successful preview cannot authorize after refresh failure',!await mapping.getByRole('button',{name:'Save reader change',exact:true}).isEnabled()&&writes.length===0);
  previewFailure=false;await mapping.getByRole('button',{name:'Retry',exact:true}).click();await mapping.getByRole('radio').nth(1).waitFor();await mapping.getByRole('radio').nth(1).check();await confirm.check();
  await page.waitForLoadState('networkidle');ownerStamp='2026-10-02T00:00:00Z';await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));await page.waitForLoadState('networkidle');await page.waitForFunction(()=>Array.from(document.querySelectorAll('input[type=checkbox]')).some(e=>e.parentElement.textContent.includes('two reader IDs')&&!e.checked));pass('owner snapshot change resets attestation and UTC selection',!await confirm.isChecked()&&!await mapping.getByRole('radio').nth(1).isChecked());
  await mapping.getByRole('radio').nth(1).check();await confirm.check();await page.getByText('Signed in. Redirecting...',{exact:true}).waitFor({state:'hidden'});await page.screenshot({path:`${output}/reader-change-${platform}-${width}-review.png`,fullPage:true});
  stale=true;await mapping.getByRole('button',{name:'Save reader change',exact:true}).click();await page.getByText('Synthetic ownership changed; reload preview',{exact:true}).waitFor();pass('stale write leaves exact original Hub rows and reader unchanged',writes.length===0&&currentReader==='OLD-READER-001'&&JSON.stringify(base)===original);
  stale=false;await mapping.getByRole('button',{name:'Save reader change',exact:true}).click();await mapping.getByText('Reader connection saved',{exact:true}).waitFor();pass('successful move shows committed new reader and reads-only retry after metadata500',writes.length===1&&await mapping.getByRole('button',{name:'Save reader change',exact:true}).count()===0&&(await mapping.innerText()).includes('OCCUPIED-READER-002'));
  const retry=mapping.getByRole('button',{name:'Retry loading',exact:true});await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Retry loading'&&!b.disabled));metadataFailure=false;await retry.click();await mapping.getByRole('combobox',{name:'Nayax machine',exact:true}).waitFor();await page.waitForLoadState('networkidle');
  pass('retry verifies exact saved reader without second writer or machine save',writes.length===1&&(await mapping.innerText()).includes('OCCUPIED-READER-002')&&!state.machineSavePayload&&!state.refundSavePayload);
  await editor.getByRole('button',{name:'Close',exact:true}).click();await page.waitForLoadState('networkidle');await page.reload();await page.locator('[data-source-key]').getByRole('button',{name:'Manage',exact:true}).click();await mapping.getByRole('combobox',{name:'Nayax machine',exact:true}).waitFor();pass('reopen same source/name/Hub with saved reader and no setup duplicate',await editor.getByLabel('Machine name',{exact:true}).inputValue()==='Chosen machine name'&&(await mapping.innerText()).includes(source.sourceId)&&(await mapping.innerText()).includes('OCCUPIED-READER-002')&&writes.length===1);
  pass('no app exceptions/aborted requests or unrelated financial/name/refund/manager writers',!errors.length&&!failed.length&&!state.rpcCalls.some(c=>/admin_setup_imported_machine|admin_save_named_machine|admin_set_machine_nayax|admin_set_reporting_machine_refund_managers/.test(c.rpcName)));
 }catch(error){await page.screenshot({path:`${output}/reader-change-${platform}-${width}-failure.png`,fullPage:true});await writeFile(`${output}/reader-change-${platform}-${width}-failure.json`,JSON.stringify({dialogs:await page.getByRole('dialog').allTextContents(),writes,previewReads,errors,failed},null,2));throw error;}finally{await page.waitForLoadState('networkidle');await context.close();}
 }}

async function runExistingReader() { for(const platform of ['Sunze','Kexiaozhan']) for(const width of [1440,390]) {
 const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width===390});
 const state={machineType:'commercial',managerEmails:['manager-two@example.test'],rpcCalls:[],accessInviteBodies:[],inviteDeliveries:[],refundSetup:{refundIntakeEnabled:false,refundPublicDisplayLabel:'Historical Gilroy',nayaxMachineId:'252175281',nayaxAccountKey:'TGPACI_USA_DB'}};
 await installMockSupabaseRoutes(context,state);
 const base=buildMockSetup(state),seed=base.machines[0]; Object.assign(seed,{machine_label:'Historical Gilroy',sunze_machine_id:null,location_timezone:'America/Los_Angeles',nayax_machine_id:'252175281',nayax_account_key:'TGPACI_USA_DB'});
 const baseline=JSON.stringify(base), inventoryId='55555555-5555-4555-8555-555555555551';
 const source={sourceKey:`${platform}:exact-reuse`,platform,providerAccountId:platform==='Sunze'?null:'096ca52a-444a-4d4f-9a2b-8844ddd16a95',sourceAccountKey:platform==='Sunze'?null:'synthetic-kex-account',sourceId:platform==='Sunze'?'1683202662515916906439361':'1000703',sourceName:platform==='Sunze'?'BS04 Gilroy Outlets':'Great Mall imported SnapCase',sourceTimezone:null,lastSourceTransaction:'2026-10-04',reportingMachineId:null,mappingConflict:false,archivedMapping:false};
 const option={inventoryId,machineId,machineName:'Historical Gilroy',companyId:seed.account_id,companyName:seed.account_name,timezone:'America/Los_Angeles',expectedMachineUpdatedAt:'2026-10-06T00:00:00Z',eligible:true,reason:null};
 let readFailure=false, stale=false, refreshFailure=false; const writes=[],errors=[],failed=[];
 await context.route('**/rest/v1/rpc/admin_get_refund_nayax_inventory',r=>r.fulfill(json({machines:[{id:inventoryId,accountKey:'TGPACI_USA_DB',nayaxMachineId:'252175281',machineName:'BS03 Gilroy Outlets',reportingMachineId:machineId,state:'published',providerActive:true}],lastRun:null})));
 await context.route('**/rest/v1/rpc/admin_get_imported_source_reuse_options',r=>r.fulfill(readFailure?{...json({message:'Synthetic eligibility unavailable'}),status:500}:json([option])));
 await context.route('**/rest/v1/rpc/admin_get_machine_source_inventory',r=>r.fulfill(json({sources:[source],count:1})));
 await context.route('**/rest/v1/rpc/admin_get_partnership_reporting_setup',r=>r.fulfill(refreshFailure?{...json({message:'Synthetic continuation unavailable'}),status:500}:json({...base,machines:writes.length?base.machines:[]})));
 await context.route('**/rest/v1/rpc/admin_get_machine_workspace_metadata',r=>r.fulfill(json([{machineId,salesActivationPending:false,sourceAssociationCompleted:!!source.reportingMachineId,sources:source.reportingMachineId?[{platform,id:source.sourceId,name:source.sourceName,account:source.sourceAccountKey}]:[],nayaxName:'BS03 Gilroy Outlets',nayaxMachineId:'252175281',nayaxAccountKey:'TGPACI_USA_DB'}])));
 await context.route('**/rest/v1/rpc/admin_reuse_imported_source_machine',r=>{
  const body=r.request().postDataJSON();assert.equal(Object.keys(body).length,8);assert(body.p_reason);assert.equal(body.p_platform,platform);assert.equal(body.p_source_id,source.sourceId);assert.equal(body.p_inventory_id,inventoryId);assert.equal(body.p_expected_machine_id,machineId);assert.equal(body.p_expected_updated_at,option.expectedMachineUpdatedAt);assert.equal(body.p_expected_timezone,option.timezone);assert.equal(body.p_provider_account_id,source.providerAccountId);
  if(stale)return r.fulfill({...json({message:'Synthetic stale connection; reload'}),status:409});
  writes.push(body);source.reportingMachineId=machineId;source.salesActivationPending=false;source.sourceAssociationCompleted=true;refreshFailure=true;
  return r.fulfill(json({machineId,salesActivationPending:false,sourceAssociationCompleted:true}));
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>{if(r.url().includes('/rest/v1/'))failed.push(new URL(r.url()).pathname);});
 const pass=(name,value)=>{assert(value,`${platform}/${width}: ${name}`);checks.push(`${platform}/${width}: ${name}`);console.log(`PASS ${platform}/${width}: ${name}`);};
 try {
  await page.goto(`${origin}/admin/machines`);await page.locator('#email-password').fill(mockUser.email);await page.locator('#password').fill('synthetic-password');await page.getByRole('button',{name:/sign in/i}).click();
  await page.locator('[data-source-key]').getByRole('button',{name:'Manage',exact:true}).click();
  const editor=page.getByRole('dialog',{name:/Manage Machine|Edit Machine/});
  await editor.getByRole('combobox',{name:'Nayax machine',exact:true}).click();
  const search=page.getByRole('combobox',{name:'Search Nayax machines',exact:true});await search.fill('252175281');
  const occupied=page.getByRole('option').filter({hasText:'252175281'});pass('occupied exact reader can be explicitly selected',await occupied.isEnabled());await occupied.click();
  const review=editor.getByRole('region',{name:'Review existing machine connection'}), confirmation=review.getByRole('checkbox',{name:'These are the same machine',exact:true});
  const save=editor.getByRole('button',{name:'Save machine changes',exact:true}),details=review.locator('details'),summary=review.locator('summary');
  await review.waitFor();await page.getByText('Signed in. Redirecting...',{exact:true}).waitFor({state:'hidden'});
  pass('compact review keeps exact source/reader IDs and chosen existing Hub visible',(await editor.innerText()).includes(source.sourceId)&&(await editor.innerText()).includes('252175281')&&(await review.innerText()).includes('Historical Gilroy'));
  pass('technical preservation/accounting copy is initially collapsed',!await details.evaluate(e=>e.open)&&!(await review.innerText()).includes('Nayax supplies card revenue'));
  await summary.press('Enter');pass('connection details open by keyboard without changing the confirmation',await details.evaluate(e=>e.open)&&(await review.innerText()).includes('America/Los_Angeles')&&(await review.innerText()).includes('Source card records do not add another sale')&&!await confirmation.isChecked()&&writes.length===0);await summary.press('Enter');
  if(width===390)await summary.tap();else await summary.click();pass('connection details also open by touch or click',await details.evaluate(e=>e.open));if(width===390)await summary.tap();else await summary.click();
  await page.screenshot({path:`${output}/existing-reader-${platform}-${width}-review.png`,fullPage:true});
  pass('one footer Save requires physical confirmation and replaces the duplicate inner action',await save.count()===1&&!await save.isEnabled()&&await editor.getByLabel('Machine name',{exact:true}).count()===0&&await editor.getByLabel('Machine time zone',{exact:true}).count()===0&&await confirmation.getAttribute('type')==='checkbox');
  const actionBounds=await save.evaluate(e=>({height:e.getBoundingClientRect().height,font:parseFloat(getComputedStyle(e).fontSize),left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}));pass('sole primary action is readable and inside desktop/mobile viewport',actionBounds.height>=44&&actionBounds.font>=16&&actionBounds.left>=0&&actionBounds.right<=width);
  for(const reason of ['This machine already has another real source connection. Review it before reconciliation.','Saved machine time zone is unavailable. Review the current machine.']) {
   option.eligible=false;option.reason=reason;await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));await review.getByText(reason,{exact:true}).waitFor();
   pass(`ineligible reader explains ${reason.includes('another')?'source conflict':'missing timezone'} and offers current-machine review without write`,await review.getByRole('link',{name:'Open current machine to review its source connection'}).getAttribute('href')===`/admin/machines/${machineId}`&&!await save.isEnabled()&&writes.length===0);
   option.eligible=true;option.reason=null;await review.getByRole('button',{name:'Reload connection details',exact:true}).click();await confirmation.waitFor();
  }
  await confirmation.check();pass('physical confirmation enables exactly one Save without writing yet',await save.isEnabled()&&await save.count()===1&&writes.length===0);readFailure=true;await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));
  await review.getByText('Connection details unavailable. Reload before reviewing this reader.',{exact:true}).waitFor();
  pass('cached successful eligibility cannot authorize after read failure',!await save.isEnabled()&&writes.length===0);
  readFailure=false;await review.getByRole('button',{name:'Reload connection details',exact:true}).click();await confirmation.waitFor();
  await confirmation.check();option.expectedMachineUpdatedAt='2026-10-06T01:00:00Z';await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));
  await page.waitForLoadState('networkidle');await assertConfirmationReset(confirmation);pass('changed reviewed snapshot resets physical attestation',!await confirmation.isChecked()&&!await save.isEnabled());
  await confirmation.check();option.timezone='America/New_York';await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));await page.waitForLoadState('networkidle');await assertConfirmationReset(confirmation);pass('saved-site timezone change separately resets attestation and updates preview',!await confirmation.isChecked()&&(await details.textContent()).includes('America/New_York'));
  option.timezone='America/Los_Angeles';await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));await page.waitForLoadState('networkidle');
  await confirmation.check();stale=true;await save.click();await page.getByText('Synthetic stale connection; reload',{exact:true}).waitFor();
  pass('stale attachment leaves same source unbound and history untouched',writes.length===0&&!source.reportingMachineId&&JSON.stringify(base)===baseline);
  stale=false;await page.waitForLoadState('networkidle');pass('stale response clears attestation and reloads connection before retry',!await confirmation.isChecked());await confirmation.check();await save.click();
  await editor.getByText('Machine setup saved',{exact:true}).waitFor();pass('successful same-Hub reuse persists saved/retry state after refresh failure',writes.length===1&&source.reportingMachineId===machineId&&await editor.getByRole('button',{name:'Save machine changes',exact:true}).count()===0);
  await page.screenshot({path:`${output}/existing-reader-${platform}-${width}-saved.png`,fullPage:true});
  const retry=editor.getByRole('button',{name:'Retry loading',exact:true});await retry.waitFor();await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Retry loading'&&!b.disabled));refreshFailure=false;await retry.click();
  await editor.getByLabel('Machine name',{exact:true}).waitFor();await page.waitForLoadState('networkidle');
  pass('retry continues same historical Hub without duplicate setup or ordinary save',writes.length===1&&await editor.getByLabel('Machine name',{exact:true}).inputValue()==='Historical Gilroy'&&!state.machineSavePayload&&!state.refundSavePayload);
  pass('history-facing company/timezone/managers and setup rows unchanged',JSON.stringify(base)===baseline&&state.managerEmails[0]==='manager-two@example.test');
  pass('association completes without a separate financial activation step',(await editor.innerText()).includes(source.sourceId)&&!(await editor.innerText()).includes('Sales activation awaits reconciliation')&&!source.salesActivationPending&&source.sourceAssociationCompleted);
  await editor.getByRole('button',{name:'Close',exact:true}).click();await page.waitForLoadState('networkidle');await page.reload();
  await page.locator('[data-source-key]').getByRole('button',{name:'Manage',exact:true}).click();await editor.getByLabel('Machine name',{exact:true}).waitFor();
  pass('durable refetch/reopen shows same Hub and exact source with known zone',await editor.getByLabel('Machine name',{exact:true}).inputValue()==='Historical Gilroy'&&(await editor.innerText()).includes(source.sourceId)&&await editor.getByLabel('Machine time zone',{exact:true}).count()===0);
  pass('no source-setup/name/refund/manager financial writers',!state.rpcCalls.some(c=>/admin_setup_imported_machine|admin_save_named_machine|admin_set_machine_nayax|admin_set_reporting_machine_refund_managers/.test(c.rpcName)));
  pass('strict request failure and browser exception ledgers empty',!errors.length&&!failed.length);
 }catch(error){await page.screenshot({path:`${output}/existing-reader-${platform}-${width}-failure.png`,fullPage:true});await writeFile(`${output}/existing-reader-${platform}-${width}-failure.json`,JSON.stringify({dialogs:await page.getByRole('dialog').allTextContents(),writes,errors,failed},null,2));throw error;}finally{await page.waitForLoadState('networkidle');await context.close();}
 }}

try { if(process.argv.includes('--cleared-reader-history'))await runClearedReaderHistory(); else if(readerChangeMode) await runReaderChange(); else if(reuseMode) await runExistingReader(); else for(const platform of ['Sunze','Kexiaozhan']) for(const width of [1440,390]) {
 const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width===390});
 const state={machineType:platform==='Sunze'?'commercial':'snapcase',managerEmails:[],rpcCalls:[],accessInviteBodies:[],inviteDeliveries:[],refundSetup:{refundIntakeEnabled:false,refundPublicDisplayLabel:'Synthetic cabinet',nayaxMachineId:null,nayaxAccountKey:null}};
 await installMockSupabaseRoutes(context,state);
 const base=buildMockSetup(state),seed=base.machines[0]; base.machines=[];
 const occupiedOwner='bbbbbbbb-1111-4111-8111-111111111111';let previewFailure=false,previewDelay=0,ownerStamp='2026-10-01T00:00:00Z';
 await context.route('**/rest/v1/rpc/admin_get_imported_source_reuse_options',r=>r.fulfill(json(unboundMoveMode?[{inventoryId:'55555555-5555-4555-8555-555555555552',machineId:occupiedOwner,machineName:'Original reader owner',companyId:'aa990000-0000-4000-8000-000000000001',companyName:'Other synthetic company',timezone:'America/Los_Angeles',expectedMachineUpdatedAt:ownerStamp,eligible:false,reason:'Already connected to a different exact source'}]:[])));
 await context.route('**/rest/v1/rpc/admin_preview_imported_machine_reader_change',async r=>{if(previewDelay)await new Promise(resolve=>setTimeout(resolve,previewDelay));const body=r.request().postDataJSON();assert.equal(body.p_inventory_id,'55555555-5555-4555-8555-555555555552');return r.fulfill(previewFailure?{...json({message:'Synthetic ownership unavailable'}),status:500}:json({inventoryId:body.p_inventory_id,newReaderId:'UAT-NAYAX-002',newAccountKey:'UAT_ACCOUNT',ownerMachineId:unboundMoveMode?occupiedOwner:null,ownerMachineName:unboundMoveMode?'Original reader owner':null,expectedOwnerUpdatedAt:unboundMoveMode?ownerStamp:null,ownerArchived:false,historicalOwnerConflict:false,timezone:body.p_timezone,effectiveInstants:body.p_changed_at_local==='2026-11-01T01:30'?['2026-11-01T05:30:00Z','2026-11-01T06:30:00Z']:[]}));});
 await context.route('**/rest/v1/rpc/admin_get_reporting_company_choices',r=>r.fulfill(json({canCreateCompany:true,companies:[
  {accountId:seed.account_id,accountName:'Bloomjoy UAT',status:'active',archivedAt:null,locations:[]},
  {accountId:'aa990000-0000-4000-8000-000000000001',accountName:'Other synthetic company',status:'active',archivedAt:null,locations:[]},
 ]})));
 const source={sourceKey:`${platform}:synthetic-exact`,platform,providerAccountId:platform==='Sunze'?null:'096ca52a-444a-4d4f-9a2b-8844ddd16a95',sourceAccountKey:platform==='Sunze'?null:'synthetic-account',sourceId:platform==='Sunze'?(timezoneMode?'169398877212427032524881':'1683202662515916906439361'):'1000703',sourceName:platform==='Sunze'?(timezoneMode?'South Hills':'Gilroy imported cabinet'):'Great Mall imported cabinet',sourceStatus:null,discoveryStatus:'pending',firstSeenAt:'2026-01-01T00:00:00Z',lastSeenAt:'2026-10-05T00:00:00Z',sourceTimezone:null,lastSourceTransaction:'2026-10-04',reportingMachineId:null,mappingConflict:false,archivedMapping:false};
 const bodies=[],taxReads=[],errors=[],requestFailures=[],mappingBodies=[];let rejectedOnce=false,readerId='UAT-NAYAX-002',taxRate=8.875,taxFailure=false,continuationFailure=process.env.MACHINE_SOURCE_CONTINUATION_FAILURE==='true';
 await context.route('**/rest/v1/rpc/admin_get_partnership_reporting_setup',r=>r.fulfill(continuationFailure && bodies.length ? {...json({message:'Synthetic saved-machine refresh failure'}),status:500} : json(base)));
 await context.route('**/rest/v1/rpc/admin_get_machine_source_inventory',r=>r.fulfill(json({sources:[source],count:1})));
 await context.route('**/rest/v1/rpc/admin_get_machine_workspace_metadata',r=>r.fulfill(json(source.reportingMachineId?[{machineId,venueLabel:null,sources:[{platform,id:source.sourceId,name:source.sourceName,account:source.sourceAccountKey}],nayaxName:readerId==='UAT-NAYAX-002'?'SnapCase setup needed':'Synthetic provider test',nayaxMachineId:readerId,nayaxAccountKey:'UAT_ACCOUNT'}]:[])));
 for(const rpc of ['admin_get_imported_machine_tax','admin_reporting_machine_source_tax']) await context.route(`**/rest/v1/rpc/${rpc}`,r=>{taxReads.push({rpc,body:r.request().postDataJSON()});return r.fulfill(taxFailure?{...json({message:'Synthetic tax read unavailable'}),status:500}:json({coverageStatus:'verified_tax',source:'nayax_source',ratePercent:taxRate,saleDate:'2026-10-04'}));});
 await context.route('**/rest/v1/rpc/admin_preview_machine_reader_change',r=>r.fulfill(json({machineId,machineName:'Concise cabinet name',expectedMachineUpdatedAt:'2026-10-01T00:00:00Z',currentReaderId:readerId,currentAccountKey:'UAT_ACCOUNT',inventoryId:r.request().postDataJSON().p_inventory_id,newReaderId:'UAT-NAYAX-TEST',newAccountKey:'UAT_ACCOUNT',ownerMachineId:null,ownerMachineName:null,expectedOwnerUpdatedAt:null,ownerArchived:false,historicalOwnerConflict:false,timezone:'America/New_York',effectiveInstants:[]})));
 await context.route('**/rest/v1/rpc/admin_change_machine_reader',r=>{
  const body=r.request().postDataJSON();assert.equal(body.p_machine_id,machineId);assert.equal(body.p_inventory_id,'55555555-5555-4555-8555-555555555554');assert.equal(body.p_changed_on,'2026-10-01');assert.equal(body.p_changed_at,null);assert.equal(body.p_expected_timezone,'America/New_York');assert.equal(body.p_expected_owner_updated_at,null);assert.equal(body.p_expected_machine_updated_at,'2026-10-01T00:00:00Z');
  mappingBodies.push(body);readerId='UAT-NAYAX-TEST';taxRate=7.25;return r.fulfill(json({machineId}));
 });
 await context.route('**/rest/v1/rpc/admin_save_machine_workspace_mapping',r=>{
  const body=r.request().postDataJSON();assert.equal(body.p_machine_id,machineId);assert.equal(body.p_expected_nayax_machine_id,'UAT-NAYAX-002');assert.equal(body.p_expected_nayax_account_key,'UAT_ACCOUNT');assert.equal(body.p_inventory_id,'55555555-5555-4555-8555-555555555554');
  mappingBodies.push(body);readerId='UAT-NAYAX-TEST';taxRate=7.25;return r.fulfill(json({ok:true}));
 });
 await context.route(`**/rest/v1/rpc/${unboundMoveMode?'admin_setup_imported_machine_with_reader_change':'admin_setup_imported_machine'}`,r=>{
  const body=r.request().postDataJSON();
  assert.equal(body.p_platform,platform); assert.equal(body.p_source_id,source.sourceId); assert.equal(body.p_provider_account_id,source.providerAccountId);
  assert.equal(body.p_machine_name,'Concise cabinet name'); assert.equal(body.p_timezone,'America/New_York'); assert.equal(body.p_inventory_id,'55555555-5555-4555-8555-555555555552');
  assert.deepEqual(body.p_manager_emails,['manager-two@example.test']); assert(body.p_account_id);
  assert.equal(Object.keys(body).length,unboundMoveMode?14:11);if(unboundMoveMode){assert.equal(body.p_expected_owner_updated_at,ownerStamp);assert.equal(body.p_changed_on,'2026-11-01');assert.equal(body.p_changed_at,'2026-11-01T06:30:00Z');}
  if(!rejectedOnce){rejectedOnce=true;return r.fulfill({...json({message:'Synthetic setup rejected'}),status:400});}
  bodies.push(body);
  state.managerEmails=body.p_manager_emails;state.refundSetup.refundPublicDisplayLabel=body.p_machine_name;
  state.refundSetup.nayaxMachineId='UAT-NAYAX-002';state.refundSetup.nayaxAccountKey='UAT_ACCOUNT';
  source.sourceAssociationCompleted=true;source.salesActivationPending=false;
  base.machines=[{...seed,machine_label:body.p_machine_name,machine_type:body.p_machine_type,location_timezone:body.p_timezone,sunze_machine_id:platform==='Sunze'?source.sourceId:null,nayax_machine_id:'UAT-NAYAX-002',nayax_account_key:'UAT_ACCOUNT'}];source.reportingMachineId=machineId;
  return r.fulfill(json({machineId,sourceAssociationCompleted:true,salesActivationPending:false}));
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>{if(r.url().includes('/rest/v1/'))requestFailures.push(new URL(r.url()).pathname);});
 const pass=(label,value)=>{assert(value,`${platform}/${width}: ${label}`);checks.push(`${platform}/${width}: ${label}`);};
 try {
  await page.goto(`${origin}/admin/machines`);await page.locator('#email-password').fill(mockUser.email);await page.locator('#password').fill('synthetic-password');await page.getByRole('button',{name:/sign in/i}).click();
  await page.locator('[data-source-key]').getByRole('button',{name:'Manage',exact:true}).click();
  const editor=page.getByRole('dialog',{name:/Manage Machine|Edit Machine/}); await editor.getByLabel('Machine name',{exact:true}).waitFor();
  pass('one editor has exact readonly source identity', (await editor.innerText()).includes(source.sourceId)&&await editor.getByLabel('Machine name',{exact:true}).count()===1);
  pass('no second Location or typed provider ID input',await editor.locator('input[id*=location],select[id*=location],input[id*=sunze],input[id*=nayax]').count()===0);
  let closePrompts=0;page.on('dialog',async d=>{closePrompts++;await d.dismiss();});
  await editor.getByLabel('State',{exact:true}).selectOption('live');await page.keyboard.press('Escape');
  pass('state-only source draft is protected before company selection',closePrompts===1&&await editor.isVisible());
  await editor.getByLabel('State',{exact:true}).selectOption('setup');
  await editor.getByLabel('Machine name',{exact:true}).fill(timezoneMode&&platform==='Sunze'?'South Hills':'Concise cabinet name');
  await editor.getByLabel('Company',{exact:true}).selectOption(seed.account_id);
  pass('unknown source timezone is not guessed',(await editor.getByLabel('Machine time zone',{exact:true}).innerText()).includes('Select time zone'));
  if(!timezoneMode)await selectZone(page,editor,'New York','Eastern Time — New York');
  const picker=editor.getByRole('combobox',{name:'Nayax machine',exact:true});await picker.click();
  const search=page.getByRole('combobox',{name:'Search Nayax machines',exact:true});await search.fill('UAT-NAYAX-002');
  await page.getByText('Signed in. Redirecting...',{exact:true}).waitFor({state:'hidden'});
  await page.screenshot({path:`${output}/${platform}-${width}-picker.png`,fullPage:true});
  await page.getByRole('option').filter({hasText:'UAT-NAYAX-002'}).click();await search.waitFor({state:'hidden'});
  if(timezoneMode){
   const save=editor.getByRole('button',{name:'Save machine changes',exact:true}),zone=editor.getByLabel('Machine time zone',{exact:true});
   pass('blank real timezone selection blocks Save with visible correction',!await save.isEnabled()&&await editor.getByText('No time zone is selected.',{exact:false}).isVisible());
   await editor.getByRole('button',{name:'Choose time zone',exact:true}).click();await page.getByPlaceholder('Search city or time zone').fill('New York');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
   await page.waitForFunction(()=>document.querySelector('#machine-timezone')?.textContent.includes('Eastern'));
   await save.waitFor();await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Save machine changes'&&!b.disabled));
   pass('keyboard human Eastern selection verifies reader and allows zero managers',await save.isEnabled()&&state.managerEmails.length===0&&bodies.length===0);
   const box=await zone.boundingBox();pass('timezone control has actual 44px height and 16px text',box.height>=44&&await zone.evaluate(e=>parseFloat(getComputedStyle(e).fontSize))>=16);
   await selectZone(page,editor,'Clear','Clear time zone');pass('clearing selection removes authorization and blocks Save',!await save.isEnabled()&&(await zone.innerText()).includes('Select time zone'));
   previewDelay=600;await selectZone(page,editor,'Tokyo',/Tokyo/);await editor.getByText('Checking reader ownership before saving…',{exact:true}).waitFor();pass('pending reader verification is visible and cannot authorize Save',!await save.isEnabled());await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Save machine changes'&&!b.disabled));pass('global non-US zone is supported without typed IANA',await save.isEnabled());previewDelay=0;
   await selectZone(page,editor,'New York','Eastern Time — New York');await page.waitForLoadState('networkidle');previewFailure=true;await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));await editor.getByRole('button',{name:'Retry reader check',exact:true}).waitFor();
   pass('failed cached ownership check blocks Save and shows real Retry',!await save.isEnabled());previewFailure=false;await editor.getByRole('button',{name:'Retry reader check',exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Save machine changes'&&!b.disabled));pass('Retry only reads and restores eligibility without setup writer',await save.isEnabled()&&bodies.length===0);
   await zone.scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/timezone-${platform}-${width}.png`,fullPage:true});await zone.click();await page.getByPlaceholder('Search city or time zone').fill('Pacific');await page.screenshot({path:`${output}/timezone-${platform}-${width}-search.png`,fullPage:true});await page.keyboard.press('Escape');pass('no browser errors or failed requests',errors.length===0&&requestFailures.length===0);continue;
  }
  if(unboundMoveMode)await editor.getByRole('button',{name:'Review moving this reader to the selected source',exact:true}).click();
  pass('single combined picker retains exact selected identity',await picker.count()===1&&(await picker.innerText()).includes('UAT-NAYAX-002'));
  await editor.getByText(/8.875%/).waitFor();pass('numeric source tax uses selected exact inventory',taxReads.some(x=>x.body.p_inventory_id==='55555555-5555-4555-8555-555555555552'));
  await editor.getByLabel('People',{exact:true}).fill('manager-two@example.test');await editor.getByRole('button',{name:'Add',exact:true}).click();await editor.getByRole('button',{name:'Remove manager-two@example.test',exact:true}).waitFor();
  pass('manager selection is draft until atomic save',bodies.length===0&&!state.rpcCalls.some(c=>c.rpcName==='admin_set_reporting_machine_refund_managers'));
  if(unboundMoveMode){
   const review=editor.getByRole('region',{name:'Review reader reassignment',exact:true}),date=review.getByLabel('Actual change date',{exact:true}),time=review.getByLabel('Actual local change time (America/New_York)',{exact:true}),attestation=review.getByRole('checkbox');
   await date.waitFor();pass('occupied owner is reviewed against chosen new site timezone without invented time',(await review.innerText()).includes('Original reader owner')&&(await review.innerText()).includes(source.sourceId)&&await date.inputValue()===''&&await time.inputValue()==='');
   await date.fill('2026-11-01');await time.fill('2026-03-08T02:30');await review.getByText('This local time does not exist. Review the actual change time.',{exact:true}).waitFor();pass('unbound move blocks nonexistent local time',!await attestation.isEnabled()&&bodies.length===0);
   await time.fill('2026-11-01T01:30');await review.getByRole('radio').nth(1).check();await attestation.check();
   previewFailure=true;await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));await review.getByText('Reader ownership unavailable.',{exact:false}).waitFor();pass('cached preview failure cannot authorize atomic setup',!await editor.getByRole('button',{name:'Save machine changes',exact:true}).isEnabled()&&bodies.length===0);
   previewFailure=false;await review.getByRole('button',{name:'Retry',exact:true}).click();await review.getByRole('radio').nth(1).check();await attestation.check();
   await page.waitForLoadState('networkidle');ownerStamp='2026-10-02T00:00:00Z';await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));await page.waitForLoadState('networkidle');await page.waitForFunction(element=>!element.checked,await attestation.elementHandle(),{timeout:5000});pass('fresh owner snapshot resets reviewed instant and attestation',!await attestation.isChecked());
   await review.getByRole('radio').nth(1).check();await attestation.check();
  }
  await page.keyboard.press('Escape');
  pass('Escape protects source draft',closePrompts===2&&await editor.isVisible());
  pass('unbound manager assignment has no ineffective separate save',!await editor.getByRole('button',{name:'Save Machine Managers',exact:true}).isVisible());
  const controlDimensions=[];for(const control of [editor.getByLabel('Machine name',{exact:true}),editor.getByLabel('Company',{exact:true}),editor.getByLabel('Machine type',{exact:true}),editor.getByLabel('State',{exact:true}),picker]) {
   const dimensions=await control.evaluate(e=>({height:e.getBoundingClientRect().height,font:parseFloat(getComputedStyle(e).fontSize)}));controlDimensions.push(dimensions);
  }
  await page.getByText('Manager added to pending changes.',{exact:true}).waitFor({state:'hidden'});
  await editor.evaluate(e=>{e.scrollTop=0;});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`${output}/${platform}-${width}-draft.png`,fullPage:true});
  if(unboundMoveMode){const bounds=await editor.getByRole('button',{name:'Review moving this reader to the selected source',exact:true}).evaluate(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,height:e.getBoundingClientRect().height}));pass('occupied-reader review action fits the viewport with a usable touch height',bounds.left>=0&&bounds.right<=width&&bounds.height>=44);}
  await editor.getByRole('button',{name:'Save machine changes',exact:true}).click();
  await page.getByText('Synthetic setup rejected',{exact:true}).waitFor();
  pass('failed setup preserves exact source and all pending draft values',bodies.length===0&&source.reportingMachineId===null&&await editor.getByLabel('Machine name',{exact:true}).inputValue()==='Concise cabinet name'&&(await picker.innerText()).includes('UAT-NAYAX-002')&&await editor.getByRole('button',{name:'Remove manager-two@example.test',exact:true}).isVisible());
  await editor.getByRole('button',{name:'Save machine changes',exact:true}).click();
  if(process.env.MACHINE_SOURCE_CONTINUATION_FAILURE === 'true') {
   await editor.getByText('Machine setup saved',{exact:true}).waitFor();
   pass('committed setup shows persistent saved status without inviting duplicate creation',bodies.length===1&&await editor.getByRole('button',{name:'Save machine changes',exact:true}).count()===0&&(await editor.innerText()).includes(source.sourceId));
   const retry=editor.getByRole('button',{name:'Retry loading',exact:true});
   await retry.waitFor();
   await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Retry loading'&&!button.disabled));
   continuationFailure=false;await retry.click();
   pass('loading retry never resubmits atomic creation or normal saves',bodies.length===1&&!state.machineSavePayload&&!state.refundSavePayload);
  }
  await editor.getByLabel('Machine name',{exact:true}).waitFor();
  await editor.getByRole('region',{name:'Source identity and Nayax matching',exact:true}).waitFor();
  await page.waitForLoadState('networkidle');
  await editor.getByLabel('Machine name',{exact:true}).evaluate(async element=>{await Promise.all(element.closest('[role="dialog"]').getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));});
  pass('one atomic setup creates Hub and stays in unified editor',bodies.length===1&&await editor.isVisible()&&await editor.getByLabel('Machine name',{exact:true}).inputValue()==='Concise cabinet name');
  pass('free-reader save completes association without financial activation task',source.sourceAssociationCompleted&&!source.salesActivationPending&&!(await editor.innerText()).includes('Sales activation awaits reconciliation'));
  pass('no separate provider/name setters used during first setup',!state.rpcCalls.some(c=>/admin_set_machine_nayax|admin_set_machine_display_name/.test(c.rpcName)));
  const savedTaxReads=taxReads.filter(x=>x.rpc==='admin_reporting_machine_source_tax').length;
  await editor.getByRole('combobox',{name:'Nayax machine',exact:true}).click();
  await page.getByRole('combobox',{name:'Search Nayax machines',exact:true}).fill('UAT-NAYAX-TEST');
  await page.getByRole('option').filter({hasText:'UAT-NAYAX-TEST'}).click();
  await editor.getByLabel('Actual reader change date',{exact:true}).waitFor();
  pass('same-machine replacement reviews both readers with date only and no invented instant',(await editor.innerText()).includes('UAT-NAYAX-002')&&(await editor.innerText()).includes('UAT-NAYAX-TEST')&&await editor.getByLabel('Actual local change time',{exact:true}).count()===0&&await editor.getByRole('radio').count()===0&&await editor.getByLabel('Actual reader change date',{exact:true}).inputValue()==='');
  await editor.getByLabel('Actual reader change date',{exact:true}).fill('2026-10-01');await editor.getByLabel('Reason for this change',{exact:true}).fill('Owner confirmed failed reader replacement');await editor.getByRole('checkbox',{name:'I reviewed the two reader IDs, ownership and actual change date.',exact:true}).check();await editor.getByRole('button',{name:'Save reader change',exact:true}).click();
  await editor.getByText(/7.25%/).waitFor();
  pass('successful exact reader change refreshes numeric tax for the same Hub',mappingBodies.length===1&&taxReads.filter(x=>x.rpc==='admin_reporting_machine_source_tax').length>savedTaxReads&&!(await editor.innerText()).includes('8.875%'));
  taxFailure=true;await page.waitForLoadState('networkidle');await page.reload();
  await page.getByRole('button',{name:'Manage',exact:true}).click();
  await editor.getByText('Unavailable — no verified source tax rate',{exact:true}).waitFor();
  pass('failed tax read displays unavailable without previous reader percentage',!(await editor.innerText()).includes('7.25%')&&!(await editor.innerText()).includes('8.875%')&&mappingBodies.length===1&&bodies.length===1);
  pass('no app exceptions or aborted requests',errors.length===0&&requestFailures.length===0);pass('controls actual44px/16px',controlDimensions.every(x=>x.height>=44&&x.font>=16));
 }catch(error){await page.screenshot({path:`${output}/failure-${platform}-${width}.png`,fullPage:true});await writeFile(`${output}/failure-${platform}-${width}.json`,JSON.stringify({url:page.url(),dialogs:await page.getByRole('dialog').allTextContents(),bodies,mappingBodies,taxReads,machineSavePayload:state.machineSavePayload,rpcCalls:state.rpcCalls,errors,requestFailures},null,2));throw error;}finally{await page.waitForLoadState('networkidle');await context.close();}
} }finally{await browser.close();}
await writeFile(`${output}/${process.argv.includes('--cleared-reader-history')?'cleared-reader-history-results':unboundMoveMode?'unbound-reader-change-results':readerChangeMode?'reader-change-results':reuseMode?'reuse-results':process.env.MACHINE_SOURCE_CONTINUATION_FAILURE==='true'?'continuation-results':timezoneMode?'timezone-results':'results'}.json`,JSON.stringify((reuseMode||readerChangeMode||unboundMoveMode)?{candidate:process.env.TESTED_SHA,physicalIPhoneTested:false,financialParity:'Actual SQL release-owned; browser uses synthetic history-facing rows',checks}:checks,null,2));console.log(`${checks.length} source Manage checks PASS`);
