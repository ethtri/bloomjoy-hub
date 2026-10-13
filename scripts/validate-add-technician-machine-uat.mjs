#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import {
  installRoutes, openAuthenticated, payContext, setupContext, state,
  PROFILE_ID, ACCOUNT_ID, MACHINE_A, LOCATION_ID, FIXED_NOW,
} from './validate-manager-time-pay-reports-uat.mjs';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8081';
const NEW_MACHINES = [21,22,23].map((n) => `77000000-0000-4000-8000-${String(n).padStart(12,'0')}`);
const receiptByRequest = new Map();
let mode = 'success';
const writes = [];
const json = (body,status=200) => ({status,contentType:'application/json',body:JSON.stringify(body)});
setupContext.accounts[0].machines.push(...NEW_MACHINES.map((machineId,index)=>({machineId,machineLabel:`Additional machine ${index+1}`,locationName:'Synthetic venue',operationalPhase:'live'})));
setupContext.accounts.push({ accountId:'77000000-0000-4000-8000-000000000099',accountName:'Other payer',machines:[{machineId:'other-machine',machineLabel:'Other payer machine',locationName:'Elsewhere',operationalPhase:'live'}] });
const preserved = JSON.stringify({assignments:payContext.technicians[0].assignments,contact:state.contact,entries:state.timeEntries});
const browser = await chromium.launch({ headless:true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
const context = await browser.newContext({viewport:{width:1365,height:1000}});
await installRoutes(context);
await context.route('**/rest/v1/rpc/**',async route=>{
  const name = new URL(route.request().url()).pathname.split('/').pop();
  const body = route.request().postDataJSON();
  if(name==='get_operator_machine_arrangement_result') return route.fulfill(json(receiptByRequest.get(body.p_request_id)??null));
  if(name!=='admin_add_operator_machine_arrangement') return route.fallback();
  writes.push(structuredClone(body));
  if(mode==='validation') return route.fulfill(json({code:'P0001',message:'Compensation rate overlaps an existing effective rate'},400));
  if(mode==='lost-before-commit') return route.abort('failed');
  let receipt=receiptByRequest.get(body.p_request_id);
  if(!receipt){
    receipt={requestId:body.p_request_id,operatorProfileId:body.p_operator_profile_id,accountId:ACCOUNT_ID,machineId:body.p_reporting_machine_id,
      assignment:{id:`saved-${body.p_reporting_machine_id}`},shiftRate:{id:'shift'},commissionRate:{id:'commission'},waitingRate:{id:'waiting'}};
    receiptByRequest.set(body.p_request_id,receipt);
    payContext.technicians[0].assignments.push({assignmentId:receipt.assignment.id,machineId:body.p_reporting_machine_id,machineLabel:'Added synthetic machine',locationId:LOCATION_ID,locationName:'Synthetic venue',effectiveStartDate:body.p_effective_start_date,effectiveEndDate:body.p_effective_end_date,status:'active',editable:true,overlapsSelectedPeriod:true,selectedPeriodGrossSalesCents:0});
  }
  if(mode==='lost-after-commit') return route.abort('failed');
  await new Promise(resolve=>setTimeout(resolve,200));
  return route.fulfill(json(receipt));
});
const page=await context.newPage();
await page.clock.setFixedTime(FIXED_NOW);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const check=(label,condition)=>{assert.ok(condition,label);console.log(`PASS ${label}`);};
const dialog=()=>page.getByRole('dialog');
const open=async()=>{await page.getByRole('button',{name:'Add machine',exact:true}).click();await dialog().waitFor();};
const fill=async(index)=>{
  await page.locator('#add-payroll-machine').click();
  await page.getByRole('option',{name:`Additional machine ${index+1}`,exact:true}).click();
  await page.locator('#add-machine-start').fill('2026-01-01');
  await page.locator('#add-machine-rate').fill('27');
  await page.locator('#add-machine-commission').fill('4.5');
  await page.locator('#add-machine-commission-start').fill('2026-04-01');
};
await mkdir('output/playwright/add-technician-machine',{recursive:true});
try{
  await openAuthenticated(page,'/admin/payouts','Technician Pay Report');
  await open();
  check('new machine is not silently selected',await page.locator('#add-payroll-machine').innerText()==='Choose a machine');
  await page.locator('#add-payroll-machine').click();
  check('existing and other-payer machines are excluded',await page.getByRole('option',{name:'Cotton Candy 01',exact:true}).count()===0&&await page.getByRole('option',{name:'Other payer machine',exact:true}).count()===0);
  await page.keyboard.press('Escape');await fill(0);
  await page.screenshot({path:'output/playwright/add-technician-machine/desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  check('cancel sends no writes',writes.length===0);
  check('cancel restores focus',await page.getByRole('button',{name:'Add machine',exact:true}).evaluate(element=>element===document.activeElement));
  await open();await fill(0);mode='lost-after-commit';
  await page.getByRole('button',{name:'Add machine and pay',exact:true}).click();
  await page.getByText(/We could not confirm this save/).waitFor();
  check('unknown save keeps its exact submitted fields locked',await page.locator('#add-machine-rate').isDisabled());
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.reload();await page.getByRole('heading',{name:'Technician Pay Report'}).waitFor();await open();
  check('interrupted save survives reload',await page.locator('#add-machine-rate').inputValue()==='27.00'&&await page.getByRole('button',{name:'Check save status'}).isVisible());
  await page.getByRole('button',{name:'Check save status'}).click();await dialog().waitFor({state:'hidden'});
  check('read-back confirms committed result without another write',writes.length===1);
  await open();await fill(1);mode='validation';
  await page.getByRole('button',{name:'Add machine and pay',exact:true}).click();
  await page.getByText(/No changes were saved/).waitFor();
  check('atomic rejection retains editable draft',await page.locator('#add-machine-rate').inputValue()==='27'&&!await page.locator('#add-machine-rate').isDisabled());
  mode='success';await page.getByRole('button',{name:'Add machine and pay',exact:true}).dblclick();await dialog().waitFor({state:'hidden'});
  check('repeated clicks produce one atomic save',writes.length===3);
  await open();await fill(2);mode='lost-before-commit';
  await page.getByRole('button',{name:'Add machine and pay',exact:true}).click();await page.getByText(/We could not confirm this save/).waitFor();
  const uncertain=structuredClone(writes.at(-1));
  await page.getByRole('button',{name:'Check save status'}).click();await page.getByText(/No completed save is confirmed yet/).waitFor();
  mode='success';await page.getByRole('button',{name:'Retry same save'}).click();await dialog().waitFor({state:'hidden'});
  check('retry preserves exact request UUID and every submitted term',JSON.stringify(writes.at(-1))===JSON.stringify(uncertain));
  check('request explicitly targets the existing technician and new machine',writes[0].p_operator_profile_id===PROFILE_ID&&writes[0].p_reporting_machine_id===NEW_MACHINES[0]&&writes[0].p_shift_rate_cents===2700&&writes[0].p_commission_basis_points===450&&writes[0].p_commission_start_date==='2026-04-01');
  check('original assignments, contacts and time remain unchanged in mock state',JSON.stringify({assignments:payContext.technicians[0].assignments.filter(a=>!NEW_MACHINES.includes(a.machineId)),contact:state.contact,entries:state.timeEntries})===preserved);
  check('no setup, bulk replacement, direct rate, contact, or access write is called',!state.rpcCalls.some(call=>/^(admin_setup_|admin_set_operator_machine|admin_upsert_operator_compensation|admin_update_operator_contact|admin_grant_)/.test(call.rpcName)));
  await page.setViewportSize({width:390,height:844});await open();
  await page.getByText(/No additional machines are available/).waitFor();
  check('empty choices explain existing assignment editing',await page.getByText(/Existing assignments can be changed with Assignment dates/).isVisible());
  check('mobile dialog does not overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:'output/playwright/add-technician-machine/mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  check('no runtime errors',errors.length===0);
  console.log('Add-machine UAT passed with synthetic requests only.');
}finally{await browser.close();}
