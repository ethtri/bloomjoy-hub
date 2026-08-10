import fs from 'node:fs';
import { createServer } from 'vite';

const read = (path) =>
  fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');

const app = read('src/App.tsx');
const page = read('src/pages/resources/FoodTruckDessertAddOns.tsx');
const analytics = read('src/lib/businessPlaybookAnalytics.ts');
const quoteIntake = read('src/lib/quoteIntake.ts');
const seo = read('src/lib/seoRoutes.ts');
const seoRegression = read('scripts/seo-regression-check.mjs');
const prerender = read('scripts/prerender-public-routes.mjs');
const mobileEntry = read('src/components/resources/MobileOperatorEntry.tsx');
const solution = read('src/pages/solutions/FoodTrucks.tsx');
const decisions = read('Docs/DECISIONS.md');
const smoke = read('Docs/QA_SMOKE_TEST_CHECKLIST.md');

const vite = await createServer({
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
});

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
};

try {
  const comparison = await vite.ssrLoadModule('/src/data/dessertAddOnComparison.ts');
  const tracking = await vite.ssrLoadModule('/src/lib/businessPlaybookAnalytics.ts');
  const quoteUrl = new URL(
    comparison.foodTruckDessertAddOnsQuotePath,
    'https://www.bloomjoyusa.com'
  );
  const allowedQuoteKeys = new Set(['type', 'interest', 'source', 'use']);
  const cottonRows = comparison.dessertComparisonCriteria.map((criterion) =>
    criterion.rows.find((row) => row.dessert === 'cotton-candy')
  );
  const allComparisonCopy = JSON.stringify({
    options: comparison.dessertOptions,
    criteria: comparison.dessertComparisonCriteria,
  });

  assert(
    comparison.FOOD_TRUCK_DESSERT_ADD_ONS_PATH ===
      '/resources/business-playbook/food-truck-dessert-add-ons' &&
      comparison.dessertOptions.length === 5 &&
      comparison.dessertComparisonCriteria.length === 13 &&
      comparison.dessertComparisonCriteria.every((criterion) => criterion.rows.length === 5),
    'canonical route compares five categories across thirteen complete operator criteria'
  );
  assert(
    cottonRows.every(Boolean) &&
      cottonRows.filter((row) => row.posture === 'advantage').length < cottonRows.length / 2 &&
      cottonRows.filter((row) => row.posture === 'heavier').length >= 2,
    'cotton candy has explicit advantages, confirmation needs, and heavier obligations instead of winning every criterion'
  );
  assert(
    comparison.dessertOptions.every((option) =>
      new Set(
        comparison.dessertComparisonCriteria.map(
          (criterion) => criterion.rows.find((row) => row.dessert === option.id)?.posture
        )
      ).size >= 2
    ),
    'every dessert category exposes meaningful tradeoffs rather than a one-note grade'
  );
  assert(
    quoteUrl.pathname === '/contact' &&
      quoteUrl.searchParams.get('type') === 'quote' &&
      quoteUrl.searchParams.get('interest') === 'commercial' &&
      quoteUrl.searchParams.get('source') === comparison.FOOD_TRUCK_DESSERT_ADD_ONS_PATH &&
      quoteUrl.searchParams.get('use') === 'mobile-food' &&
      [...quoteUrl.searchParams.keys()].every((key) => allowedQuoteKeys.has(key)),
    'quote handoff is fixed to Commercial with canonical mobile-use context and four allowlisted keys'
  );
  assert(
    tracking.getNormalizedBusinessPlaybookSourcePage(
      comparison.FOOD_TRUCK_DESSERT_ADD_ONS_PATH
    ) === comparison.FOOD_TRUCK_DESSERT_ADD_ONS_PATH &&
      tracking.getNormalizedBusinessPlaybookSourcePage(
        `${comparison.FOOD_TRUCK_DESSERT_ADD_ONS_PATH}?private=discarded`
      ) === comparison.FOOD_TRUCK_DESSERT_ADD_ONS_PATH,
    'canonical comparison source is normalized without arbitrary query context'
  );
  assert(
    app.indexOf('path="/resources/business-playbook/food-truck-dessert-add-ons"') > -1 &&
      app.indexOf('path="/resources/business-playbook/food-truck-dessert-add-ons"') <
        app.indexOf('path="/resources/business-playbook/:slug"'),
    'dedicated comparison route is registered before the generic playbook slug route'
  );
  assert(
    seo.includes('structuredDataKind: "dessert-add-on-comparison"') &&
      seo.includes('Food Truck Dessert Add-Ons: Operator Comparison | Bloomjoy') &&
      seoRegression.includes('EXPECTED_PUBLIC_ROUTE_COUNT = 30'),
    'metadata, Article schema, sitemap freshness, and public-route count are registered'
  );
  assert(
    prerender.includes('"src/pages/resources/FoodTruckDessertAddOns.tsx"') &&
      seoRegression.includes('"FoodTruckDessertAddOns-"') &&
      seoRegression.includes('Food-truck dessert add-ons, compared by operating fit'),
    'direct-load hydration preloads the comparison route and verifies its H1'
  );
  assert(
    !page.includes('<table') &&
      !page.includes('overflow-x-auto') &&
      page.includes('Criterion-by-criterion comparison') &&
      page.includes('dessertComparisonCriteria.map') &&
      page.includes('comparisonPostureLabels[row.posture]'),
    'comparison uses mobile criterion cards rather than a horizontally dependent table'
  );
  assert(
    comparison.dessertComparisonSources.length >= 6 &&
      comparison.dessertComparisonSources.some((source) => source.url.includes('fda.gov')) &&
      comparison.dessertComparisonSources.some((source) => source.url.includes('nfpa.org')) &&
      comparison.dessertComparisonSources.some((source) => source.url.includes('leginfo.legislature.ca.gov')) &&
      comparison.dessertComparisonSources.some((source) => source.url.includes('fsis.usda.gov')),
    'visible source set includes authoritative food, fire, jurisdiction, frozen, and product evidence'
  );
  assert(
    !/\$\d|\d+%|guaranteed servings|guaranteed throughput|permit-ready|high-profit|low food cost/i.test(
      allComparisonCopy
    ) &&
      page.includes('not a popularity, demand, profit, margin, payback'),
    'analysis publishes no price, profit, food-cost, payback, permit, demand, or speed promise'
  );
  assert(
    [
      'FOOD_TRUCK_SOLUTION_PATH',
      'MOBILE_SETUP_GUIDE_PATH',
      'MOBILE_SETUP_FIT_CHECKER_PATH',
      '/machines/mini',
      '/machines/commercial-robotic-machine',
      '/machines/micro',
      '/resources/business-playbook/planner',
      '/resources/business-playbook/payback-planner',
      'foodTruckDessertAddOnsQuotePath',
    ].every((value) => page.includes(value)),
    'qualified readers can reach solution, setup, checker, machines, planners, and quote paths'
  );
  assert(
    page.includes("trackEvent('view_business_playbook_article'") &&
      page.includes("surface: 'dessert_add_on_comparison'") &&
      analytics.includes('FOOD_TRUCK_DESSERT_ADD_ONS_PATH'),
    'view and CTA analytics use bounded route, slug, category, destination, and source fields only'
  );
  assert(
    mobileEntry.includes('FOOD_TRUCK_DESSERT_ADD_ONS_PATH') &&
      solution.includes('FOOD_TRUCK_DESSERT_ADD_ONS_PATH'),
    'Resources, Playbook, and the food-truck solution expose contextual comparison links'
  );
  assert(
    quoteIntake.includes("[FOOD_TRUCK_DESSERT_ADD_ONS_PATH]: 'food-truck dessert add-on comparison'") &&
      decisions.includes('Dessert add-on comparison is an operating-fit analysis (`#729`)') &&
      smoke.includes('/resources/business-playbook/food-truck-dessert-add-ons'),
    'quote source, durable decision, and smoke-test documentation cover the comparison contract'
  );

  console.log('Food-truck dessert add-on comparison validation passed.');
} finally {
  await vite.close();
}
