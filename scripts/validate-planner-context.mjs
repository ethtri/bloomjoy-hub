import fs from 'node:fs';
import { createServer } from 'vite';

const read = (path) =>
  fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');

const planner = read('src/pages/resources/BusinessPlaybookPlanner.tsx');
const contact = read('src/pages/Contact.tsx');
const analytics = read('src/lib/businessPlaybookAnalytics.ts');
const home = read('src/pages/Index.tsx');
const machines = read('src/pages/Products.tsx');
const commercial = read('src/pages/products/CommercialRobotic.tsx');
const mini = read('src/pages/products/Mini.tsx');
const micro = read('src/pages/products/Micro.tsx');
const decisions = read('Docs/DECISIONS.md');
const prerender = read('scripts/prerender-public-routes.mjs');
const seoRegression = read('scripts/seo-regression-check.mjs');

const vite = await createServer({
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
});

try {
  const quoteIntake = await vite.ssrLoadModule('/src/lib/quoteIntake.ts');
  const href = quoteIntake.buildPlannerQuoteHref({
    machineSignal: 'mini',
    intendedPath: 'events-catering',
    budgetBand: 'incomplete',
    openQuestions: ['landed-cost', 'setting', 'landed-cost'],
  });
  const url = new URL(href, 'https://www.bloomjoyusa.com');
  const allowedKeys = new Set([
    'type',
    'interest',
    'source',
    'planner_machine',
    'planner_path',
    'planner_budget',
    'planner_open',
  ]);
  const parsed = quoteIntake.getSafePlannerQuoteContext({
    sourcePage: url.searchParams.get('source'),
    machineSignal: url.searchParams.get('planner_machine'),
    intendedPath: url.searchParams.get('planner_path'),
    budgetBand: url.searchParams.get('planner_budget'),
    openQuestions: `${url.searchParams.get('planner_open')},private-note,12345`,
  });
  const wrongSource = quoteIntake.getSafePlannerQuoteContext({
    sourcePage: '/machines',
    machineSignal: 'mini',
  });
  const message = quoteIntake.buildStructuredQuoteMessage({
    organization: '',
    venueUse: 'Events and catering',
    serviceRegion: 'Service region supplied in form',
    timeline: 'Researching — no date yet',
    readiness: 'Building an internal plan or budget',
    additionalDetails: '',
    plannerContext: parsed,
  });

  const assertions = [
    ['planner quote is fixed to Commercial', url.pathname === '/contact' && url.searchParams.get('type') === 'quote' && url.searchParams.get('interest') === 'commercial'],
    ['planner quote uses only allowlisted categorical keys', [...url.searchParams.keys()].every((key) => allowedKeys.has(key))],
    ['planner quote preserves canonical source and categorical summary', url.searchParams.get('source') === '/resources/business-playbook/planner' && url.searchParams.get('planner_machine') === 'mini' && url.searchParams.get('planner_path') === 'events-catering' && url.searchParams.get('planner_budget') === 'incomplete'],
    ['open questions are deduplicated and categorical', url.searchParams.get('planner_open') === 'landed-cost,setting'],
    ['unknown planner values are discarded', parsed?.openQuestions.join(',') === 'landed-cost,setting' && wrongSource === null],
    ['structured lead message contains no exact planner financial input', message.includes('Planner summary (categorical; no exact financial inputs):') && !/\$|12345|private-note/.test(message)],
    ['home and machine listing expose the fit planner', home.includes('Find Your Machine Path') && home.includes('to={plannerPath}') && machines.includes('machine_fit_startup_budget_planner')],
    ['all machine details expose contextual planner links', [commercial, mini, micro].every((source) => source.includes('Check the machine-fit planner') && source.includes('to={plannerPath}'))],
    ['planner offers result-to-product and Commercial quote choices', planner.includes('planner_result_to_product') && planner.includes('planner_result_to_commercial_quote') && planner.includes('buildPlannerQuoteHref')],
    ['planner records bounded completion and result actions', ['complete_fit', 'result_to_product', 'result_to_quote'].every((action) => analytics.includes(`"${action}"`)) && analytics.includes('budget_band') && analytics.includes('open_question_band')],
    ['exact budget state never enters planner analytics', !/trackBusinessPlaybookPlannerInteraction\([\s\S]{0,500}budget\[/.test(planner)],
    ['contact defers and visibly confirms every planner signal', ['planner_machine', 'planner_path', 'planner_budget', 'planner_open'].every((key) => contact.includes(`queryReady ? searchParams.get('${key}') : null`)) && contact.includes('Planner summary received')],
    ['contact keeps non-Commercial signals separate from quote interest', contact.includes('The planner signal is context, not quote interest') && contact.includes('This form remains')],
    ['planner route module loads before hydration on direct visits', prerender.includes('[\n    "/resources/business-playbook/planner",\n    "src/pages/resources/BusinessPlaybookPlanner.tsx",\n  ]') && seoRegression.includes('"/resources/business-playbook/planner": "BusinessPlaybookPlanner-"')],
    ['repository decision records the planner privacy contract', decisions.includes('Machine-fit planner transfers categorical context only (`#623`)') && decisions.includes('exact financial inputs') && decisions.includes('interest=commercial')],
  ];

  const failed = assertions.filter(([, passed]) => !passed);
  if (failed.length > 0) {
    for (const [name] of failed) console.error(`FAIL ${name}`);
    process.exitCode = 1;
  } else {
    for (const [name] of assertions) console.log(`PASS ${name}`);
    console.log('Planner discovery and categorical quote-context validation passed.');
  }
} finally {
  await vite.close();
}
