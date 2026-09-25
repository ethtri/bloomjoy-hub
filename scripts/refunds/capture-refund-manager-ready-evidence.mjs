import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const directory = resolve('Docs/screenshots/refund-ready-1425');
const browser = await chromium.launch({ headless: true });
try {
  for (const name of ['card', 'cash']) {
    for (const [size, width] of [['desktop', 1440], ['mobile', 320]]) {
      const page = await browser.newPage({ viewport: { width, height: 850 }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(resolve(directory, `${name}.html`)).href);
      await page.screenshot({ path: resolve(directory, `${name}-${size}.png`), fullPage: true });
      const layout = await page.evaluate(() => ({
        heading: document.querySelector('h1')?.textContent,
        linkCount: document.querySelectorAll('a[href]').length,
        overflowing: document.documentElement.scrollWidth > window.innerWidth,
      }));
      if (layout.heading !== 'Refund decision ready' || layout.linkCount !== 1 || layout.overflowing) {
        throw new Error(`${name} ${size} email layout failed: ${JSON.stringify(layout)}`);
      }
      if (size === 'mobile') {
        await page.evaluate(() => { document.body.style.zoom = '200%'; });
        const zoomOverflow = await page.evaluate(() =>
          document.documentElement.scrollWidth > window.innerWidth);
        if (zoomOverflow) throw new Error(`${name} mobile email overflows at 200% zoom`);
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
}
console.log('Synthetic ready-email desktop, mobile, and 200% zoom layout checks passed.');
