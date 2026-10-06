import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { inspectSunzeMachineStructure } from './machine-structure-diagnostic.mjs';

test('structure diagnostic exposes controls and bounds, never credentials or arbitrary text',async()=>{
  const browser=await chromium.launch();
  try {
    const page=await browser.newPage();
    await page.setContent(`<input value="synthetic-secret-token"><button aria-label="operator@example.invalid">Private account</button><div class="el-pagination"><button aria-label="Next Page">Next</button><span>Total 29 items</span></div><div class="machine-card"><div>Private customer name</div><div>Running</div><div><span>Machine ID</span><span>123456789</span></div></div><div class="scroll-area" style="height:50px;overflow-y:scroll"><div style="height:400px">Private note</div></div>`);
    const result=await page.evaluate(inspectSunzeMachineStructure),text=JSON.stringify(result);
    for(const secret of ['synthetic-secret-token','operator@example.invalid','Private account','Private customer name','Private note']) assert(!text.includes(secret),secret);
    assert(result.controls.some(control=>control.label==='Next Page'));
    assert(result.scrollContainers.some(container=>container.scrollHeight===400&&container.clientHeight===50));
    assert.equal(result.visibleIdentityElementCount,1);
    assert(text.includes('Running'));
    assert(!text.includes('123456789'));
  }finally{await browser.close();}
});
