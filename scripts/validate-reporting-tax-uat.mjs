import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createPageForPersona, personas, rpcResponse } from './validate-reporting-uat.mjs';
const app = process.argv.includes('--app-url') ? process.argv[process.argv.indexOf('--app-url') + 1] : 'http://127.0.0.1:8084';
const out = path.resolve('output/playwright/reporting-tax');
fs.mkdirSync(out, { recursive: true });
const machine = 'machine-legacy-dates-uat';
const browser = await chromium.launch({headless:true});
const checks = [];
const scoped = {...personas.operator,isScopedAdmin:true,id:'00000000-0000-4000-9000-000000001708'};
const savedTreatments = new Map();
const initialCash = {id:'cash-treatment',machine_id:machine,tender:'cash',amount_basis:'tax_exclusive',taxable_portion_percent:25,effective_start_date:'2026-01-01',effective_end_date:null,created_at:'2026-01-01T00:00:00Z',created_by:null};
const response = (name,actor,body,freshness) => {
  if(name==='get_my_admin_access_context' && actor.isScopedAdmin) return {isSuperAdmin:false,isScopedAdmin:true,canAccessAdmin:true,allowedSurfaces:['machines'],scopedMachineIds:[machine]};
  if(name==='admin_get_reporting_machine_tax_treatments') return [initialCash,...(savedTreatments.get(actor.id) ?? [])];
  if(name==='admin_set_reporting_machine_tax_configuration') {
    const treatments = ['card','cash'].map(tender => ({id:`saved-${tender}`,machine_id:body.p_machine_id,tender,
      amount_basis:body[`p_${tender}_amount_basis`],taxable_portion_percent:body[`p_${tender}_taxable_portion_percent`],
      effective_start_date:body.p_effective_start_date,effective_end_date:null,created_at:'2026-07-22T12:00:00Z',created_by:actor.id}));
    savedTreatments.set(actor.id,treatments);
    return {taxRate:{machine_id:body.p_machine_id,tax_rate_percent:body.p_tax_rate_percent},treatments};
  }
  if(name==='admin_get_partnership_reporting_setup') { const setup=rpcResponse(name,actor,body,freshness); setup.machines.forEach(row=>row.operational_phase='live');setup.taxRates=[{id:'rate-1',machine_id:machine,machine_label:'Legacy Date Kiosk',tax_rate_percent:10,effective_start_date:'2026-01-01',effective_end_date:null,status:'active',notes:null}]; return setup; }
  return rpcResponse(name,actor,body,freshness);
};
try {
  for (const [actor,width] of [[personas.superAdmin,1440],[scoped,390]]) {
    const {page,context,state}=await createPageForPersona(browser,actor,{width,height:900},{rpcHandler:response});
    const pageErrors = []; page.on('pageerror',error=>pageErrors.push(error.message));
    try {
      await page.goto(`${app}/admin/machines/${machine}?tab=reporting`,{waitUntil:'networkidle'});
      await page.getByRole('button',{name:'Change tax rate',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'Change reporting tax rate'});
      await dialog.waitFor();
      assert(!await dialog.getByLabel('Card source amounts',{exact:true}).isVisible());
      await dialog.locator('summary').first().focus();await page.keyboard.press('Enter');
      assert.equal(await dialog.getByLabel('Cash source amounts',{exact:true}).inputValue(),'tax_exclusive');
      await dialog.getByLabel('Card source amounts',{exact:true}).selectOption('tax_exclusive');
      await dialog.getByText('Taxable portion',{exact:true}).click();
      assert.equal(await dialog.getByLabel('Cash taxable %',{exact:true}).inputValue(),'25');
      await dialog.getByLabel('Card taxable %',{exact:true}).fill('33');
      await dialog.getByText('3.3% effective reporting rate',{exact:true}).waitFor();
      await dialog.getByLabel('Reason',{exact:true}).fill('Documented source treatment');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await page.screenshot({path:path.join(out,`tax-${actor.isScopedAdmin?'scoped-mobile':'desktop'}.png`),fullPage:true});
      await dialog.getByLabel('Card taxable %',{exact:true}).fill('-1');
      await dialog.getByRole('button',{name:'Save rate change',exact:true}).click();
      assert(!state.rpcCalls.some(call=>call.rpcName==='admin_set_reporting_machine_tax_configuration'));
      await dialog.getByLabel('Card taxable %',{exact:true}).fill('33');
      await dialog.getByRole('button',{name:'Save rate change',exact:true}).click();
      await dialog.waitFor({state:'hidden'});
      const saved=state.rpcCalls.find(call=>call.rpcName==='admin_set_reporting_machine_tax_configuration');
      assert(saved);assert.equal(saved.body.p_card_taxable_portion_percent,33);assert.equal(saved.body.p_card_amount_basis,'tax_exclusive');
      assert.equal(saved.body.p_cash_taxable_portion_percent,25);assert.equal(saved.body.p_cash_amount_basis,'tax_exclusive');
      await page.getByRole('button',{name:'Change tax rate',exact:true}).click();
      await dialog.locator('summary').first().click();
      assert.equal(await dialog.getByLabel('Card source amounts',{exact:true}).inputValue(),'tax_exclusive');
      await dialog.getByText('Taxable portion',{exact:true}).click();
      assert.equal(await dialog.getByLabel('Card taxable %',{exact:true}).inputValue(),'33');
      if(actor.isScopedAdmin){await page.setViewportSize({width:320,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
      assert.deepEqual(pageErrors,[]);
      checks.push(`${actor.isScopedAdmin?'Scoped admin mobile':'Super admin desktop'}: collapsed defaults, keyboard disclosure, valid share, unchanged cash treatment, atomic save and reload`);
    } finally {await context.close();}
  }
  const {page,context,state}=await createPageForPersona(browser,personas.superAdmin,{width:390,height:844},{rpcHandler:response});
  try{
    await context.route('**/rest/v1/rpc/admin_get_reporting_machine_tax_treatments',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic unavailable'})}));
    await page.goto(`${app}/admin/machines/${machine}?tab=reporting`,{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'Change tax rate',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Change reporting tax rate'});await dialog.locator('summary').first().click();
    await dialog.getByText('Saved treatment could not be loaded. You can still save the rate above.',{exact:true}).waitFor();
    await dialog.getByLabel('Reason',{exact:true}).fill('Rate-only change after source outage');
    await dialog.getByRole('button',{name:'Save rate change',exact:true}).click();await dialog.waitFor({state:'hidden'});
    assert(state.rpcCalls.some(call=>call.rpcName==='admin_set_reporting_machine_tax_rate'));
    assert(!state.rpcCalls.some(call=>call.rpcName==='admin_set_reporting_machine_tax_configuration'));
    checks.push('Treatment load failure preserves usable rate-only save without resetting unknown rules');
  }finally{await context.close();}
  fs.writeFileSync(path.join(out,'tax-results.json'),JSON.stringify({checks},null,2));
  console.log(JSON.stringify({passed:checks.length,checks},null,2));
}finally{await browser.close();}
