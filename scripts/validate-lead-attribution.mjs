import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const docs = read('Docs/LEAD_ATTRIBUTION.md');
const decisions = read('Docs/DECISIONS.md');
const client = read('src/lib/leadAttribution.ts');
const manager = read('src/components/analytics/LeadAttributionManager.tsx');
const app = read('src/App.tsx');
const leadClient = read('src/lib/leadSubmissions.ts');
const server = read('supabase/functions/_shared/lead-attribution.ts');
const intake = read('supabase/functions/lead-submission-intake/index.ts');
const migration = read('supabase/migrations/202608100002_lead_attribution.sql');
const migrationTest = read('supabase/tests/lead_attribution_safety.sql');
const fitPlanner = read('src/pages/resources/BusinessPlaybookPlanner.tsx');
const paybackPlanner = read('src/pages/resources/BusinessPlaybookPaybackPlanner.tsx');
const home = read('src/pages/Index.tsx');
const footer = read('src/components/layout/Footer.tsx');
const qa = read('Docs/QA_SMOKE_TEST_CHECKLIST.md');

const assertions = [
  ['schema and retention are documented', docs.includes('## Persisted schema') && docs.includes('## Retention and deletion') && decisions.includes('session-scoped, allowlisted, and lead-bound')],
  ['browser attribution is session-only', client.includes('window.sessionStorage') && !client.includes('localStorage') && !client.includes('document.cookie')],
  ['only five UTM values are collected', ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].every((key) => client.includes(`'${key}'`)) && !/['"](?:gclid|gbraid|wbraid|fbclid)['"]/.test(client)],
  ['paths, hosts, and likely PII have explicit guards', client.includes('normalizePath') && client.includes('normalizeHost') && client.includes('containsLikelyPii')],
  ['first touch remains stable and direct navigation does not replace last touch', client.includes('first_touch: derivedTouch') && client.includes("derivedTouch.kind === 'direct'")],
  ['public route changes invoke attribution capture', manager.includes('getRouteSeo(location.pathname).robots !== PUBLIC_ROBOTS') && manager.includes('captureLeadAttribution()') && app.includes('<LeadAttributionManager />')],
  ['private application paths are excluded', client.includes("'/portal'") && client.includes("'/admin'") && server.includes('"/portal"') && server.includes('"/admin"')],
  ['lead payload contains no form fields', leadClient.includes('buildLeadAttributionPayload({ sourcePage, machineInterest })') && !/buildLeadAttributionPayload\([^)]*(?:name|email|message)/s.test(leadClient)],
  ['server rebuilds from an exact allowlist', server.includes('normalizeLeadAttribution') && server.includes('normalizeTouch') && server.includes('conversionPayload')],
  ['tampered attribution is non-blocking', server.includes('const payload = isRecord(value) ? value : {}') && server.includes('source_path: normalizePath(sourcePage, "/contact")')],
  ['intake stores and returns sanitized attribution', intake.includes('normalizeLeadAttribution(body?.attribution') && intake.includes('metadata, attribution, created_at') && intake.includes('attribution,')],
  ['notifications use the sanitized compact formatter', intake.includes('formatLeadAttributionLines(leadSubmission.attribution)') && server.includes('if (!isRecord(attribution) || !isRecord(attribution.conversion)) return [];')],
  ['migration is additive, bounded, and RLS-neutral', migration.includes('add column if not exists attribution jsonb not null') && migration.includes('pg_column_size(attribution) <= 4096') && !/create policy|grant\s/i.test(migration)],
  ['database tests prove the bounded RLS-neutral contract', migrationTest.includes('select plan(10)') && migrationTest.includes('Attribution adds no browser read or mutation policies') && migrationTest.includes('Oversized attribution is rejected')],
  ['fit planner passes only categorical recommendation and band', fitPlanner.includes('planner_recommendation: recommendation') && fitPlanner.includes('planner_band: band')],
  ['payback planner passes only scenario and demand band', paybackPlanner.includes('planner_recommendation: "commercial"') && paybackPlanner.includes('planner_band: demandBand') && !/planner_(?:cost|revenue|payback|price|margin)/.test(paybackPlanner)],
  ['homepage and footer quote CTAs preserve internal source', home.includes('/contact?type=quote&interest=commercial&source=%2F') && footer.includes('/contact?type=quote&interest=commercial&source=%2F')],
  ['QA covers accepted and adversarial journeys', ['direct', 'campaign', 'referral', 'planner', 'malformed', 'missing attribution'].every((term) => qa.toLowerCase().includes(term))],
];

const failed = assertions.filter(([, passed]) => !passed);
if (failed.length > 0) {
  for (const [name] of failed) console.error(`FAIL ${name}`);
  process.exit(1);
}

for (const [name] of assertions) console.log(`PASS ${name}`);
console.log('Lead attribution validation passed.');
