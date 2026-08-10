import fs from 'node:fs';
import { createServer } from 'vite';

const read = (path) =>
  fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');

const app = read('src/App.tsx');
const page = read('src/pages/resources/FoodTruckCateringDessertMenu.tsx');
const comparisonPage = read('src/pages/resources/FoodTruckDessertAddOns.tsx');
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
  const guide = await vite.ssrLoadModule('/src/data/cateringDessertMenu.ts');
  const tracking = await vite.ssrLoadModule('/src/lib/businessPlaybookAnalytics.ts');
  const quoteUrl = new URL(
    guide.foodTruckCateringDessertMenuQuotePath,
    'https://www.bloomjoyusa.com'
  );
  const allowedQuoteKeys = new Set(['type', 'interest', 'source', 'use']);
  const publishedCopy = JSON.stringify({
    proposalSections: guide.proposalSections,
    packageStructures: guide.packageStructures,
    responsibilityLanes: guide.responsibilityLanes,
    packageOutlineFields: guide.packageOutlineFields,
    cateringPackageOutlineText: guide.cateringPackageOutlineText,
  });

  assert(
    guide.FOOD_TRUCK_CATERING_DESSERT_MENU_PATH ===
      '/resources/business-playbook/food-truck-catering-dessert-menu' &&
      guide.proposalSections.length === 10 &&
      guide.proposalSections.every(
        (section) => section.buyerQuestion && section.operatorDecision && section.guardrail
      ),
    'canonical guide exposes ten complete buyer-question, operator-decision, and boundary cards'
  );
  assert(
    [
      'service-window',
      'planning-volume',
      'menu',
      'staffing',
      'travel-load-in',
      'power-setup',
      'payment-deposit',
      'weather',
      'cancellation',
      'paperwork',
    ].every((id) => guide.proposalSections.some((section) => section.id === id)),
    'scope covers service, estimates, menu, staff, travel, power, terms, weather, changes, and paperwork'
  );
  assert(
    guide.packageStructures.length === 2 &&
      guide.packageStructures.some((structure) => structure.id === 'fixed-event') &&
      guide.packageStructures.some((structure) => structure.id === 'per-serving') &&
      guide.packageStructures.every((structure) => structure.mustDefine.length === 4),
    'fixed-event and per-serving models remain bounded planning structures'
  );
  assert(
    guide.packageOutlineFields.length === 12 &&
      guide.cateringPackageOutlineText.includes('Template only.') &&
      guide.cateringPackageOutlineText.includes('not a guarantee') &&
      !/\$\s*\d|\d+\s*%|\d+\s*(servings|guests|minutes|hours)/i.test(publishedCopy),
    'reusable blank outline contains no numeric price, percentage, serving, guest, or time recommendation'
  );
  assert(
    quoteUrl.pathname === '/contact' &&
      quoteUrl.searchParams.get('type') === 'quote' &&
      quoteUrl.searchParams.get('interest') === 'commercial' &&
      quoteUrl.searchParams.get('source') ===
        guide.FOOD_TRUCK_CATERING_DESSERT_MENU_PATH &&
      quoteUrl.searchParams.get('use') === 'mobile-food' &&
      [...quoteUrl.searchParams.keys()].length === 4 &&
      [...quoteUrl.searchParams.keys()].every((key) => allowedQuoteKeys.has(key)),
    'quote handoff is fixed to Commercial with canonical mobile-use context and four allowlisted keys'
  );
  assert(
    tracking.getNormalizedBusinessPlaybookSourcePage(
      guide.FOOD_TRUCK_CATERING_DESSERT_MENU_PATH
    ) === guide.FOOD_TRUCK_CATERING_DESSERT_MENU_PATH &&
      tracking.getNormalizedBusinessPlaybookSourcePage(
        `${guide.FOOD_TRUCK_CATERING_DESSERT_MENU_PATH}?guestCount=private&price=discarded`
      ) === guide.FOOD_TRUCK_CATERING_DESSERT_MENU_PATH,
    'canonical guide source is normalized without arbitrary template or financial query context'
  );
  assert(
    app.indexOf('path="/resources/business-playbook/food-truck-catering-dessert-menu"') > -1 &&
      app.indexOf('path="/resources/business-playbook/food-truck-catering-dessert-menu"') <
        app.indexOf('path="/resources/business-playbook/:slug"'),
    'dedicated catering guide route is registered before the generic playbook slug route'
  );
  assert(
    seo.includes('structuredDataKind: "catering-dessert-menu-guide"') &&
      seo.includes('Food Truck Catering Dessert Package Guide | Bloomjoy') &&
      seoRegression.includes('EXPECTED_PUBLIC_ROUTE_COUNT = 30'),
    'metadata, Article schema, sitemap freshness, and public-route count are registered'
  );
  assert(
    prerender.includes('"src/pages/resources/FoodTruckCateringDessertMenu.tsx"') &&
      seoRegression.includes('"FoodTruckCateringDessertMenu-"') &&
      seoRegression.includes(
        'Build a food-truck catering dessert package buyers can understand'
      ),
    'direct-load hydration preloads the guide route and verifies its exact H1'
  );
  assert(
    !page.includes('<table') &&
      !page.includes('overflow-x-auto') &&
      page.includes('proposalSections.map') &&
      page.includes('packageStructures.map') &&
      page.includes('responsibilityLanes.map'),
    'guide uses responsive cards and lanes rather than a horizontally dependent table'
  );
  assert(
    page.includes('For established food-truck and catering operators') &&
      page.includes('This guide starts after you already run an operation.') &&
      page.includes('EVENT_BUSINESS_GUIDE_PATH'),
    'reader boundary stays with established operators and routes startups to the existing event guide'
  );
  assert(
    page.includes('navigator.clipboard.writeText(cateringPackageOutlineText)') &&
      page.includes('aria-live="polite"') &&
      page.includes("trackLink('copy_package_outline'") &&
      !page.includes('<input') &&
      !page.includes('<textarea'),
    'copy action publishes only the static template and exposes accessible bounded feedback'
  );
  assert(
    [
      'FOOD_TRUCK_DESSERT_ADD_ONS_PATH',
      'FOOD_TRUCK_SOLUTION_PATH',
      'MOBILE_SETUP_GUIDE_PATH',
      'MOBILE_SETUP_FIT_CHECKER_PATH',
      '/machines/mini',
      '/machines/micro',
      '/resources/business-playbook/payback-planner',
      'EVENT_BUSINESS_GUIDE_PATH',
      'foodTruckCateringDessertMenuQuotePath',
    ].every((value) => page.includes(value)),
    'reader can reach comparison, solution, setup, checker, products, planner, event guide, and quote paths'
  );
  assert(
    page.includes("trackEvent('view_business_playbook_article'") &&
      page.includes("surface: 'catering_dessert_menu_guide'") &&
      analytics.includes('FOOD_TRUCK_CATERING_DESSERT_MENU_PATH'),
    'view, copy, and CTA analytics use bounded route, slug, category, destination, and source fields only'
  );
  assert(
    mobileEntry.includes('FOOD_TRUCK_CATERING_DESSERT_MENU_PATH') &&
      solution.includes('FOOD_TRUCK_CATERING_DESSERT_MENU_PATH') &&
      comparisonPage.includes('FOOD_TRUCK_CATERING_DESSERT_MENU_PATH'),
    'Resources, Playbook, solution, and comparison pages expose contextual guide links'
  );
  assert(
    quoteIntake.includes(
      "[FOOD_TRUCK_CATERING_DESSERT_MENU_PATH]: 'food-truck catering dessert package guide'"
    ) &&
      decisions.includes('Catering dessert guide produces a scope template, not an offer (`#730`)') &&
      smoke.includes('/resources/business-playbook/food-truck-catering-dessert-menu'),
    'quote source, durable decision, and smoke-test documentation cover the guide contract'
  );

  console.log('Food-truck catering dessert-menu guide validation passed.');
} finally {
  await vite.close();
}
