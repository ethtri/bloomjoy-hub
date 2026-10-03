import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

// Synthetic renderer output only; never connects to a database or email provider.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'output/playwright/email-digest-redesign');
execFileSync('deno', ['run', '--allow-write=output/playwright/email-digest-redesign', '--no-lock', 'scripts/preview-machine-email-digest.ts'], { cwd: root, stdio: 'inherit' });
const logo = await readFile(path.join(root, 'public/bloomjoy-icon.png'));
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const variant of ['daily', 'weekly', 'partial', 'technician', 'technician-request', 'legacy']) {
    for (const width of [900, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      await page.route('https://**/*', route => route.request().url() === 'https://app.bloomjoyusa.com/bloomjoy-icon.png'
        ? route.fulfill({ status: 200, contentType: 'image/png', body: logo }) : route.abort());
      await page.goto(pathToFileURL(path.join(output, `${variant}.html`)).href);
      const state = await page.evaluate(() => ({
        width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        headings: document.querySelectorAll('h1').length,
        columns: document.querySelectorAll('th[scope="col"]').length,
      }));
      assert(state.scrollWidth <= width + 1, `${variant} overflows at ${width}px`);
      assert.equal(state.headings, 1);
      assert.equal(state.columns, variant === 'technician-request' ? 0 : 3);
      await page.screenshot({ path: path.join(output, `${variant}-${width}.png`), fullPage: true });
      results.push({ variant, ...state });
      await page.close();
    }
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 1000 }, colorScheme: 'dark' });
  await page.route('https://**/*', route => route.abort());
  await page.goto(pathToFileURL(path.join(output, 'daily.html')).href);
  assert.equal(await page.getByText('Bloomjoy Hub', { exact: true }).count(), 1);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(output, 'daily-images-blocked-dark-preference.png'), fullPage: true });
  await page.close();
} finally { await browser.close(); }
await writeFile(path.join(output, 'review.json'), JSON.stringify({ synthetic: true, emailsSent: 0, results }, null, 2));
await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bloomjoy digest preview</title><style>body{margin:0;background:#fbf7f8;color:#282c35;font:15px system-ui,sans-serif}header{max-width:640px;margin:32px auto 24px;padding:0 16px}h1{font-size:22px;margin:0 0 8px}p{color:#62616c;line-height:1.6}nav{display:flex;gap:8px;flex-wrap:wrap}a{color:#923c58;padding:9px 12px;border:1px solid #eadfe3;border-radius:6px;text-decoration:none}a[aria-current]{background:#923c58;color:white}iframe{display:block;width:100%;border:0;min-height:1250px}</style><header><h1>Bloomjoy email digests</h1><p>Sample data · Actual email templates</p><nav><a href="daily.html" target="preview" aria-current="page">Daily</a><a href="weekly.html" target="preview">Weekly</a><a href="partial.html" target="preview">Missing data</a><a href="technician.html" target="preview">Technician</a></nav></header><iframe name="preview" title="Email preview" src="daily.html"></iframe><script>const frame=document.querySelector('iframe');frame.addEventListener('load',()=>{frame.style.height=frame.contentDocument.documentElement.scrollHeight+'px'});document.querySelectorAll('nav a').forEach(link=>link.addEventListener('click',()=>{document.querySelectorAll('nav a').forEach(a=>a.removeAttribute('aria-current'));link.setAttribute('aria-current','page')}));</script></html>`);
console.log(`PASS: ${results.length} synthetic viewport checks plus images-blocked/dark-preference rendering. No emails sent.`);
