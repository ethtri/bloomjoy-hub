import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installMockSupabaseRoutes, buildMockSetup, mockUser, machineId } from './refunds/validate-machine-manager-uat.mjs';
const origin = process.env.MACHINE_SOURCE_UAT_APP_URL || 'http://127.0.0.1:8091';
assert(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const output='output/playwright/machine-source-manage'; await mkdir(output,{recursive:true});
const json=value=>({contentType:'application/json',body:JSON.stringify(value)});
const checks=[],browser=await chromium.launch();
try { for(const platform of ['Sunze','Kexiaozhan']) for(const width of [1440,390]) {
 const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width===390});
 const state={machineType:platform==='Sunze'?'commercial':'snapcase',managerEmails:[],rpcCalls:[],accessInviteBodies:[],inviteDeliveries:[],refundSetup:{refundIntakeEnabled:false,refundPublicDisplayLabel:'Synthetic cabinet',nayaxMachineId:null,nayaxAccountKey:null}};
 await installMockSupabaseRoutes(context,state);
 const base=buildMockSetup(state),seed=base.machines[0]; base.machines=[];
 await context.route('**/rest/v1/rpc/admin_get_reporting_company_choices',r=>r.fulfill(json({canCreateCompany:true,companies:[
  {accountId:seed.account_id,accountName:'Bloomjoy UAT',status:'active',archivedAt:null,locations:[]},
  {accountId:'aa990000-0000-4000-8000-000000000001',accountName:'Other synthetic company',status:'active',archivedAt:null,locations:[]},
 ]})));
 const source={sourceKey:`${platform}:synthetic-exact`,platform,providerAccountId:platform==='Sunze'?null:'096ca52a-444a-4d4f-9a2b-8844ddd16a95',sourceAccountKey:platform==='Sunze'?null:'synthetic-account',sourceId:platform==='Sunze'?'1683202662515916906439361':'1000703',sourceName:platform==='Sunze'?'Gilroy imported cabinet':'Great Mall imported cabinet',sourceStatus:null,discoveryStatus:'pending',firstSeenAt:'2026-01-01T00:00:00Z',lastSeenAt:'2026-10-05T00:00:00Z',sourceTimezone:null,lastSourceTransaction:'2026-10-04',reportingMachineId:null,mappingConflict:false,archivedMapping:false};
 const bodies=[],taxReads=[],errors=[],requestFailures=[],mappingBodies=[];let rejectedOnce=false,readerId='UAT-NAYAX-002',taxRate=8.875,taxFailure=false,continuationFailure=process.env.MACHINE_SOURCE_CONTINUATION_FAILURE==='true';
 await context.route('**/rest/v1/rpc/admin_get_partnership_reporting_setup',r=>r.fulfill(continuationFailure && bodies.length ? {...json({message:'Synthetic saved-machine refresh failure'}),status:500} : json(base)));
 await context.route('**/rest/v1/rpc/admin_get_machine_source_inventory',r=>r.fulfill(json({sources:[source],count:1})));
 await context.route('**/rest/v1/rpc/admin_get_machine_workspace_metadata',r=>r.fulfill(json(source.reportingMachineId?[{machineId,venueLabel:null,sources:[{platform,id:source.sourceId,name:source.sourceName,account:source.sourceAccountKey}],nayaxName:readerId==='UAT-NAYAX-002'?'SnapCase setup needed':'Synthetic provider test',nayaxMachineId:readerId,nayaxAccountKey:'UAT_ACCOUNT'}]:[])));
 for(const rpc of ['admin_get_imported_machine_tax','admin_reporting_machine_source_tax']) await context.route(`**/rest/v1/rpc/${rpc}`,r=>{taxReads.push({rpc,body:r.request().postDataJSON()});return r.fulfill(taxFailure?{...json({message:'Synthetic tax read unavailable'}),status:500}:json({coverageStatus:'verified_tax',source:'nayax_source',ratePercent:taxRate,saleDate:'2026-10-04'}));});
 await context.route('**/rest/v1/rpc/admin_save_machine_workspace_mapping',r=>{
  const body=r.request().postDataJSON();assert.equal(body.p_machine_id,machineId);assert.equal(body.p_expected_nayax_machine_id,'UAT-NAYAX-002');assert.equal(body.p_expected_nayax_account_key,'UAT_ACCOUNT');assert.equal(body.p_inventory_id,'55555555-5555-4555-8555-555555555554');
  mappingBodies.push(body);readerId='UAT-NAYAX-TEST';taxRate=7.25;return r.fulfill(json({ok:true}));
 });
 await context.route('**/rest/v1/rpc/admin_setup_imported_machine',r=>{
  const body=r.request().postDataJSON();
  assert.equal(body.p_platform,platform); assert.equal(body.p_source_id,source.sourceId); assert.equal(body.p_provider_account_id,source.providerAccountId);
  assert.equal(body.p_machine_name,'Concise cabinet name'); assert.equal(body.p_timezone,'America/New_York'); assert.equal(body.p_inventory_id,'55555555-5555-4555-8555-555555555552');
  assert.deepEqual(body.p_manager_emails,['manager-two@example.test']); assert(body.p_account_id);
  if(!rejectedOnce){rejectedOnce=true;return r.fulfill({...json({message:'Synthetic setup rejected'}),status:400});}
  bodies.push(body);
  state.managerEmails=body.p_manager_emails;state.refundSetup.refundPublicDisplayLabel=body.p_machine_name;
  state.refundSetup.nayaxMachineId='UAT-NAYAX-002';state.refundSetup.nayaxAccountKey='UAT_ACCOUNT';
  base.machines=[{...seed,machine_label:body.p_machine_name,machine_type:body.p_machine_type,location_timezone:body.p_timezone,sunze_machine_id:platform==='Sunze'?source.sourceId:null,nayax_machine_id:'UAT-NAYAX-002',nayax_account_key:'UAT_ACCOUNT'}];source.reportingMachineId=machineId;
  return r.fulfill(json({machineId}));
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
  await editor.getByLabel('Machine name',{exact:true}).fill('Concise cabinet name');
  await editor.getByLabel('Company',{exact:true}).selectOption(seed.account_id);
  pass('unknown source timezone is not guessed',await editor.getByLabel('Machine time zone',{exact:true}).inputValue()==='');
  await editor.getByLabel('Machine time zone',{exact:true}).fill('America/New_York');
  const picker=editor.getByRole('combobox',{name:'Nayax machine',exact:true});await picker.click();
  const search=page.getByRole('combobox',{name:'Search Nayax machines',exact:true});await search.fill('UAT-NAYAX-002');
  await page.getByText('Signed in. Redirecting...',{exact:true}).waitFor({state:'hidden'});
  await page.screenshot({path:`${output}/${platform}-${width}-picker.png`,fullPage:true});
  await page.getByRole('option').filter({hasText:'UAT-NAYAX-002'}).click();await search.waitFor({state:'hidden'});
  pass('single combined picker retains exact selected identity',await picker.count()===1&&(await picker.innerText()).includes('UAT-NAYAX-002'));
  await editor.getByText(/8.875%/).waitFor();pass('numeric source tax uses selected exact inventory',taxReads.some(x=>x.body.p_inventory_id==='55555555-5555-4555-8555-555555555552'));
  await editor.getByLabel('People',{exact:true}).fill('manager-two@example.test');await editor.getByRole('button',{name:'Add',exact:true}).click();await editor.getByRole('button',{name:'Remove manager-two@example.test',exact:true}).waitFor();
  pass('manager selection is draft until atomic save',bodies.length===0&&!state.rpcCalls.some(c=>c.rpcName==='admin_set_reporting_machine_refund_managers'));
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
  pass('no separate provider/name setters used during first setup',!state.rpcCalls.some(c=>/admin_set_machine_nayax|admin_set_machine_display_name/.test(c.rpcName)));
  const savedTaxReads=taxReads.filter(x=>x.rpc==='admin_reporting_machine_source_tax').length;
  await editor.getByRole('combobox',{name:'Nayax machine',exact:true}).click();
  await page.getByRole('combobox',{name:'Search Nayax machines',exact:true}).fill('UAT-NAYAX-TEST');
  await page.getByRole('option').filter({hasText:'UAT-NAYAX-TEST'}).click();
  await editor.getByRole('button',{name:'Save Nayax match',exact:true}).click();
  await editor.getByText(/7.25%/).waitFor();
  pass('successful exact reader change refreshes numeric tax for the same Hub',mappingBodies.length===1&&taxReads.filter(x=>x.rpc==='admin_reporting_machine_source_tax').length>savedTaxReads&&!(await editor.innerText()).includes('8.875%'));
  taxFailure=true;await page.waitForLoadState('networkidle');await page.reload();
  await page.getByRole('button',{name:'Manage',exact:true}).click();
  await editor.getByText('Unavailable — no verified source tax rate',{exact:true}).waitFor();
  pass('failed tax read displays unavailable without previous reader percentage',!(await editor.innerText()).includes('7.25%')&&!(await editor.innerText()).includes('8.875%')&&mappingBodies.length===1&&bodies.length===1);
  pass('no app exceptions or aborted requests',errors.length===0&&requestFailures.length===0);pass('controls actual44px/16px',controlDimensions.every(x=>x.height>=44&&x.font>=16));
 }catch(error){await page.screenshot({path:`${output}/failure-${platform}-${width}.png`,fullPage:true});await writeFile(`${output}/failure-${platform}-${width}.json`,JSON.stringify({url:page.url(),dialogs:await page.getByRole('dialog').allTextContents(),bodies,mappingBodies,taxReads,machineSavePayload:state.machineSavePayload,rpcCalls:state.rpcCalls,errors,requestFailures},null,2));throw error;}finally{await page.waitForLoadState('networkidle');await context.close();}
} }finally{await browser.close();}
await writeFile(`${output}/${process.env.MACHINE_SOURCE_CONTINUATION_FAILURE==='true'?'continuation-results':'results'}.json`,JSON.stringify(checks,null,2));console.log(`${checks.length} source Manage checks PASS`);
