import fs from 'node:fs';

const marketingOrigin = 'https://www.bloomjoyusa.com';
const distRoot = new URL('../dist/', import.meta.url);
const sitemapPath = new URL('sitemap.xml', distRoot);

const affectedRoutes = [
  '/machines/commercial-robotic-machine',
  '/resources/business-playbook/how-to-start-cotton-candy-vending-business',
  '/resources/business-playbook/best-locations-for-cotton-candy-vending-machines',
  '/resources/business-playbook/mini-micro-event-catering-business-guide',
  '/resources/business-playbook/startup-budget-checklist-cotton-candy-machine-business',
  '/resources/business-playbook/how-to-pitch-location-owners',
  '/resources/business-playbook/revenue-share-vs-rent-cotton-candy-machine-placement',
  '/resources/business-playbook/commercial-vending-vs-event-catering',
  '/resources/business-playbook/business-setup-basics-llc-ein-insurance-permits',
  '/contact',
  '/about',
  '/privacy',
];

const articlePrefix = '/resources/business-playbook/';
const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

if (!fs.existsSync(sitemapPath)) {
  console.error('Missing dist/sitemap.xml. Run npm run build first.');
  process.exit(1);
}

const sitemap = fs.readFileSync(sitemapPath, 'utf8');
const sitemapEntries = [...sitemap.matchAll(
  /<url>\s*<loc>https:\/\/www\.bloomjoyusa\.com([^<]*)<\/loc>\s*<lastmod>([^<]*)<\/lastmod>/g,
)].map((match) => ({ route: match[1] || '/', lastmod: match[2] }));

const routeFile = (route) =>
  route === '/'
    ? new URL('index.html', distRoot)
    : new URL(`${route.slice(1)}/index.html`, distRoot);

const publicPages = new Map();
for (const entry of sitemapEntries) {
  const file = routeFile(entry.route);
  assert(fs.existsSync(file), `${entry.route}: prerendered HTML is missing`);
  if (fs.existsSync(file)) {
    publicPages.set(entry.route, {
      ...entry,
      html: fs.readFileSync(file, 'utf8'),
    });
  }
}

const extract = (html, pattern) => html.match(pattern)?.[1]?.trim() ?? '';
const stripMarkup = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const mainMarkup = (html) => extract(html, /<main[^>]*>([\s\S]*?)<\/main>/i);
const normalizeHref = (href) => {
  const decoded = href.replaceAll('&amp;', '&');
  if (decoded.startsWith(marketingOrigin)) return new URL(decoded).pathname;
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return null;
  return decoded.split(/[?#]/)[0] || '/';
};
const linkedRoutes = (html) =>
  [...html.matchAll(/href="([^"]+)"/g)]
    .map((match) => normalizeHref(match[1]))
    .filter(Boolean);

const report = [];
const titles = new Set();
const headings = new Set();

for (const route of affectedRoutes) {
  const page = publicPages.get(route);
  assert(Boolean(page), `${route}: missing from the canonical sitemap`);
  if (!page) continue;

  const { html, lastmod } = page;
  const title = extract(html, /<title>([^<]+)<\/title>/i);
  const h1 = stripMarkup(extract(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i));
  const canonical = extract(
    html,
    /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i,
  );
  const robots = extract(
    html,
    /<meta[^>]+name="robots"[^>]+content="([^"]+)"/i,
  );
  const main = mainMarkup(html);
  const wordCount = stripMarkup(main).split(/\s+/).filter(Boolean).length;
  const incoming = [...publicPages.entries()]
    .filter(([source]) => source !== route)
    .filter(([, sourcePage]) => linkedRoutes(sourcePage.html).includes(route))
    .map(([source]) => source);
  const minimumWords = route.startsWith(articlePrefix)
    ? 1_000
    : route === '/machines/commercial-robotic-machine'
      ? 600
      : route === '/contact'
        ? 30
      : 100;

  assert(Boolean(title), `${route}: title is missing`);
  assert(Boolean(h1), `${route}: rendered H1 is missing`);
  assert(
    /<div id="root" data-prerendered="true">/.test(html),
    `${route}: prerendered root marker is missing`,
  );
  assert(canonical === `${marketingOrigin}${route}`, `${route}: canonical is incorrect`);
  assert(robots.startsWith('index,follow'), `${route}: robots is not indexable`);
  assert(wordCount >= minimumWords, `${route}: rendered main content is too thin (${wordCount} words)`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(lastmod), `${route}: sitemap lastmod is invalid`);
  assert(incoming.length >= 2, `${route}: fewer than two crawlable public routes link to it`);
  assert(!titles.has(title), `${route}: title duplicates another affected route`);
  assert(!headings.has(h1), `${route}: H1 duplicates another affected route`);
  titles.add(title);
  headings.add(h1);
  report.push({ route, wordCount, incoming: incoming.length, lastmod });
}

const contextualLinks = [
  {
    source: '/machines/commercial-robotic-machine',
    target: '/resources/business-playbook/how-to-pitch-location-owners',
  },
  {
    source: '/about',
    target: '/machines/commercial-robotic-machine',
  },
  {
    source: '/about',
    target: '/resources/business-playbook/how-to-start-cotton-candy-vending-business',
  },
  {
    source: '/resources/business-playbook/cotton-candy-machine-roi-sales-payback-planning',
    target: '/resources/business-playbook/business-setup-basics-llc-ein-insurance-permits',
  },
];

for (const { source, target } of contextualLinks) {
  const sourcePage = publicPages.get(source);
  assert(Boolean(sourcePage), `${source}: contextual-link source is missing`);
  if (sourcePage) {
    assert(
      linkedRoutes(mainMarkup(sourcePage.html)).includes(target),
      `${source}: rendered main content does not link to ${target}`,
    );
  }
}

for (const excludedRoute of [
  '/cart',
  '/login',
  '/portal',
  '/admin',
  '/products',
  '/products/commercial-robotic-machine',
]) {
  assert(!publicPages.has(excludedRoute), `${excludedRoute}: private or noncanonical route entered sitemap`);
}

if (failures.length > 0) {
  failures.forEach((failure) => console.error(`FAIL ${failure}`));
  process.exit(1);
}

console.log('Public route discovery validation passed.');
for (const row of report) {
  console.log(`${row.route} | words=${row.wordCount} | incoming=${row.incoming} | lastmod=${row.lastmod}`);
}
