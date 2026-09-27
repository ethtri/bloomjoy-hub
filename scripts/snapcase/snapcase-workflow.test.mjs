import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(new URL('../../.github/workflows/snapcase-sync.yml', import.meta.url), 'utf8');
const health = await readFile(new URL('./check-sync-health.mjs', import.meta.url), 'utf8');

test('manual history dispatch requires paired dates and uses the bounded backfill runner', () => {
  assert.match(workflow, /- history-backfill/);
  assert.match(workflow, /date_start:\s*[\s\S]*date_end:/);
  assert.match(workflow, /history-backfill requires date_start and date_end/);
  assert.match(
    workflow,
    /node scripts\/snapcase\/backfill-snapcase\.mjs[\s\S]*--live-provider[\s\S]*--ingest[\s\S]*--date-start "\$DATE_START"[\s\S]*--date-end "\$DATE_END"/,
  );
  assert.match(workflow, /--checkpoint "\$RUNNER_TEMP\/snapcase-backfill-checkpoint\.local"/);
  assert.doesNotMatch(workflow, /--date-(?:start|end)\s+['"]?\$\{\{/);
});

test('history remains disabled by the existing flag and distinct from routine health recovery', () => {
  assert.match(
    workflow,
    /inputs\.mode == 'history-backfill'[\s\S]*env\.SNAPCASE_SYNC_ENABLED == 'true'/,
  );
  assert.match(workflow, /concurrency:\s*[\s\S]*group: snapcase-sync/);
  assert.match(workflow, /timeout-minutes: \$\{\{ inputs\.mode == 'history-backfill' && 360 \|\| 20 \}\}/);
  assert.doesNotMatch(health, /mode=history-backfill/);
  assert.match(health, /mode=live-ingest/);
});

test('routine and history runners receive only server-side exact payment source keys', () => {
  const matches = workflow.match(/SNAPCASE_NONFINANCIAL_TEST_PAYMENT_SOURCE_KEYS:\s*\$\{\{ secrets\.SNAPCASE_NONFINANCIAL_TEST_PAYMENT_SOURCE_KEYS \}\}/g) ?? [];
  assert.equal(matches.length, 2);
  const usdMatches = workflow.match(/SNAPCASE_USD_INTERPRETATION_PAYMENT_SOURCE_KEYS:\s*\$\{\{ secrets\.SNAPCASE_USD_INTERPRETATION_PAYMENT_SOURCE_KEYS \}\}/g) ?? [];
  assert.equal(usdMatches.length, 2);
  assert.doesNotMatch(workflow, /echo[^\n]*SNAPCASE_NONFINANCIAL_TEST_PAYMENT_SOURCE_KEYS/);
  assert.doesNotMatch(workflow, /echo[^\n]*SNAPCASE_USD_INTERPRETATION_PAYMENT_SOURCE_KEYS/);
});
