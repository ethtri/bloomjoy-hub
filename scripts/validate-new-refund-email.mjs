import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'output/playwright/new-refund-email');
execFileSync('deno', ['run', '--no-lock', '--allow-write=output/playwright/new-refund-email', 'scripts/preview-new-refund-email.ts'], { cwd: root, stdio: 'inherit' });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
 for (const variant of ['standard', 'long', 'missing']) {
  for (const width of [320, 375, 900]) {
   const page = await browser.newPage({ viewport: { width, height: 900 } });
   await page.route('https://**/*', route => route.abort());
   await page.goto(pathToFileURL(path.join(output, `${variant}.html`)).href);
   assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no overflow');
   assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1);
   assert.equal(await page.getByRole('link').count(), 2);
   const rect = await page.getByRole('link', { name: 'View request' }).boundingBox();
   assert(rect.height >= 44, 'touch target');
   if (variant === 'standard') assert(rect.y + rect.height < 640, 'compact primary action');
   await page.screenshot({ path: path.join(output, `${variant}-${width}.png`), fullPage: true });
   results.push({ variant, width, buttonBottom: rect.y + rect.height });
   await page.close();
  }
 }
 const page = await browser.newPage({ viewport: { width: 375, height: 900 }, colorScheme: 'dark' });
 await page.route('https://**/*', route => route.abort());
 await page.goto(pathToFileURL(path.join(output, 'standard.html')).href);
 assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
 await page.screenshot({ path: path.join(output, 'standard-dark-images-blocked.png'), fullPage: true });
} finally { await browser.close(); }
await writeFile(path.join(output, 'review.json'), JSON.stringify({ synthetic: true, emailsSent: 0, results }, null, 2));
await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>New refund alert previews</title><style>body{margin:0;background:#faf7f8;color:#292b34;font:16px system-ui}header{padding:20px;max-width:900px;margin:auto}h1{font-size:24px}nav{display:flex;gap:16px}a{color:#923c58}iframe{width:100%;min-height:1000px;border:0}</style><header><h1>New refund request alert</h1><p>Synthetic cases. No email sent.</p><nav><a href="standard.html" target="preview">Request</a><a href="long.html" target="preview">Long text</a><a href="missing.html" target="preview">Missing details</a></nav></header><iframe name="preview" title="Email preview" src="standard.html"></iframe></html>`);
console.log(JSON.stringify({ viewportChecks: results.length, darkImagesBlocked: true, emailsSent: 0 }));
