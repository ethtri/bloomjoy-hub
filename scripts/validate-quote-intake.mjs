import fs from 'node:fs';

const read = (path) =>
  fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');

const contact = read('src/pages/Contact.tsx');
const app = read('src/App.tsx');
const quoteIntake = read('src/lib/quoteIntake.ts');
const leadSubmissions = read('src/lib/leadSubmissions.ts');
const intakeFunction = read('supabase/functions/lead-submission-intake/index.ts');
const footer = read('src/components/layout/Footer.tsx');
const home = read('src/pages/Index.tsx');

const assertions = [
  ['plain /contact defaults to general', contact.includes("? queryType : 'general'") || contact.includes("? queryType : \"general\"")],
  ['quote URL has focused Commercial heading', contact.includes('Tell us where the Commercial Machine needs to work.')],
  ['required fit fields render', ['venueUse', 'serviceRegion', 'timeline'].every((field) => contact.includes(field))],
  ['optional qualification fields render', ['organization', 'readiness'].every((field) => contact.includes(field))],
  ['source context is normalized and visible', contact.includes('getNormalizedInternalSourcePage') && contact.includes('Context received')],
  ['unknown machine query values are rejected', quoteIntake.includes('approvedMachineOptions.has(normalized)')],
  ['quote submission is fixed to Commercial', contact.includes("const submittedMachineInterest = isQuote ? MACHINE_NAMES.commercial : ''") && contact.includes('Mini and Micro stay on their payment-first product paths.')],
  ['safe Mini and Micro query context returns to product paths', contact.includes('Purchase path preserved') && contact.includes("? '/machines/mini'") && contact.includes("? '/machines/micro'")],
  ['query context is deferred as transitions until after hydration', contact.includes('const [queryReady, setQueryReady] = useState(false)') && contact.includes("queryReady ? searchParams.get('type') : null") && contact.includes('startTransition(() => setQueryReady(true))') && contact.includes('if (!queryReady) return;') && contact.includes('startTransition(() => {\n      setFormData')],
  ['the prerendered contact route avoids a lazy Suspense hydration race', app.includes('import Contact from "./pages/Contact";') && !app.includes('const Contact = lazyRoute')],
  ['mobile-food use is allowlisted and preselects only the approved venue option', quoteIntake.includes("'mobile-food': QUOTE_VENUE_OPTIONS[0]") && contact.includes('getSafeQuoteVenueUse(queryUse)')],
  ['quote data is stored as a structured bounded message', contact.includes('buildStructuredQuoteMessage') && intakeFunction.includes('sanitizeBoundedText(body?.message, 4000)')],
  ['retry reuses client submission id', contact.includes('submissionIdRef.current ?? crypto.randomUUID()') && leadSubmissions.includes('clientSubmissionId = crypto.randomUUID()')],
  ['server retains client and payload dedupe', intakeFunction.includes('.eq("client_submission_id", clientSubmissionId)') && intakeFunction.includes('server_dedupe_key')],
  ['recoverable error state preserves entries', contact.includes('Your other entries are still here') && contact.includes('errorSummaryRef')],
  ['success explains next step without an SLA', contact.includes('We may ask a few clarifying questions') && contact.includes('does not reserve inventory')],
  ['form funnel events contain controlled context only', ['lead_form_start', 'lead_form_submit', 'lead_form_error'].every((event) => contact.includes(`trackEvent('${event}'`)) && !/trackEvent\([^)]*formData\.(?:name|email|message|serviceRegion)/s.test(contact)],
  ['high-intent home and footer CTAs enter Commercial quote mode with a safe source', home.includes('/contact?type=quote&interest=commercial&source=%2F') && footer.includes('/contact?type=quote&interest=commercial&source=%2F')],
  ['accessible errors and focus recovery exist', contact.includes('aria-invalid=') && contact.includes('aria-describedby=') && contact.includes('tabIndex={-1}')],
];

const failed = assertions.filter(([, passed]) => !passed);
if (failed.length > 0) {
  for (const [name] of failed) console.error(`FAIL ${name}`);
  process.exit(1);
}

for (const [name] of assertions) console.log(`PASS ${name}`);
console.log('Quote intake validation passed.');

