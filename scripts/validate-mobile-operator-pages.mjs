import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const app = read('src/App.tsx');
const solution = read('src/pages/solutions/FoodTrucks.tsx');
const setup = read('src/pages/resources/MobileFoodSetupGuide.tsx');
const content = read('src/data/mobileOperatorPages.ts');
const seo = read('src/lib/seoRoutes.ts');
const vercel = read('vercel.json');
const resources = read('src/pages/Resources.tsx');
const playbook = read('src/pages/resources/BusinessPlaybookIndex.tsx');
const machines = read('src/pages/Products.tsx');
const mini = read('src/pages/products/Mini.tsx');
const prerender = read('scripts/prerender-public-routes.mjs');

const solutionPath = '/solutions/food-trucks';
const setupPath = '/resources/business-playbook/food-truck-mobile-setup-guide';

const quotePaths = [...content.matchAll(/'(\/contact\?[^']+)'/g)].map((match) => match[1]);
const allowedQuoteKeys = new Set(['type', 'interest', 'source', 'use']);
const quotePathsAreSafe = quotePaths.length >= 1 && quotePaths.every((path) => {
  const url = new URL(path, 'https://www.bloomjoyusa.com');
  return (
    url.searchParams.get('type') === 'quote' &&
    url.searchParams.get('interest') === 'commercial' &&
    [...url.searchParams.keys()].every((key) => allowedQuoteKeys.has(key)) &&
    (!url.searchParams.has('use') || url.searchParams.get('use') === 'mobile-food')
  );
});

const assertions = [
  ['both canonical routes are registered', app.includes(`path="${solutionPath}"`) && app.includes(`path="${setupPath}"`)],
  ['both routes have unique SEO records and lastmods', seo.includes(`path: FOOD_TRUCK_SOLUTION_PATH`) && seo.includes(`path: MOBILE_SETUP_GUIDE_PATH`) && seo.includes('"/solutions/food-trucks": "2026-08-10"')],
  ['solution FAQ content is shared with structured data', solution.includes('foodTruckSolutionFaqs.map') && seo.includes('return foodTruckSolutionFaqs')],
  ['setup guide has Article and breadcrumb structured content', seo.includes('route.structuredDataKind === "mobile-setup-guide"') && seo.includes('Food-Truck Cotton Candy Machine Setup Guide')],
  ['Vercel serves the prerendered solution route', vercel.includes('"src": "/solutions/food-trucks/?"') && vercel.includes('"dest": "/solutions/food-trucks.html"')],
  ['slow route chunks are loaded before app hydration', prerender.includes('["/solutions/food-trucks", "src/pages/solutions/FoodTrucks.tsx"]') && prerender.includes('"/resources/business-playbook/food-truck-mobile-setup-guide"') && prerender.includes('data-prerender-route-module')],
  ['Mini facts match the approved claim matrix', content.includes('430 × 555 × 1582 mm; 83.9 kg') && content.includes('2400W maximum; 100W standby') && content.includes('25–35 served/hour')],
  ['Commercial facts match the approved claim matrix', content.includes('2001 × 643 × 1315 mm or 2001 × 671 × 1332 mm') && content.includes('2700W') && content.includes('70–130 second')],
  ['Micro missing-spec boundary is explicit', content.includes('does not state the dimensions, weight, power, or mobile service rate')],
  ['unsupported approvals are explicitly excluded', /do\s+not\s+certify\s+vehicle\s+installations,\s+generators,\s+ventilation,\s+outdoor\s+use,\s+or\s+permits/i.test(solution) && /Watts\s+do\s+not\s+approve\s+a\s+generator/i.test(setup)],
  ['solution includes meaningful stop conditions', solution.includes('When this is not a fit') && solution.includes('noFitSignals.map')],
  ['checklist covers ten bounded setup categories', (content.match(/id: '/g) ?? []).length >= 13 && setup.includes('mobileSetupChecklist.map')],
  ['checklist does not persist browser data', !setup.includes('localStorage') && !setup.includes('sessionStorage')],
  ['quote handoffs use only allowlisted categorical context', quotePathsAreSafe],
  ['quote handoffs enforce the Commercial-only policy', !content.includes('interest=mini') && solution.includes('Commercial is Bloomjoy’s only quoted machine') && setup.includes('Commercial is Bloomjoy’s only quoted machine')],
  ['no proof placeholders or rating schema are emitted', !solution.match(/testimonial|aggregateRating|reviewRating|logo wall/i)],
  ['Resources and Playbook expose a mobile entry', resources.includes('MobileOperatorEntry') && playbook.includes('MobileOperatorEntry')],
  ['machine overview and Mini link contextually', machines.includes('FOOD_TRUCK_SOLUTION_PATH') && mini.includes('FOOD_TRUCK_SOLUTION_PATH')],
  ['setup guide links maintained official sources', setup.includes('leginfo.legislature.ca.gov') && setup.includes('www.fda.gov/media/164194/download')],
];

const failed = assertions.filter(([, passed]) => !passed);
if (failed.length > 0) {
  for (const [name] of failed) console.error(`FAIL ${name}`);
  process.exit(1);
}

for (const [name] of assertions) console.log(`PASS ${name}`);
console.log('Mobile-operator solution and setup-guide validation passed.');
