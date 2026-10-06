import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readSunzeMachineFields,normalizeSunzeMachineFields,extractSunzeMachineIdentitiesFromText } from './machine-identity.mjs';
import { usableSunzeMachineName,mergeSunzeMachineNames,preserveSunzeMachineName } from '../../supabase/functions/_shared/sunze-machine-name.mjs';
import { scrollSunzeMachineList,collectSunzeMachineInventory } from './machine-inventory-coverage.mjs';

test('status proximity never substitutes for an explicit name; placeholders remain unknown',()=>{
 assert.deepEqual(extractSunzeMachineIdentitiesFromText('Bubble Planet LA\nRunning\nMachine ID\n1785123901474964787735686'),[{machineCode:'1785123901474964787735686',machineName:null,machineNameEvidence:null}]);
 assert.equal(extractSunzeMachineIdentitiesFromText('Machine Name: Great Mall\nOff\nMachine ID: 123456789')[0].machineName,'Great Mall');
 assert.equal(usableSunzeMachineName('Off'),null);assert.equal(usableSunzeMachineName('Running'),null);
 assert.equal(usableSunzeMachineName('No set name',true),null);assert.equal(usableSunzeMachineName('  Bubble Planet LA  '),'Bubble Planet LA');
 assert.equal(usableSunzeMachineName('Running',true),'Running');
});

test('ingester precedence retains real names when visible status or placeholder is invalid',()=>{
 const names=mergeSunzeMachineNames(new Map([['123','Order name'],['456','Old order name']]),[
  {machineCode:'123',machineName:'Running'},
  {machineCode:'456',machineName:'Current cabinet',machineNameEvidence:'explicit_field'},
  {machineCode:'789',machineName:'No set name',machineNameEvidence:'explicit_field'},
 ]);
 assert.equal(names.get('123'),'Order name');assert.equal(names.get('456'),'Current cabinet');assert.equal(names.has('789'),false);
 assert.equal(preserveSunzeMachineName(names.get('789'),'Valid prior name'),'Valid prior name');
 assert.equal(preserveSunzeMachineName(undefined,'Off'),null);
 assert.equal(preserveSunzeMachineName('Running','Prior'),'Running');
});
test('actual Vant name/status/ID fields are distinct and inner list scrolling exhausts lazy cards',async()=>{
 const browser=await chromium.launch();
 try {
  const page=await browser.newPage();
  await page.setContent('<!doctype html><div class="device-list-container" style="height:200px;overflow:auto"></div>');
  await page.evaluate(()=>{
   const list=document.querySelector('.device-list-container');let count=0;
   const append=()=>{for(let n=0;n<10;n++){count++;const card=document.createElement('div');card.style.height='100px';card.innerHTML=`<div class="head-title"><h4 class="device-name">${count===1?'Bubble Planet LA':count===2?'No set name':`Cabinet ${count}`}</h4><span class="head-status">${count%2?'Running':'Off'}</span></div><div class="device-id"><span class="id-label">Machine ID:</span><span class="id-code">${100000000+count}</span></div>`;list.append(card);}};
   append();list.addEventListener('scroll',()=>{if(count<30&&list.scrollTop+list.clientHeight>=list.scrollHeight-100)append();});
  });
  const initial=normalizeSunzeMachineFields(await page.evaluate(readSunzeMachineFields));assert.equal(initial.length,10);assert.equal(initial[0].machineName,'Bubble Planet LA');assert.equal(initial[1].machineName,null);
  const inventory=await collectSunzeMachineInventory({readMachines:async()=>normalizeSunzeMachineFields(await page.evaluate(readSunzeMachineFields)),readPagination:async()=>({nextState:'absent',total:30}),scroll:()=>page.evaluate(scrollSunzeMachineList),advancePage:async()=>false,settle:()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))});
  assert.equal(inventory.machines.length,30);assert.equal(inventory.coverage.verified,true);assert(inventory.coverage.scrollAttempts>0);
  assert.deepEqual(inventory.machines.map(row=>row.machineCode),Array.from({length:30},(_,index)=>String(100000001+index)));
  const unverified=await collectSunzeMachineInventory({readMachines:async()=>normalizeSunzeMachineFields(await page.evaluate(readSunzeMachineFields)),readPagination:async()=>({nextState:'absent',total:null}),scroll:()=>page.evaluate(scrollSunzeMachineList),advancePage:async()=>false,settle:()=>page.waitForTimeout(20)});
  assert.equal(unverified.machines.length,30);assert.equal(unverified.coverage.verified,false);
 }finally{await browser.close();}
});
