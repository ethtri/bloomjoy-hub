import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectSunzeMachineInventory, parseSunzeMachinePagination, scrollSunzeMachineList } from './machine-inventory-coverage.mjs';

const scan = (pages, options = {}) => {
  let page = 0;
  return collectSunzeMachineInventory({
    readMachines: async () => pages[page].ids.map(machineCode => ({ machineCode, machineName: null })),
    readPagination: async () => ({ total: pages[page].total ?? null, totalAmbiguous: pages[page].ambiguous,
      nextState: pages[page].nextState ?? (page + 1 < pages.length ? 'enabled' : 'disabled') }),
    scroll: async () => false, settle: async () => {},
    advancePage: async () => { page++; return true; }, ...options,
  });
};
test('trusted pagination parses provider total but rejects conflicting totals', () => {
  assert.deepEqual(parseSunzeMachinePagination({ nextState: 'enabled', totalTexts: ['Total 35 items'] }),
    { nextState: 'enabled', total: 35, totalAmbiguous: false });
  assert.equal(parseSunzeMachinePagination({ nextState: 'disabled', totalTexts: ['Total 35 items', 'Total 36 items'] }).totalAmbiguous, true);
  assert.equal(parseSunzeMachinePagination({ nextState: 'absent', totalTexts: ['1 2 3 Next'] }).total, null);
});
test('collects 25 pages beyond old20 ceiling, including unnamed/offline identities', async () => {
  const result = await scan(Array.from({ length: 25 }, (_, n) => ({ ids: [`source-${n}`], total: 25 })));
  assert.equal(result.coverage.verified, true);
  assert.equal(result.coverage.pagesScanned, 25);
  assert.deepEqual(new Set(result.machines.map(m => m.machineCode)), new Set(Array.from({ length: 25 }, (_, n) => `source-${n}`)));
});
test('page ceiling retains partial rows but never claims complete or clicks unread page', async () => {
  const result = await scan([{ ids: ['a'], total: 3 }, { ids: ['b'], total: 3 }, { ids: ['c'], total: 3 }], { maxPages: 2 });
  assert.equal(result.coverage.issue, 'machine_page_limit');
  assert.equal(result.coverage.verified, false);
  assert.equal(result.coverage.nextClicks, 1);
  assert.deepEqual(result.machines.map(m => m.machineCode), ['a', 'b']);
});
test('unadvanced/repeated provider page cannot silently complete', async () => {
  const result = await scan([{ ids: ['a'] }, { ids: ['a'] }]);
  assert.equal(result.coverage.issue, 'repeated_machine_page');
});
test('stable provider total catches premature disabled navigation', async () => {
  assert.equal((await scan([{ ids: ['a'], total: 2 }])).coverage.issue, 'machine_provider_count_mismatch');
});
test('provider total changes or ambiguity invalidate coverage', async () => {
  assert.equal((await scan([{ ids: ['a'], total: 2 }, { ids: ['b'], total: 3 }])).coverage.issue, 'machine_total_changed');
  assert.equal((await scan([{ ids: ['a'], ambiguous: true }])).coverage.issue, 'ambiguous_machine_total');
});
test('configured account expected count mismatch remains explicitly unverified', async () => {
  assert.equal((await scan([{ ids: ['a'] }], { expectedCount: 2 })).coverage.issue, 'machine_expected_count_mismatch');
});
test('missing navigation requires a matching provider total, not any nonzero rows', async () => {
  assert.equal((await scan([{ ids: ['a'], nextState: 'absent' }])).coverage.verified, false);
  assert.equal((await scan([{ ids: ['a'], nextState: 'absent', total: 1 }])).coverage.verified, true);
});
test('empty inventory needs explicit zero total', async () => {
  assert.equal((await scan([{ ids: [], total: 0 }])).coverage.verified, true);
  assert.equal((await scan([{ ids: [] }])).coverage.verified, false);
});
test('scroll ceiling is incomplete even when some valid rows were read', async () => {
  assert.equal((await scan([{ ids: ['a'] }], { scroll: async () => true, maxScrolls: 2 })).coverage.issue, 'machine_scroll_limit');
});
test('failed enabled next action does not prove provider exhaustion', async () => {
  assert.equal((await scan([{ ids: ['a'], nextState: 'enabled' }], { advancePage: async () => false })).coverage.issue, 'machine_next_page_failed');
});
test('source set proof changes with identity even when count is the same', async () => {
  const first = await scan([{ ids: ['a', 'b'] }]);
  const second = await scan([{ ids: ['a', 'c'] }]);
  const reordered = await scan([{ ids: ['b', 'a'] }]);
  assert.match(first.coverage.sourceIdsDigest, /^[a-f0-9]{64}$/);
  assert.notEqual(first.coverage.sourceIdsDigest, second.coverage.sourceIdsDigest);
  assert.equal(first.coverage.sourceIdsDigest, reordered.coverage.sourceIdsDigest);
});
test('disabled Next and skipped virtual middle cards with no total stay unverified', async () => {
  let lastWindow = false;
  const result = await scan([{ ids: ['first'] }], {
    readMachines: async () => [{ machineCode: lastWindow ? 'last' : 'first' }],
    scroll: async () => { if (lastWindow) return false; lastWindow = true; return true; },
  });
  assert.equal(result.coverage.verified, false);
  assert.equal(result.coverage.issue, 'machine_provider_total_unavailable');
});
test('overlapping virtual viewports collect middle identities and deduplicate DOM containers', async () => {
  const savedDocument = globalThis.document, savedElement = globalThis.HTMLElement;
  class Element { scrollTop = 0; clientHeight = 100; scrollHeight = 500; }
  const root = new Element();
  globalThis.HTMLElement = Element;
  globalThis.document = { scrollingElement: root, documentElement: root, body: root, querySelectorAll: () => [root] };
  try {
    const result = await scan([{ ids: [] }], {
      readMachines: async () => Array.from({ length: 10 }, (_, n) => ({ machineCode: `source-${Math.floor(root.scrollTop / 10) + n}` })),
      scroll: scrollSunzeMachineList,
      readPagination: async () => ({ nextState: 'disabled', total: 50 }),
    });
    assert.equal(result.coverage.verified, true);
    assert.equal(result.machines.length, 50);
    assert.equal(result.coverage.scrollAttempts, 6);
  } finally { globalThis.document = savedDocument; globalThis.HTMLElement = savedElement; }
});
