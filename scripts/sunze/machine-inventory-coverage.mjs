// Only exhausted navigation or a stable provider total proves complete coverage.
// Partial identities remain useful for discovery; they must never claim completeness.
import { extractUiRecordCount } from './reconcile-orders-export.mjs';
import { createHash } from 'node:crypto';

export const parseSunzeMachinePagination = ({ nextState, totalTexts }) => {
  const count = extractUiRecordCount({ trustedTexts: totalTexts });
  return { nextState, total: count.uiRecordCountTrusted ? count.uiRecordCount : null,
    totalAmbiguous: count.uiRecordCountCandidates.length > 1 };
};

// Overlapping viewports retain middle cards in virtualized lists. This function
// is serialized by Playwright; keep it independent of module closures.
export const scrollSunzeMachineList = () => {
  const candidates = new Set([document.scrollingElement, document.documentElement,
    document.body, ...document.querySelectorAll('.device-list-container,.ant-table-body,.ant-table-content,.ant-list,.ant-card-body,main,[class*="scroll"],[class*="table"]')]);
  let moved = false;
  for (const element of candidates) {
    if (!(element instanceof HTMLElement) || element.clientHeight <= 0) continue;
    const before = element.scrollTop;
    element.scrollTop = Math.min(element.scrollHeight - element.clientHeight,
      before + Math.max(1, Math.floor(element.clientHeight * 0.75)));
    moved ||= element.scrollTop !== before;
  }
  return moved;
};

export const collectSunzeMachineInventory = async ({
  readMachines, readPagination, scroll, advancePage, settle,
  expectedCount = null, maxPages = 1000, maxScrolls = 100,
}) => {
  const machines = new Map();
  const seenPages = new Set();
  let pagesScanned = 0, nextClicks = 0, scrollAttempts = 0;
  let providerTotal = null, issue = null, exhausted = false;
  const collect = async () => {
    const rows = await readMachines();
    for (const row of rows) {
      if (!row.machineCode) continue;
      const old = machines.get(row.machineCode);
      machines.set(row.machineCode, { ...row, machineName: row.machineName ?? old?.machineName ?? null });
    }
    return rows.map(row => row.machineCode).filter(Boolean).sort().join('|');
  };
  for (let index = 0; index < maxPages; index++) {
    pagesScanned++;
    const signature = await collect();
    if (seenPages.has(signature)) { issue = 'repeated_machine_page'; break; }
    seenPages.add(signature);
    let scrollExhausted = false;
    for (let attempt = 0; attempt < maxScrolls; attempt++) {
      if (!await scroll()) { scrollExhausted = true; break; }
      scrollAttempts++;
      await settle('scroll');
      await collect();
    }
    if (!scrollExhausted) { issue = 'machine_scroll_limit'; break; }
    const pagination = await readPagination();
    if (pagination.totalAmbiguous) { issue = 'ambiguous_machine_total'; break; }
    if (Number.isSafeInteger(pagination.total) && pagination.total >= 0) {
      if (providerTotal !== null && pagination.total !== providerTotal) { issue = 'machine_total_changed'; break; }
      providerTotal = pagination.total;
    }
    if (pagination.nextState === 'disabled') { exhausted = true; break; }
    if (pagination.nextState !== 'enabled') {
      exhausted = providerTotal !== null && machines.size === providerTotal;
      if (!exhausted) issue = 'machine_navigation_unverified';
      break;
    }
    if (index + 1 >= maxPages) { issue = 'machine_page_limit'; break; }
    if (!await advancePage()) { issue = 'machine_next_page_failed'; break; }
    nextClicks++;
    await settle('page');
  }
  if (!issue && providerTotal !== null && machines.size !== providerTotal) issue = 'machine_provider_count_mismatch';
  if (!issue && Number.isSafeInteger(expectedCount) && expectedCount >= 0 && machines.size !== expectedCount) issue = 'machine_expected_count_mismatch';
  if (!issue && machines.size === 0 && providerTotal !== 0) issue = 'missing_visible_machine_codes';
  if (!issue && !exhausted) issue = 'machine_navigation_unverified';
  if (!issue && providerTotal === null && !Number.isSafeInteger(expectedCount)) issue = 'machine_provider_total_unavailable';
  return {
    machines: [...machines.values()].sort((a, b) => a.machineCode.localeCompare(b.machineCode)),
    coverage: { verified: issue === null, issue, navigationExhausted: exhausted,
      visibleSourceMachineCount: machines.size, providerTotal, expectedCount,
      sourceIdsDigest: createHash('sha256').update(JSON.stringify([...machines.keys()].sort())).digest('hex'),
      pagesScanned, nextClicks, scrollAttempts },
  };
};
