// Focused presentation acceptance; server report projection/financial parity is covered in SQL fixtures.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createPageForPersona} from './validate-reporting-uat.mjs';
import {workspacePersonas} from './reporting-workspace-fixtures.mjs';
import {financeRpcResponse} from './finance-reporting-fixtures.mjs';
const root=process.env.MACHINE_SIMPLE_UAT_APP_URL||'http://127.0.0.1:8087', dir='output/playwright/machine-location-reports'; await mkdir(dir,{recursive:true});
const effective='Great Mall - Cotton Candy';
function project(value){if(Array.isArray(value))return value.map(project); if(!value||typeof value!=='object')return value; const result=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,project(v)])); if(result.machine_id==='operator-machine-north'||result.machineId==='operator-machine-north'){if('machine_label'in result)result.machine_label=effective;if('machineLabel'in result)result.machineLabel=effective;} return result;}
const results=[]; const browser=await chromium.launch();
try{for(const width of [1440,390]){const {page,context,state}=await createPageForPersona(browser,workspacePersonas.superAdmin,{width,height:900},{rpcHandler:(...args)=>project(financeRpcResponse(...args))});
await page.goto(`${root}/portal/reports?view=overview&from=2026-07-15&to=2026-07-21&machine=operator-machine-north`);await page.getByRole('button',{name:`Remove machine filter: ${effective}`,exact:true}).waitFor();
await page.getByText('Machine and payment breakdown',{exact:true}).click(); await page.getByText(effective,{exact:true}).filter({visible:true}).first().waitFor();
await page.screenshot({path:`${dir}/report-${width}.png`,fullPage:true});
console.log(JSON.stringify({width,nameVisible:await page.getByText(effective,{exact:true}).count(),oldAliasVisible:await page.getByText('North Atrium',{exact:true}).count(),calls:state.rpcCalls.filter(c=>['get_sales_report','get_sales_report_complete'].includes(c.rpcName))}));
assert(await page.getByText(effective,{exact:true}).filter({visible:true}).count()>0); assert(state.rpcCalls.filter(c=>['get_sales_report','get_sales_report_complete'].includes(c.rpcName)).every(c=>c.body.p_machine_ids.join(',')==='operator-machine-north'&&c.body.p_location_ids===null));assert.equal(await page.getByText('North Atrium',{exact:true}).count(),0);results.push({width,effectiveNameVisible:true,legacyAliasAbsent:true,scopeIdsPreserved:true});await context.close();}}
finally{await browser.close();}

await writeFile(`${dir}/results.json`,JSON.stringify(results,null,2));
