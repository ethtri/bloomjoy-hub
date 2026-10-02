import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

// Existing real React page, synthetic transport only. No production credentials.
const base=process.env.REFUND_FORM_UAT_URL ?? 'http://127.0.0.1:8093';
const browser=await chromium.launch({headless:true});
await mkdir('output/refund-uat-evidence',{recursive:true});
const original='a'.repeat(43), child='b'.repeat(43);
let scenarios=0;
try {
  for (const width of [1280,390]) {
    for (const mode of ['submitted','expired','revoked','superseded-during-renewal']) {
      const context=await browser.newContext({viewport:{width,height:900}});
      const page=await context.newPage(); const requests=[];const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      let renewed=false, saved=false, failedOnce=false;
      let releaseRenew;
      const renewalBarrier=new Promise(resolve=>{releaseRenew=resolve;});
      const receipt={state:'received',publicReference:'RF-SYNTHETIC',locale:'en',nextAction:'review',canRenew:true};
      const ready={state:'ready',publicReference:'RF-SYNTHETIC',locale:'en',version:4,
        requestedFields:mode==='submitted'?['incident_time','incident_time_source']:[],
        allowedFields:['incident_date','incident_time','incident_time_source','amount','card_last4','card_last4_source'],
        values:{incident_date:'2026-09-21',incident_time:'13:00',incident_time_source:'memory',amount:'7.00',card_last4:'1234',card_last4_source:'physical_card'},
        incidentTimeConfidence:'rough',timezone:'America/New_York'};
      await page.route('**/*',async route=>{
        if(new URL(route.request().url()).origin===new URL(base).origin) return route.continue();
        if(!route.request().url().includes('/functions/v1/refund-case-intake')) return route.fulfill({status:200,json:[]});
        const body=route.request().postDataJSON();requests.push(body);
        let json;
        if(body.action==='inspectPurchaseCorrection') {
          json={correction:body.token==='c'.repeat(43)?{state:'unavailable'}:saved?{...receipt,canRenew:false}:renewed?ready:mode==='submitted'?receipt:{state:'unavailable',canRenew:mode!=='revoked'}};
        } else if(body.action==='renewPurchaseCorrection') {
          assert.equal(body.token,original);assert.deepEqual(Object.keys(body).sort(),['action','token']);
          if(mode==='superseded-during-renewal') await renewalBarrier;
          if(mode==='expired'&&!failedOnce) {failedOnce=true;return route.fulfill({status:503,json:{errorCode:'correction_temporarily_unavailable'}});}
          renewed=true;json={token:child,correction:ready};
        } else if(body.action==='submitPurchaseCorrection') {
          assert.equal(body.token,child);assert.equal(body.version,4);
          assert.equal(body.answers.incident_date,undefined);
          assert.equal(body.answers.card_last4,undefined);
          if(mode==='submitted') {
            assert.equal(body.answers.incident_time.value,'13:05');
            assert.equal(body.answers.incident_time.confidence,'rough');
            assert.deepEqual(body.answers.incident_time_source,{disposition:'confirmed'});
          } else assert.equal(body.answers.amount.value,'8.00');
          saved=true;json={correction:{...receipt,canRenew:false}};
        } else throw new Error(`Unexpected action ${body.action}`);
        return route.fulfill({status:200,json});
      });
      await page.goto(`${base}/refunds/correct#token=${original}`);
      if(mode==='superseded-during-renewal') {
        await page.getByRole('button',{name:'Update your request',exact:true}).click();
        const openingUpdate=page.getByRole('button',{name:'Opening update…',exact:true});
        await openingUpdate.waitFor();assert.equal(await openingUpdate.isDisabled(),true);
        await page.evaluate(()=>{window.location.hash=`token=${'c'.repeat(43)}`;});
        await page.waitForFunction(()=>sessionStorage.getItem('bloomjoy-refund-correction-v1')==='c'.repeat(43));
        const completed=page.waitForResponse(response=>response.url().includes('/functions/v1/refund-case-intake')&&response.request().postDataJSON()?.action==='renewPurchaseCorrection');
        releaseRenew();await completed;await page.waitForTimeout(100);
        assert.equal(await page.locator('form').count(),0);
        assert.equal(await page.getByRole('button',{name:'Update your request',exact:true}).count(),0);
        assert.equal(await page.evaluate(()=>sessionStorage.getItem('bloomjoy-refund-correction-v1')),'c'.repeat(43));
      } else if(mode==='revoked') {
        await page.getByRole('heading',{name:'This link is no longer available.'}).waitFor();
        assert.equal(await page.getByRole('button',{name:'Update your request',exact:true}).count(),0);
        assert(page.url().includes('/refunds/correct'));assert.equal(requests.length,1);
      } else {
        const update=page.getByRole('button',{name:'Update your request',exact:true});
        await update.click();
        if(mode==='expired') {
          await page.getByRole('alert').waitFor();
          assert.equal(await page.locator('form').count(),0);
          await update.click();
        }
        await page.getByRole('heading',{name:'Update your refund request',exact:true}).waitFor();
        assert(!page.url().includes(original)&&!page.url().includes(child));
        if(mode==='submitted') {
          assert.equal(await page.locator('fieldset').count(),2);
          await page.locator('#correction-incident_time-answer').selectOption('changed');
          assert.equal(await page.locator('#correction-incident_time').inputValue(),'13:00');
          await page.locator('#correction-incident_time').fill('13:05');
          assert.equal(await page.locator('#correction-incident_time-confidence').inputValue(),'rough');
          await page.locator('#correction-incident_time_source-answer').selectOption('confirmed');
        } else {
          assert((await page.locator('body').innerText()).includes('1234'));
          await page.locator('#correction-amount-answer').selectOption('changed');
          assert.equal(await page.locator('#correction-amount').inputValue(),'7.00');
          await page.locator('#correction-amount').fill('8.00');
        }
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
        assert.equal(overflow,false);
        await page.screenshot({path:`output/refund-uat-evidence/same-case-update-${mode}-${width}.png`,fullPage:true});
        await page.getByRole('button',{name:/Save/}).click();
        await page.getByRole('heading',{name:'Your response is saved.',exact:true}).waitFor();
        assert.equal(requests.filter(r=>r.action==='submitPurchaseCorrection').length,1);
        assert(page.url().includes('/refunds/correct'));
      }
      assert.deepEqual(errors,[]);await context.close();scenarios++;
    }
  }
  console.log(JSON.stringify({scenarios,desktopMobile:true,syntheticTransportOnly:true,passed:true}));
} finally {await browser.close();}
