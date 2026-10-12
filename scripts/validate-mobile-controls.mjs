// Focus/reachability regression for actual shared primitives; no live API clients.
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = 'output/playwright/mobile-controls';
const fixture = `${output}/index.html`;
await mkdir(output, { recursive: true });
await writeFile(fixture, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic controls</title></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/mobile-controls.jsx"></script></body></html>');
const server = await createServer({ mode: 'test', server: { host: '127.0.0.1', port: 0 } });
let browser;
const results = [];
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch();
  for (const [width, height] of [[320, 568], [568, 320], [390, 844], [1440, 900]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
    });
    await page.goto(`${origin}${fixture}`);
    for (const largeText of [false, true]) {
      await page.evaluate(enlarge => { document.documentElement.style.fontSize = enlarge ? '200%' : ''; }, largeText);
      const opener = page.getByRole('button', { name: 'Long confirmation', exact: true });
      await opener.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('alertdialog');
      await dialog.waitFor();
      await page.waitForTimeout(250);
      assert.ok(await dialog.evaluate(el => el === document.activeElement), 'Long dialog starts with visible content focus');
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height);
      assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), 'No clipped horizontal dialog content');
      await page.screenshot({ path: `${output}/${width}-${largeText ? '200' : '100'}-top.png` });
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.tagName), 'SUMMARY');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Confirmation note');
      for (const label of ['Cancel', 'Confirm synthetic request']) {
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.textContent), label);
        const button = await page.getByRole('button', { name: label, exact: true }).boundingBox();
        assert.ok(button.y >= bounds.y && button.y + button.height <= bounds.y + bounds.height, 'Focused action stays inside the viewport');
      }
      await page.screenshot({ path: `${output}/${width}-${largeText ? '200' : '100'}-actions.png` });
      await page.keyboard.press('Tab');
      assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)), 'Tab remains trapped');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.ok(await opener.evaluate(el => el === document.activeElement), 'Escape restores opener focus');
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    for (const [kind, expected] of [['Short', 'Cancel'], ['Explicit', 'explicit-note']]) {
      await page.getByRole('button', { name: `${kind} confirmation`, exact: true }).click();
      await page.getByRole('alertdialog').waitFor();
      await page.waitForTimeout(250);
      const focused = await page.evaluate(() => document.activeElement.id || document.activeElement.textContent);
      assert.equal(focused, expected, `${kind} autofocus is preserved`);
      await page.keyboard.press('Escape');
      await page.getByRole('alertdialog').waitFor({ state: 'hidden' });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Long confirmation', exact: true }).click();
    await page.getByRole('alertdialog').waitFor();
    assert.equal(await page.getByRole('alertdialog').evaluate(el => getComputedStyle(el).animationName), 'none');
    assert.deepEqual(pageErrors, [], 'Synthetic fixture has no runtime errors');
    results.push({ width, height, enlargedText: true, focusAndActions: 'pass', reducedMotion: 'pass' });
    await page.close();
  }
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(`PASS mobile confirmation focus and reachability at ${results.map(row => `${row.width}x${row.height}`).join(', ')}; normal/200% text, preserved short/caller autofocus and reduced motion.`);
} finally {
  await browser?.close();
  await server.close();
  await rm(fixture, { force: true });
}
