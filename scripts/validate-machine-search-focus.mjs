import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installMockSupabaseRoutes, mockUser, machineId, firstManagerEmail } from './refunds/validate-machine-manager-uat.mjs';
await mkdir('output/playwright/machine-search',{recursive:true});
const appUrl = process.env.MACHINE_SEARCH_UAT_APP_URL || 'http://127.0.0.1:8087';
const state = {
 machineType:'commercial',managerEmails:[firstManagerEmail],rpcCalls:[],accessInviteBodies:[],inviteDeliveries:[],nayaxInventory:null,
 globalRefundsAvailable:true,globalRefundsPaused:false,globalRefundsBlockReason:null,
 refundSetup:{refundIntakeEnabled:false,refundPublicDisplayLabel:null,nayaxMachineId:null,nayaxAccountKey:null,customerIntakeAccepting:true,cardRefundsEnabled:false,cardRefundLimitCents:null,paymentDisabledReason:'awaiting_reviewed_activation',readinessState:'setup_needed',readinessBlockReason:'transaction_matching_off'}
};
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await installMockSupabaseRoutes(context,state);
await context.route('**/rest/v1/rpc/admin_get_machine_workspace_metadata',route=>route.fulfill({contentType:'application/json',body:JSON.stringify([{machineId,venueLabel:null,nayaxMachineId:null,nayaxAccountKey:null,nayaxName:null,lastRecordedTransaction:null,lastSuccessfulSalesImport:null,sources:[]}])}));
const page=await context.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const results=[];
async function typeWithoutRefocus(locator,query,label){
 await locator.click();
 const original=await locator.elementHandle();
 for(const character of query){
  await page.keyboard.type(character);
  await page.waitForTimeout(60);
  assert.equal(await locator.evaluate(el=>document.activeElement===el),true,`${label} keeps focus after ${character}`);
  assert.equal(await original.evaluate(el=>el.isConnected),true,`${label} retains the original DOM input`);
 }
 assert.equal(await locator.inputValue(),query);
 await page.keyboard.press('Backspace');await page.waitForTimeout(60);
 assert.equal(await locator.inputValue(),query.slice(0,-1));
 assert.equal(await locator.evaluate(el=>document.activeElement===el),true,`${label} keeps focus after backspace`);
 results.push(`${label}: continuous typing, backspace and original DOM input preserved`);
 await original.dispose();
}
try{
 await page.goto(`${appUrl}/admin/machines`,{waitUntil:'domcontentloaded'});
 await page.locator('#email-password').fill(mockUser.email);await page.locator('#password').fill('synthetic-password');
 await page.getByRole('button',{name:/sign in/i}).click();await page.getByRole('table',{name:'Machines'}).waitFor();
 const search=page.locator('#machine-search');await typeWithoutRefocus(search,'Cotton Candy','Machines search');
 assert.equal(new URL(page.url()).searchParams.get('q'),'Cotton Cand');
 await page.screenshot({path:'output/playwright/machine-search/continuous-search.png',fullPage:true});
 assert.match(await page.getByRole('table',{name:'Machines'}).innerText(),/Cotton Candy 01/);
 assert.doesNotMatch(await page.getByRole('table',{name:'Machines'}).innerText(),/Valley Mall/);
 await page.reload();await search.waitFor();assert.equal(await search.inputValue(),'Cotton Cand');
 await search.click();await page.keyboard.press('Control+A');await page.keyboard.press('Backspace');await page.waitForTimeout(100);
 assert.equal(new URL(page.url()).searchParams.has('q'),false);
 assert.match(await page.getByRole('table',{name:'Machines'}).innerText(),/Valley Mall/);
 await page.getByRole('row').filter({hasText:'Cotton Candy 01'}).getByRole('button',{name:/manage/i}).click();
 const nayax=page.locator(`#nayax-search-${machineId}`);await nayax.waitFor();
 await typeWithoutRefocus(nayax,'UAT-NAYAX-002','Imported Nayax search');
 await page.keyboard.press('2');await page.waitForTimeout(100);
 assert.equal(await nayax.inputValue(),'UAT-NAYAX-002');
 assert.match(await page.locator(`#nayax-match-${machineId}`).innerText(),/UAT-NAYAX-002/);
 assert.equal(state.rpcCalls.some(call=>call.name==='admin_save_machine_workspace_mapping'),false);

 // Exercise a second URL-backed screen and intentional render failures with the
 // actual shared boundary, served only by this intercepted local test harness.
 await page.goto(`${appUrl}/admin/machines/inventory`);
 const inventorySearch=page.getByRole('textbox',{name:'Search Nayax inventory'});await inventorySearch.waitFor();
 await typeWithoutRefocus(inventorySearch,'UAT-NAYAX','Nayax inventory search');
 assert.deepEqual(errors,[]);
 await writeFile('output/playwright/machine-search/boundary-harness.jsx',`
   import React from 'react';
   import ReactDOM from 'react-dom/client';
   import {BrowserRouter,useNavigate,useLocation} from 'react-router-dom';
   import {RouteErrorBoundary} from '/src/components/routing/RouteErrorBoundary.tsx';
   function Content(){const location=useLocation();const navigate=useNavigate();const [value,setValue]=React.useState('');
    if(new URLSearchParams(location.search).get('fail')==='1')throw new Error('Intentional boundary regression fixture');
    return React.createElement('input',{id:'boundary-query',value,onChange:event=>{setValue(event.target.value);navigate('?q='+encodeURIComponent(event.target.value),{replace:true});}});}
   function Harness(){const navigate=useNavigate();React.useEffect(()=>{window.boundaryNavigate=navigate;},[navigate]);return React.createElement(RouteErrorBoundary,null,React.createElement(Content));}
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement(Harness)));
  `);
 await context.route('**/__boundary-regression*',route=>route.fulfill({contentType:'text/html',body:`<div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('/output/playwright/machine-search/boundary-harness.jsx');</script>`}));
 await page.goto(`${appUrl}/__boundary-regression`);
 const boundaryInput=page.locator('#boundary-query');await boundaryInput.waitFor();
 await typeWithoutRefocus(boundaryInput,'Great Mall','Shared boundary query screen');
 await page.evaluate(()=>window.boundaryNavigate('?fail=1'));
 await page.getByText('Page failed to load',{exact:true}).waitFor();
 await page.evaluate(()=>window.boundaryNavigate('?q=recovered'));
 await boundaryInput.waitFor();
 assert.equal(await page.getByText('Page failed to load',{exact:true}).count(),0);
 results.push('Render error recovers when query changes');
 await page.evaluate(()=>window.boundaryNavigate('?fail=1'));
 await page.getByText('Page failed to load',{exact:true}).waitFor();
 await page.evaluate(()=>window.boundaryNavigate('/__boundary-regression-other'));
 await boundaryInput.waitFor();
 results.push('Render error recovers when pathname changes');

 await mkdir('output/playwright/machine-search',{recursive:true});
 await page.screenshot({path:'output/playwright/machine-search/boundary-recovery.png',fullPage:true});
 await writeFile('output/playwright/machine-search/results.json',JSON.stringify({results,errors},null,2));
 console.log(results.join('\n'));
}catch(error){console.error({browserErrors:errors});throw error;}finally{await browser.close();}
