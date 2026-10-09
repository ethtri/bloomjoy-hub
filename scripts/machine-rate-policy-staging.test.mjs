import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageMachineRatePolicyForward } from './validate-supabase-migrations.mjs';

test('policy catalogue boundary preserves exact migration bytes and handles journal renames', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'machine-policy-stage-'));
  try {
    const dir=path.join(root,'supabase','migrations');fs.mkdirSync(dir,{recursive:true});
    const sources=new Map([
      ['20261008230000_prior.sql','prior\r\n'],
      ['20261009000001_machine_reporting_rate_policy.sql','do $actual$\r\nselect 1;\r\n$actual$;\r\n'],
      ['20261009000002_later.sql','later\r\n'],
    ]);
    for(const [name,content] of sources)fs.writeFileSync(path.join(dir,name),content);
    const restore=stageMachineRatePolicyForward(root);
    assert.deepEqual(fs.readdirSync(dir),['20261008230000_prior.sql']);
    restore();
    for(const [name,content] of sources)assert.equal(fs.readFileSync(path.join(dir,name),'utf8'),content);
    assert.equal(fs.readdirSync(dir).length,sources.size);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
