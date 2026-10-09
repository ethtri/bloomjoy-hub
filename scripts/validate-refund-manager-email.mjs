import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
// Uses only synthetic fixtures and blocks all external requests. Never sends mail.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'output/playwright/refund-manager-email');
execFileSync('deno', ['run', '--no-lock', '--allow-write=output/playwright/refund-manager-email', 'scripts/preview-refund-manager-email.ts'], { cwd: root, stdio: 'inherit' });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const variant of ['setup', 'ready', 'unknown', 'operations', 'legacy', 'long']) {
    for (const width of [320, 375, 900]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.route('**/*', route => route.request().url().startsWith('file:') ? route.continue() : route.abort());
      await page.goto(pathToFileURL(path.join(output, `${variant}.html`)).href);
      const state = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth,
        headingCount: document.querySelectorAll('h1').length, linkCount: document.querySelectorAll('a').length,
        buttonHeight: document.querySelector('a').getBoundingClientRect().height,
        buttonBottom: document.querySelector('a').getBoundingClientRect().bottom,
      }));
      assert(state.scrollWidth <= width + 1, `${variant} overflow at ${width}`);
      assert.equal(state.headingCount, 1); assert.equal(state.linkCount, 1);
      assert(state.buttonHeight >= 44, '44px touch target');
      if (width >= 375 && variant !== 'long') assert(state.buttonBottom < 750, 'primary action early in message');
      await page.screenshot({ path: path.join(output, `${variant}-${width}.png`), fullPage: true });
      results.push({ variant, width, ...state });
      await page.close();
    }
  }
  const page = await browser.newPage({ viewport: { width: 375, height: 900 }, colorScheme: 'dark' });
  await page.route('https://**/*', route => route.abort());
  await page.goto(pathToFileURL(path.join(output, 'setup.html')).href);
  assert.equal(await page.getByRole('link', { name: 'View case' }).count(), 1);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, 'setup-dark-images-blocked.png'), fullPage: true });
} finally { await browser.close(); }
await writeFile(path.join(output, 'review.json'), JSON.stringify({ synthetic: true, emailsSent: 0, results }, null, 2));
console.log(JSON.stringify({ viewportChecks: results.length, darkImagesBlocked: true, emailsSent: 0 }));

await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bloomjoy refund notice previews</title><style>body{margin:0;background:#faf7f8;color:#292b34;font:16px system-ui}header{padding:20px;max-width:900px;margin:auto}h1{font-size:24px}nav{display:flex;gap:12px;flex-wrap:wrap}a{color:#923c58}iframe{width:100%;min-height:1050px;border:0}</style><header><h1>Refund notice previews</h1><p>Synthetic cases. No emails sent.</p><nav><a href="setup.html" target="preview">Connection issue</a><a href="ready.html" target="preview">Ready for review</a><a href="unknown.html" target="preview">Unknown refund status</a><a href="operations.html" target="preview">Routing exception</a><a href="legacy.html" target="preview">Historical context</a><a href="long.html" target="preview">Long text</a></nav></header><iframe title="Refund email preview" name="preview" src="setup.html"></iframe></html>`);
