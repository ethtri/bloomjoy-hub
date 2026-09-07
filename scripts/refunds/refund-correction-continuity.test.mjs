import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const text=fs.readFileSync(new URL('../../src/lib/refundCorrectionContinuity.ts',import.meta.url),'utf8');
const context=vm.createContext({exports:{}});vm.runInContext(ts.transpile(text,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}),context);
const collect=context.exports.collectCorrectionResponseNotices;
const response=(state='completed')=>({id:'case',status:'needs_review',customerCorrection:{state:'submitted',requestId:'request',respondedAt:'now',nextAction:'recheck',recheckState:state}});
test('no baseline popup; reorder and repeat polling never notify twice',()=>{
 const state={initialized:false,seen:new Set()};assert.equal(collect(state,[response()]).length,0);assert.equal(collect(state,[response()]).length,0);
});
test('pending recheck does not consume a later actionable response',()=>{
 const state={initialized:false,seen:new Set()};collect(state,[]);assert.equal(collect(state,[response('in_progress')]).length,0);
 assert.equal(state.seen.size,0);assert.equal(collect(state,[response()]).length,1);assert.equal(collect(state,[response()]).length,0);
});
test('terminal and unauthorized responses do not create alerts',()=>{
 const state={initialized:true,seen:new Set()};assert.equal(collect(state,[{...response(),status:'completed'},{...response(),canPerformOfficialAction:false}]).length,0);
});
