import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const flag = process.argv.indexOf('--app-url');
const origin = flag < 0 ? 'http://127.0.0.1:8106' : process.argv[flag + 1];
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Company UAT requires the loopback sample preview.');
const a='17190000-0000-4000-8000-000000000001';
const b='17190000-0000-4000-8000-000000000002';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
fs.mkdirSync('output', { recursive: true });
const errors=[];const requests=[];page.on('request',request=>{if(request.url().includes('/rpc/')) requests.push({name:request.url().split('/').pop(),body:request.postDataJSON()});});page.on('pageerror',e=>errors.push(e.message));
const fit=async()=>{ const dims=await page.evaluate(()=>({w:innerWidth,s:document.documentElement.scrollWidth}));assert(dims.s<=dims.w+1,JSON.stringify(dims));};
try {
 for(const view of ['finance','overview','locations','sales']) {
  await page.goto(`${origin}/portal/reports?view=${view}&from=2026-07-15&to=2026-07-21`,{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'By company',exact:true}).waitFor();await fit();
  await page.getByRole('button',{name:'Sample North Company',exact:true}).click();
  await page.waitForURL(`**company=${a}**`);await page.waitForLoadState('networkidle');await fit();assert(requests.some(request=>request.name===`get_company_${view==='finance'?'finance_reporting':'sales_report'}`&&request.body.p_company_id===a&&request.body.p_machine_ids?.length===1));
  assert.equal(await page.getByRole('heading',{name:'By company',exact:true}).count(),0);
  await page.screenshot({path:`output/company-${view}-390.png`,fullPage:true});
 }
 await page.goto(`${origin}/portal/reports?view=sales&from=2026-07-15&to=2026-07-21&tender=credit&compare=previous_year`, {waitUntil:'networkidle'});
 for (const name of ['Sample North Company', 'Sample South Company with a long reporting name']) {
  await page.locator('#detailed-sales-company').click(); await page.getByRole('option',{name,exact:true}).click(); await page.waitForLoadState('networkidle');
 }
 await page.goBack({waitUntil:'networkidle'}); assert.equal(new URL(page.url()).searchParams.get('company'),a);
 await page.waitForTimeout(1500); assert.equal(await page.locator('#detailed-sales-company').innerText(),'Sample North Company');
 assert.equal(new URL(page.url()).searchParams.get('tender'),'credit'); assert.equal(new URL(page.url()).searchParams.get('compare'),'previous_year');
 await page.goForward({waitUntil:'networkidle'}); await page.waitForTimeout(1500);
 assert.equal(new URL(page.url()).searchParams.get('company'),b); assert.equal(await page.locator('#detailed-sales-company').innerText(),'Sample South Company with a long reporting name');
 // A defensive layout check: category totals may exceed the cohort denominator.
 await page.route('**/rpc/get_company_refund_analytics', async route => {
  const response = await route.fetch(); const report = await response.json();
  report.cohort.requestCount = 1; report.categories[0].requestCount = 100;
  await route.fulfill({response,json:report});
 });
 await page.goto(`${origin}/refunds?view=reports&from=2026-07-15&to=2026-07-21`,{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:'By company',exact:true}).waitFor();await fit();
 await page.getByRole('button',{name:'Sample North Company',exact:true}).click();await page.waitForURL(`**company=${a}**`);await page.waitForLoadState('networkidle');await fit();
 await page.screenshot({path:'output/company-refund-reports-390.png',fullPage:true});
 await page.unroute('**/rpc/get_company_refund_analytics');
 await page.getByRole('link',{name:'Refund queue',exact:true}).click();await page.waitForLoadState('networkidle');
 await page.locator('[data-testid="refund-case-queue-item"]').filter({visible:true}).first().waitFor();assert.equal(await page.locator('[data-testid="refund-case-queue-item"]').filter({visible:true}).count(),1);await fit();
 await page.goto(`${origin}/refunds?demo=on&company=${a}&case=demo-cash-waiting`,{waitUntil:'networkidle'});
 await page.waitForURL(`**company=${b}**`);await fit();
 await page.screenshot({path:'output/company-refund-case-390.png',fullPage:true});
 await page.locator('#refund-queue-company').click();await page.getByRole('option',{name:'Sample North Company',exact:true}).click();await page.waitForURL(`**company=${a}**`);assert(!new URL(page.url()).searchParams.has('case'));await fit();
 await page.goto(`${origin}/refunds?demo=on&company=unavailable`,{waitUntil:'networkidle'});await page.getByRole('button',{name:'Choose all companies',exact:true}).waitFor();assert.equal(await page.locator('[data-testid="refund-case-queue-item"]').filter({visible:true}).count(),0);
 const countBeforeInvalid=requests.length;
 await page.goto(`${origin}/portal/reports?view=overview&company=${a}&machine=operator-machine-annex&from=2026-07-15&to=2026-07-21`,{waitUntil:'networkidle'});await page.getByRole('button',{name:'Choose all companies',exact:true}).waitFor();
 assert(!requests.slice(countBeforeInvalid).some(request=>['get_sales_report','get_company_sales_report'].includes(request.name)), 'Empty company intersection must not query all sales');
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});await page.goto(`${origin}/portal/reports?view=finance&from=2026-07-15&to=2026-07-21`,{waitUntil:'networkidle'});await page.getByRole('heading',{name:'By company',exact:true}).waitFor();await fit();}
 await page.screenshot({path:'output/company-finance-desktop.png',fullPage:true});
 await page.setViewportSize({width:640,height:844}); await page.evaluate(()=>document.body.style.zoom='2'); await fit(); await page.screenshot({path:'output/company-finance-200-percent.png',fullPage:true});
 await page.route('**/rpc/get_refund_portal_queue_projection', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({schemaVersion:'refund_portal_queue_v1',observedAt:'2026-07-22T15:00:00Z',refundOperationsAccess:false,payloadRedacted:true,items:[],counts:{allOpen:0,decisions:0,waitingOnCustomer:0,completed:0,internalTest:0}}) }));
 await page.goto(`${origin}/refunds?company=${a}`, {waitUntil:'networkidle'}); await page.locator('#refund-queue-company').waitFor(); assert.equal(await page.getByText('This company is unavailable in your current refund queue.',{exact:true}).count(),0,'Authorized company with no cases is empty, not inaccessible');
 assert.equal(await page.locator('[data-testid="refund-case-queue-item"]').filter({visible:true}).count(),0);
 assert.deepEqual(errors,[]);console.log('Company browser checks passed: all report hosts, queue scope, exact links, deliberate scope changes, invalid scope, 320/390/768/1440 fit.');
} catch(e){fs.writeFileSync('output/company-browser-failure.txt',await page.locator('body').innerText());throw e;}finally{await browser.close();}
