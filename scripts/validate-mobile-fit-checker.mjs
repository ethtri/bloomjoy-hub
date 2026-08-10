import fs from 'node:fs';
import { createServer } from 'vite';

const read = (path) =>
  fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');

const app = read('src/App.tsx');
const page = read('src/pages/resources/MobileSetupFitChecker.tsx');
const contact = read('src/pages/Contact.tsx');
const analytics = read('src/lib/businessPlaybookAnalytics.ts');
const analyticsCore = read('src/lib/analytics.ts');
const seo = read('src/lib/seoRoutes.ts');
const seoRegression = read('scripts/seo-regression-check.mjs');
const prerender = read('scripts/prerender-public-routes.mjs');
const mobileEntry = read('src/components/resources/MobileOperatorEntry.tsx');
const solution = read('src/pages/solutions/FoodTrucks.tsx');
const setupGuide = read('src/pages/resources/MobileFoodSetupGuide.tsx');
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
  const checker = await vite.ssrLoadModule('/src/data/mobileSetupFitChecker.ts');
  const quoteIntake = await vite.ssrLoadModule('/src/lib/quoteIntake.ts');

  const likelyMini = checker.evaluateMobileSetupFit({
    placement: 'adjacent',
    machine: 'mini',
    space: 'model-fit-reviewed',
    power: 'complete-load-reviewed',
    staffing: 'trained-manual-staff',
    service: 'flexible-pilot',
    transport: 'model-specific-review-complete',
    localReview: 'confirmed',
  });
  const needsConfirmation = checker.evaluateMobileSetupFit({
    placement: 'installed',
    machine: 'commercial',
    space: 'measured-needs-match',
    power: 'load-listed-needs-review',
    staffing: 'staff-can-be-assigned',
    service: 'target-needs-review',
    transport: 'plan-needs-review',
    localReview: 'in-progress',
  });
  const unsupported = checker.evaluateMobileSetupFit({
    placement: 'installed',
    machine: 'mini',
    space: 'known-no-fit',
    power: 'generator-approval-required',
    staffing: 'automatic-stick-required',
    service: 'guaranteed-rate-required',
    transport: 'improvised',
    localReview: 'bloomjoy-approval-required',
  });
  const micro = checker.evaluateMobileSetupFit({
    placement: 'adjacent',
    machine: 'micro',
    space: 'model-fit-reviewed',
    power: 'complete-load-reviewed',
    staffing: 'trained-manual-staff',
    service: 'flexible-pilot',
    transport: 'model-specific-review-complete',
    localReview: 'confirmed',
  });
  const incomplete = checker.evaluateMobileSetupFit({ placement: 'adjacent' });
  const href = quoteIntake.buildMobileFitQuoteHref({
    resultBand: needsConfirmation.band,
    machineSignal: needsConfirmation.machineSignal,
    placement: needsConfirmation.placement,
    openQuestions: [...needsConfirmation.unresolvedQuestions, 'power-source'],
  });
  const url = new URL(href, 'https://www.bloomjoyusa.com');
  const allowedKeys = new Set([
    'type',
    'interest',
    'source',
    'use',
    'mobile_fit',
    'mobile_machine',
    'mobile_placement',
    'mobile_open',
  ]);
  const parsed = quoteIntake.getSafeMobileFitQuoteContext({
    sourcePage: url.searchParams.get('source'),
    resultBand: url.searchParams.get('mobile_fit'),
    machineSignal: url.searchParams.get('mobile_machine'),
    placement: url.searchParams.get('mobile_placement'),
    openQuestions: `${url.searchParams.get('mobile_open')},private-note,12345`,
  });
  const wrongSource = quoteIntake.getSafeMobileFitQuoteContext({
    sourcePage: '/machines',
    resultBand: 'likely-fit',
    machineSignal: 'mini',
    placement: 'adjacent',
  });
  const message = quoteIntake.buildStructuredQuoteMessage({
    organization: '',
    venueUse: 'Mobile food facility or food truck',
    serviceRegion: 'Region supplied in form',
    timeline: 'Researching — no date yet',
    readiness: 'Building an internal plan or budget',
    additionalDetails: '',
    mobileFitContext: parsed,
  });

  assert(
    checker.mobileFitQuestions.length === 8 && incomplete.band === 'incomplete' && incomplete.missingQuestions.length === 7,
    'missing inputs stay incomplete without a precise fit result'
  );
  assert(
    likelyMini.band === 'likely-fit' && likelyMini.machineSignal === 'mini' && likelyMini.unresolvedQuestions.length === 0,
    'fully reviewed Mini fixture returns likely fit to explore'
  );
  assert(
    needsConfirmation.band === 'needs-confirmation' && needsConfirmation.unresolvedQuestions.includes('power-source') && needsConfirmation.unresolvedQuestions.includes('local-review'),
    'open setup fixture names the needs-confirmation categories'
  );
  assert(
    unsupported.band === 'not-supported' && unsupported.machineSignal === 'commercial' && unsupported.drivers.every((driver) => driver.tone === 'stop'),
    'contradictory and unsupported requirements fail closed'
  );
  assert(
    micro.band === 'needs-confirmation' && micro.unresolvedQuestions.includes('micro-specs'),
    'Micro never receives unsupported mobile-spec precision'
  );
  assert(
    url.pathname === '/contact' && url.searchParams.get('type') === 'quote' && url.searchParams.get('interest') === 'commercial' && url.searchParams.get('use') === 'mobile-food',
    'fit-checker quote handoff is fixed to Commercial mobile-use context'
  );
  assert(
    [...url.searchParams.keys()].every((key) => allowedKeys.has(key)) && !/\$|\d{3,}/.test(url.search),
    'quote URL contains only allowlisted categorical keys and no exact values'
  );
  assert(
    parsed && parsed.openQuestions.length === new Set(parsed.openQuestions).size && wrongSource === null,
    'unknown values are discarded and source spoofing fails closed'
  );
  assert(
    message.includes('Mobile setup fit-checker summary (categorical; no free text or exact financial inputs):') && !/private-note|12345|\$/.test(message),
    'structured lead summary contains no arbitrary or exact checker inputs'
  );
  assert(
    app.includes('path="/resources/business-playbook/mobile-setup-fit-checker"') && seo.includes('structuredDataKind: "mobile-fit-checker"') && seoRegression.includes('EXPECTED_PUBLIC_ROUTE_COUNT = 28'),
    'canonical route, SEO metadata, schema, and sitemap count are registered'
  );
  assert(
    prerender.includes('"src/pages/resources/MobileSetupFitChecker.tsx"') && seoRegression.includes('"MobileSetupFitChecker-"'),
    'direct-load hydration preloads the checker route module'
  );
  assert(
    ['view_mobile_setup_fit_checker', 'update_mobile_setup_fit_checker'].every((name) => analyticsCore.includes(name)) && ['"start"', '"complete"', '"result_to_product"', '"result_to_quote"'].every((action) => analytics.includes(action)) && !/trackMobileSetupFitCheckerInteraction\([\s\S]{0,500}(dimension|watt|revenue|margin|payback)/.test(page),
    'analytics events use bounded result metadata without exact setup or financial values'
  );
  assert(
    page.includes('aria-live="polite"') && page.includes('aria-pressed={selected}') && page.includes('window.print()') && page.includes('navigator.clipboard.writeText') && page.includes('firstQuestionRef.current?.focus()') && page.includes('motion-reduce:transition-none'),
    'checker includes keyboard, live-result, focus, reduced-motion, print, copy, and reset support'
  );
  assert(
    page.includes("evaluation.band !== 'not-supported'") && page.includes('MOBILE_FIT_DECISION_BOUNDARY') && page.includes('Review stop conditions') && page.includes('Unresolved checks') && page.includes('mobileFitOpenQuestionLabels[key]'),
    'results expose unresolved checks while unsupported results suppress quote handoff and retain decision boundaries'
  );
  assert(
    contact.includes("searchParams.get('mobile_fit')") && contact.includes("searchParams.get('mobile_open')") && contact.includes('Mobile setup fit-checker summary received') && contact.includes('This form') && contact.includes('Commercial Machine'),
    'Contact visibly confirms allowlisted checker context and Commercial-only policy'
  );
  assert(
    [mobileEntry, solution, setupGuide].every((source) => source.includes('MOBILE_SETUP_FIT_CHECKER_PATH')),
    'Resources, solution, and setup guide expose the fit checker'
  );
  assert(
    decisions.includes('Mobile setup fit checker uses transparent categorical rules (`#725`)') && smoke.includes('/resources/business-playbook/mobile-setup-fit-checker'),
    'decision and smoke-test documentation cover the checker contract'
  );

  console.log('Mobile setup fit-checker decision and integration validation passed.');
} finally {
  await vite.close();
}
