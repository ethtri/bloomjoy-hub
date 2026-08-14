import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalSource = await readFile(
  new URL('./validate-refund-portal-uat.mjs', import.meta.url),
  'utf8'
);
const refundsSource = await readFile(
  new URL('../../src/pages/admin/Refunds.tsx', import.meta.url),
  'utf8'
);

assert.match(portalSource, /navigateRefundPortalPage/);
assert.match(portalSource, /reloadRefundPortalPage/);
assert.match(portalSource, /closeRefundPortalPage/);
assert.match(portalSource, /closeRefundPortalContext/);
assert.doesNotMatch(portalSource, /await\s+[A-Za-z_$][\w$]*\.goto\(/);
assert.doesNotMatch(portalSource, /await\s+[A-Za-z_$][\w$]*\.reload\(/);
assert.doesNotMatch(portalSource, /await\s+[A-Za-z_$][\w$]*Context\.close\(\)/);
assert.doesNotMatch(portalSource, /await\s+context\.close\(\)/);
assert.doesNotMatch(portalSource, /await\s+(?!browser\b)[A-Za-z_$][\w$]*\.close\(\)/);
assert.match(
  portalSource,
  /Explicit demo mode does not fetch live refund overview RPC data[\s\S]*?await closeRefundPortalPage\(page\);[\s\S]*?page = await context\.newPage\(\);[\s\S]*?trackErrors\(page\);[\s\S]*?navigateRefundPortalPage\(page, `\$\{appUrl\}\/refunds\?demo=off`/
);
assert.match(
  refundsSource,
  /data-testid="refund-gmail-latest-note-header"[\s\S]*?flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between[\s\S]*?<div className="min-w-0">/
);
assert.match(
  refundsSource,
  /data-testid="refund-gmail-latest-note-redacted"[\s\S]*?max-w-full whitespace-normal border-orange-200 bg-orange-50 text-left text-orange-900[\s\S]*?Full card number redacted/
);
assert.match(
  refundsSource,
  /data-testid="refund-gmail-open-recovery"[\s\S]*?h-auto w-full whitespace-normal border-orange-400 bg-white py-2 text-center leading-5 text-orange-950 hover:bg-orange-100 sm:w-auto[\s\S]*?Review and resume automatic email/
);

console.log('Refund portal lifecycle and mobile-width static checks passed.');
