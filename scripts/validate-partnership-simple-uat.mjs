import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const app = process.env.PARTNERSHIP_UAT_APP_URL || 'http://127.0.0.1:8093';
assert(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(app), 'Synthetic localhost only');
const engine = process.env.PARTNERSHIP_UAT_BROWSER || 'chromium';
assert(['chromium', 'webkit'].includes(engine));
const correctionMode = process.argv.includes('--terms-correction');
const output = `output/partnership-simple-qa/${correctionMode ? 'terms-correction/' : ''}${engine}`;
await mkdir(output, { recursive: true });
const ids = { merlin: '11111111-aaaa-4111-8111-aaaaaaaaaaaa', bubble: '22222222-bbbb-4222-8222-bbbbbbbbbbbb',
  peppa: '33333333-cccc-4333-8333-cccccccccccc', la: '44444444-dddd-4444-8444-dddddddddddd',
  provisional: '55555555-eeee-4555-8555-eeeeeeeeeeee', user: '66666666-ffff-4666-8666-ffffffffffff' };
const sourceIds = { peppa: '1777281426074167988377962', la: '1785123901474964787735686' };
const timestamp = '2026-10-01T00:00:00Z';
const agreement = (id, name) => ({ id, name, partnership_type: 'revenue_share', reporting_week_end_day: 0,
  timezone: 'America/Los_Angeles', reporting_frequency: 'weekly_and_monthly', monthly_report_due_days: 10,
  effective_start_date: '2026-01-01', effective_end_date: null, status: 'active',
  machine_ownership_model: 'unknown', consumer_pricing_authority: 'unknown', created_at: timestamp, updated_at: timestamp });
const rule = (id, partnership, name, end, fee) => ({ id, partnership_id: partnership, partnership_name: name,
  calculation_model: 'net_split', split_base: 'net_sales', fee_amount_cents: fee, fee_basis: fee ? 'per_stick' : 'none',
  fee_label: 'Stick cost deduction', cost_amount_cents: 0, cost_basis: 'none', cost_label: 'Costs',
  additional_deductions_notes: 'Existing reviewed deductions', deduction_timing: 'before_split',
  gross_to_net_method: 'machine_tax_plus_configured_fees', fever_share_basis_points: 3000,
  partner_share_basis_points: 0, bloomjoy_share_basis_points: 7000, effective_start_date: '2026-01-01',
  effective_end_date: end, status: 'active', notes: null, created_at: timestamp, updated_at: timestamp });
const machine = (id, label, source = null) => ({ id, machine_label: label, machine_type: 'commercial',
  sunze_machine_id: source, status: 'active', account_name: 'Synthetic company', location_name: 'Legacy venue' });
const source = (id, sourceId, name) => ({ sourceKey: `Sunze:${sourceId}`, platform: 'Sunze', providerAccountId: null,
  sourceId, sourceName: name, reportingMachineId: id, machineName: name, archivedMapping: false, mappingConflict: false });
const createState = () => ({ calls: [], errors: [], unexpected: [], stale: false, pending: new Set(), sourcesFail: false,
  setup: { partners: [], partnerships: [agreement(ids.merlin, 'Merlin'), agreement(ids.bubble, 'Bubble Planet')],
    machines: [machine(ids.peppa, 'Peppa Pig', sourceIds.peppa), machine(ids.la, 'Bubble Planet LA', sourceIds.la),
      machine(ids.provisional, 'Bubble Planet LA provisional')],
    assignments: [{ id: '77777777-aaaa-4777-8777-aaaaaaaaaaaa', machine_id: ids.peppa, machine_label: 'Peppa Pig',
      partnership_id: ids.merlin, partnership_name: 'Merlin', assignment_role: 'primary_reporting',
      effective_start_date: '2026-06-16', effective_end_date: null, status: 'active', notes: null }],
    parties: [ids.merlin, ids.bubble].map((id, index) => ({ id: `party-${index}`, partnership_id: id,
      partnership_name: index ? 'Bubble Planet' : 'Merlin', partner_id: `partner-${index}`,
      partner_name: index ? 'Bubble Planet' : 'Merlin', partner_legal_name: null, party_role: 'revenue_share_recipient',
      share_basis_points: 3000, is_report_recipient: true, created_at: timestamp, updated_at: timestamp })),
    financialRules: [rule('88888888-aaaa-4888-8888-aaaaaaaaaaaa', ids.merlin, 'Merlin', '2026-08-07', 0),
      rule('99999999-bbbb-4999-8999-bbbbbbbbbbbb', ids.bubble, 'Bubble Planet', null, 40)], taxRates: [], warnings: [] },
  sources: [source(ids.peppa, sourceIds.peppa, 'Peppa Pig'), source(ids.la, sourceIds.la, 'Bubble Planet LA')] });
const user = { id: ids.user, email: 'synthetic.qa@example.test', aud: 'authenticated', role: 'authenticated',
  email_confirmed_at: timestamp, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {} };
const session = { user, access_token: 'synthetic-only-token', refresh_token: 'synthetic-only-refresh',
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 };
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const json = (body, status = 200) => ({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
const check = (name, condition) => { assert(condition, name); results.push(name); console.log(`PASS ${name}`); };
const results = [];
async function install(context, state) {
  await context.addInitScript(({ session }) => localStorage.setItem('sb-example-auth-token', JSON.stringify(session)), { session });
  await context.route('**/auth/v1/**', route => route.fulfill(json(route.request().url().includes('/user') ? user : session)));
  await context.route('**/rest/v1/**', async route => {
    const request = route.request(), url = new URL(request.url());
    assert.equal(url.origin, 'https://example.supabase.co', 'Synthetic API provenance');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    if (!url.pathname.includes('/rpc/')) return route.fulfill(json([]));
    const name = url.pathname.split('/').pop(), body = request.postDataJSON();
    state.calls.push({ name, body });
    if (name === 'get_my_admin_access_context') return route.fulfill(json({ isSuperAdmin: !state.scoped, isScopedAdmin: Boolean(state.scoped),
      canAccessAdmin: true, allowedSurfaces: state.scoped ? ['partnerships'] : ['*'], scopedMachineIds: state.scoped ? [ids.peppa, ids.la] : [] }));
    if (name === 'get_my_plus_access') return route.fulfill(json({ has_plus_access: false, source: 'none', membership_status: 'none' }));
    if (name === 'get_my_portal_access_context') return route.fulfill(json({ access_tier: 'training', is_admin: true,
      is_training_operator: true, capabilities: [], effective_presets: ['super_admin'] }));
    if (name === 'get_my_reporting_access_context') return route.fulfill(json({ has_reporting_access: true,
      can_manage_reporting: true, accessible_machine_count: 3 }));
    if (name === 'resolve_my_technician_entitlements') return route.fulfill(json({ resolvedGrantCount: 0 }));
    if (['resolve_my_scoped_admin_invites', 'get_my_time_report_access', 'get_labor_analytics_access',
      'get_my_email_alert_preferences', 'get_refund_request_access', 'get_refund_analytics_access'].includes(name)) {
      return route.fulfill(json({}));
    }
    if (name === 'get_my_operator_timekeeping_context') return route.fulfill(json({ accounts: [], assignedMachines: [], grants: [] }));
    if (name === 'admin_get_partnership_reporting_setup') return route.fulfill(json(state.setup));
    if (name === 'admin_get_machine_source_inventory') return route.fulfill(state.sourcesFail
      ? json({ message: 'Synthetic source outage' }, 500) : json({ sources: state.sources, count: state.sources.length }));
    if (name === 'admin_upsert_reporting_partnership') {
      const current = state.setup.partnerships.find(item => item.id === body.p_partnership_id);
      Object.assign(current, { effective_end_date: body.p_effective_end_date, effective_start_date: body.p_effective_start_date });
      return route.fulfill(json(current));
    }
    if (name === 'admin_correct_partnership_terms') {
      if (state.denied) return route.fulfill(json({ message: 'Super-admin permission required', code: '42501' }, 403));
      if (state.stale) return route.fulfill(json({ message: 'Terms changed; reload before saving', code: '40001' }, 409));
      const current = state.setup.financialRules.find(item => item.id === body.p_rule_id);
      const previous = state.setup.financialRules.find(item => item.id === body.p_previous_rule_id);
      assert.deepEqual(body.p_expected_rule, Object.fromEntries(Object.keys(body.p_expected_rule).map(key => [key, current[key]])), 'Exact current snapshot');
      assert.deepEqual(body.p_expected_previous_rule, Object.fromEntries(Object.keys(body.p_expected_previous_rule).map(key => [key, previous[key]])), 'Exact previous snapshot');
      previous.effective_end_date = '2026-08-31';
      Object.assign(current, { effective_start_date: body.p_effective_from, calculation_model: 'post_tax_refunds_only',
        split_base: 'net_sales', fee_amount_cents: 0, fee_basis: 'none', cost_amount_cents: 0, cost_basis: 'none',
        fever_share_basis_points: body.p_primary_share, partner_share_basis_points: body.p_secondary_share,
        bloomjoy_share_basis_points: body.p_bloomjoy_share });
      return route.fulfill(json(current));
    }
    if (name === 'admin_change_partnership_split') {
      if (state.stale) return route.fulfill(json({ message: 'Terms changed; reload before saving', code: '40001' }, 409));
      const old = state.setup.financialRules.find(item => item.id === body.p_expected_rule_id);
      const next = { ...old, id: `aaaaaaaa-cccc-4aaa-8aaa-${body.p_partnership_id.slice(-12)}`, effective_start_date: body.p_effective_from,
        effective_end_date: null, fever_share_basis_points: body.p_primary_share,
        partner_share_basis_points: body.p_secondary_share, bloomjoy_share_basis_points: body.p_bloomjoy_share };
      if (!old.effective_end_date) old.effective_end_date = '2026-09-30';
      state.setup.financialRules.push(next);
      return route.fulfill(json(next));
    }
    if (name === 'admin_correct_partnership_rule_end_date') {
      const current = state.setup.financialRules.find(item => item.id === body.p_rule_id);
      current.effective_end_date = body.p_end_date;
      return route.fulfill(json(current));
    }
    if (name === 'admin_upsert_reporting_machine_assignment') {
      const next = { id: 'bbbbbbbb-dddd-4bbb-8bbb-dddddddddddd', machine_id: body.p_machine_id,
        machine_label: 'Bubble Planet LA', partnership_id: body.p_partnership_id, partnership_name: 'Bubble Planet',
        effective_start_date: body.p_effective_start_date, effective_end_date: body.p_effective_end_date,
        assignment_role: body.p_assignment_role, status: body.p_status };
      state.setup.assignments.push(next); return route.fulfill(json(next));
    }
    state.unexpected.push(name);
    return route.fulfill(json({ message: `Unexpected synthetic RPC ${name}` }, 500));
  });
}
async function open(page, state, partnership, step) {
  const deadline = Date.now() + 5000;
  do { await delay(100); } while (state.pending.size && Date.now() < deadline);
  assert.equal(state.pending.size, 0, 'Drain reads before navigation');
  await page.goto(`${app}/admin/partnerships?partnershipId=${partnership}&step=${step}`);
  await page.getByRole('heading', { name: 'Partnerships', exact: true, level: 1 }).waitFor();
  await page.locator(step === 'details' ? '#partnership-start' : step === 'terms' ? '[aria-label="Bloomjoy payout share percentage"]' : '#machine-assignment-search').waitFor();
}
async function runTermsCorrection() {
  const state = createState();
  state.setup.financialRules = [ids.bubble, ids.merlin].flatMap((id, index) => {
    const name = index ? 'Merlin' : 'Bubble Planet';
    const previous = rule(`old-${id}`, id, name, '2026-09-30', index ? 0 : 40);
    previous.fever_share_basis_points = index ? 3000 : 6000;
    previous.bloomjoy_share_basis_points = index ? 7000 : 4000;
    const current = { ...previous, id: `new-${id}`, effective_start_date: '2026-10-01', effective_end_date: null,
      fever_share_basis_points: 7000, bloomjoy_share_basis_points: 3000 };
    return [previous, current];
  });
  const beforeAssignments = JSON.stringify(state.setup.assignments), beforeLifecycle = JSON.stringify(state.setup.partnerships);
  const context = await browser.newContext(engine === 'webkit' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
  await install(context, state); const page = await context.newPage();
  page.on('pageerror', error => state.errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/rest/v1/')) state.pending.add(request); });
  page.on('requestfinished', request => state.pending.delete(request));
  page.on('requestfailed', request => { state.pending.delete(request); state.errors.push(request.failure()?.errorText); });
  for (const [id, name] of [[ids.bubble, 'Bubble Planet'], [ids.merlin, 'Merlin']]) {
    await open(page, state, id, 'terms');
    await page.getByRole('button', { name: 'Correct terms', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Correct partnership terms' });
    await dialog.getByLabel(`${name} payout share percentage`).fill('60');
    await dialog.getByLabel('Bloomjoy payout share percentage').fill('40');
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    check(`${name} canceled correction restores actual read-only allocation without writes`, Number(await page.getByLabel(`${name} payout share percentage`).inputValue()) === 70 && Number(await page.getByLabel('Bloomjoy payout share percentage').inputValue()) === 30 && !state.calls.some(c => c.name === 'admin_correct_partnership_terms' && c.body.p_rule_id === `new-${id}`));
    for (const dismiss of ['Escape', 'Close']) {
      await page.getByRole('button', { name: 'Correct terms', exact: true }).click();
      await dialog.getByLabel(`${name} payout share percentage`).fill('60');
      await dialog.getByLabel('Bloomjoy payout share percentage').fill('40');
      if (dismiss === 'Escape') await dialog.press('Escape'); else await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      check(`${name} ${dismiss} discards correction draft with no writer`, Number(await page.getByLabel(`${name} payout share percentage`).inputValue()) === 70 && !state.calls.some(c => c.name === 'admin_correct_partnership_terms' && c.body.p_rule_id === `new-${id}`));
    }
    await page.getByRole('button', { name: 'Correct terms', exact: true }).click();
    check(`${name} correction has explicit tax/refunds-only model`, await dialog.locator('#terms-model').inputValue() === 'post_tax_refunds_only'
      && (await dialog.innerText()).includes('No stick deduction, processing fee or other configured cost'));
    check(`${name} reason required before review`, await dialog.getByRole('button', { name: 'Review terms correction' }).isDisabled());
    await dialog.locator('#terms-effective-from').fill('2026-01-01');
    await dialog.locator('#terms-correction-reason').fill('Owner confirms September 1 tax/refunds-only 70/30 terms');
    check(`${name} overlapping predecessor start rejected`, await dialog.getByRole('button', { name: 'Review terms correction' }).isDisabled());
    await dialog.locator('#terms-effective-from').fill('2026-09-01');
    await dialog.getByLabel(`${name} payout share percentage`).fill('70');
    await dialog.getByLabel('Bloomjoy payout share percentage').fill('30');
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await delay(250); // Complete the existing dialog open/resize animation before measuring.
      await page.screenshot({ path: `${output}/${name.replaceAll(' ', '-')}-${width}-controls.png` });
      const bounds = await dialog.locator('#terms-effective-from').boundingBox();
      check(`${name} date fits ${width} with readable full date`, bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.height >= 44);
      check(`${name} dialog no horizontal overflow ${width}`, await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await page.screenshot({ path: `${output}/${name.replaceAll(' ', '-')}-${width}-controls.png` });
    }
    const writesBefore = state.calls.filter(c => c.name === 'admin_correct_partnership_terms').length;
    await dialog.getByRole('button', { name: 'Review terms correction' }).click();
    const text = await dialog.innerText();
    check(`${name} preview states Sep1 zero extras and exact named 70/30`, /2026-09-01/.test(text) && /All additional deductions: \$0/.test(text)
      && text.includes(`${name} 70.00%`) && text.includes('Bloomjoy 30.00%'));
    check(`${name} preview replaces breakpoint and preserves issued history`, text.includes('replaced, not duplicated') && text.includes('Issued reports and payouts stay as recorded') && text.includes('assignment dates stay unchanged'));
    check(`${name} review performs no writer`, state.calls.filter(c => c.name === 'admin_correct_partnership_terms').length === writesBefore);
    await page.screenshot({ path: `${output}/${name.replaceAll(' ', '-')}-390-review.png` });
    const original = JSON.stringify(state.setup.financialRules);
    state.stale = true; await dialog.getByRole('button', { name: 'Confirm terms correction' }).click();
    await page.getByText('Terms changed; reload before saving', { exact: true }).waitFor();
    check(`${name} stale save preserves all versions and review`, JSON.stringify(state.setup.financialRules) === original && await dialog.isVisible());
    state.stale = false; state.denied = true; await dialog.getByRole('button', { name: 'Confirm terms correction' }).click();
    await page.getByText('Super-admin permission required', { exact: true }).waitFor();
    check(`${name} permission rejection retains review and unchanged versions`, JSON.stringify(state.setup.financialRules) === original && await dialog.isVisible());
    state.denied = false; await dialog.getByRole('button', { name: 'Confirm terms correction' }).click();
    await page.getByText('Partnership terms corrected. Review affected draft reports.', { exact: true }).waitFor();
    const call = state.calls.filter(c => c.name === 'admin_correct_partnership_terms').at(-1).body;
    check(`${name} exact snapshot/date/shares atomic contract`, call.p_rule_id === `new-${id}` && call.p_previous_rule_id === `old-${id}`
      && Object.keys(call.p_expected_rule).length === 19 && Object.keys(call.p_expected_previous_rule).length === 19
      && call.p_effective_from === '2026-09-01' && call.p_primary_share === 7000 && call.p_secondary_share === 0 && call.p_bloomjoy_share === 3000);
    const versions = state.setup.financialRules.filter(r => r.partnership_id === id);
    check(`${name} synthetic receipt Aug31 old, Sep1/Oct1 same new with no duplicate`, versions.length === 2
      && versions[0].effective_end_date === '2026-08-31' && versions[0].fee_amount_cents === (id === ids.bubble ? 40 : 0)
      && versions[0].fever_share_basis_points === (id === ids.bubble ? 6000 : 3000)
      && versions[1].effective_start_date === '2026-09-01' && versions[1].fee_amount_cents === 0 && versions[1].cost_amount_cents === 0);
  }
  check('Financial correction leaves lifecycle and assignment dates byte-identical', beforeAssignments === JSON.stringify(state.setup.assignments) && beforeLifecycle === JSON.stringify(state.setup.partnerships));
  check('Only reviewed correction writer used, no legacy upsert/new split/assignment writes', !state.calls.some(c => ['admin_upsert_reporting_partnership','admin_upsert_reporting_partnership_financial_rule','admin_change_partnership_split','admin_upsert_reporting_machine_assignment'].includes(c.name)));
  check('Strict RPC provenance and browser/request failure ledger preserved', !state.errors.length && !state.unexpected.length);
  await writeFile(`${output}/results.json`, JSON.stringify({ candidate: process.env.TESTED_SHA, engine, physicalIPhoneTested: false, financialReceipts: 'synthetic; actual calculations verified by SQL release QA', assertions: results }, null, 2));
}
const browser = await (engine === 'webkit' ? webkit : chromium).launch();
try {
  if (correctionMode) { await runTermsCorrection(); } else {
  const state = createState(), context = await browser.newContext(engine === 'webkit'
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
  await install(context, state);
  const page = await context.newPage();
  page.on('pageerror', error => state.errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/rest/v1/')) state.pending.add(request); });
  page.on('requestfinished', request => state.pending.delete(request));
  page.on('requestfailed', request => { state.pending.delete(request); state.errors.push(request.failure()?.errorText); });
  await open(page, state, ids.bubble, 'details');
  check('NULL end renders Ongoing and No end date checked', await page.getByText('Ongoing', { exact: true }).isVisible()
    && await page.getByRole('checkbox', { name: 'No end date' }).isChecked());
  await page.getByRole('checkbox', { name: 'No end date' }).uncheck();
  check('Disabling ongoing reveals blank date without inventing today', await page.locator('#partnership-end').inputValue() === '');
  await page.locator('#partnership-end').fill('2026-12-31');
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await page.locator('#partnership-end').boundingBox();
    check(`Date control fits ${width}`, bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    check(`No horizontal overflow ${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    check(`Clear end date touch target ${width}`, (await page.getByRole('button', { name: 'Clear end date' }).boundingBox()).height >= 44);
    await page.locator('#partnership-end').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/${width}-date.png` });
  }
  await page.getByRole('button', { name: 'Save Details', exact: true }).click();
  await page.getByText('Partnership updated.', { exact: true }).waitFor();
  check('Entered end date persists exactly', state.calls.filter(call => call.name === 'admin_upsert_reporting_partnership').at(-1).body.p_effective_end_date === '2026-12-31');
  await open(page, state, ids.bubble, 'details');
  await page.getByRole('button', { name: 'Clear end date' }).click();
  await page.getByRole('button', { name: 'Save Details', exact: true }).click();
  await page.getByText('Partnership updated.', { exact: true }).waitFor();
  check('Cleared end date persists NULL', state.calls.filter(call => call.name === 'admin_upsert_reporting_partnership').at(-1).body.p_effective_end_date === null);
  check('Lifecycle saves never write financial terms', !state.calls.some(call => call.name === 'admin_upsert_reporting_financial_rule' || call.name === 'admin_change_partnership_split'));
  await open(page, state, ids.bubble, 'terms');
  check('Existing financial terms are read-only until Change split', await page.getByLabel('Bloomjoy payout share percentage').isDisabled());
  await page.getByRole('button', { name: 'Change split', exact: true }).first().click();
  check('Existing $0.40 deduction remains visible and read-only during split',
    await page.locator('#fee-amount').inputValue() === '0.40' && await page.locator('#fee-amount').isDisabled());
  await page.locator('#split-effective-from').fill('2026-10-01');
  await page.getByLabel('Bubble Planet payout share percentage').fill('70');
  await page.getByLabel('Bloomjoy payout share percentage').fill('30');
  await page.getByRole('button', { name: 'Review split change', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review split change' });
  check('Review precedes any financial write', !state.calls.some(call => call.name === 'admin_change_partnership_split'));
  const reviewText = (await dialog.innerText()).replace(/\s+/g, ' ');
  check('Review states partner and Bloomjoy percentages and NET', /Bubble Planet 70(?:\.00)?%.*Bloomjoy 30(?:\.00)?%.*net/i.test(reviewText));
  check('Review explains future-machine scope and preserved deductions', /future assigned machines/.test(await dialog.innerText()) && /deductions are preserved/.test(await dialog.innerText()));
  check('Review quantifies copied $0.40 per-stick deduction', /\$0\.40/.test(reviewText) && /per.*stick/i.test(reviewText));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${output}/390-split-review.png` });
  const oldRules = structuredClone(state.setup.financialRules);
  state.stale = true; await dialog.getByRole('button', { name: 'Confirm split change' }).click();
  await page.getByText('Terms changed; reload before saving', { exact: true }).waitFor();
  check('Stale save leaves terms unchanged and review open', JSON.stringify(state.setup.financialRules) === JSON.stringify(oldRules) && await dialog.isVisible());
  state.stale = false; await dialog.getByRole('button', { name: 'Confirm split change' }).click();
  await dialog.waitFor({ state: 'hidden' });
  const saved = state.calls.filter(call => call.name === 'admin_change_partnership_split').at(-1).body;
  check('One atomic contract carries exact dated shares and expected original terms', saved.p_effective_from === '2026-10-01'
    && saved.p_primary_share === 7000 && saved.p_secondary_share === 0 && saved.p_bloomjoy_share === 3000
    && saved.p_expected_rule.fee_amount_cents === 40 && saved.p_expected_rule.split_base === 'net_sales'
    && saved.p_expected_rule.updated_at === timestamp);
  check('Split uses no legacy rule-upsert writer', !state.calls.some(call => call.name === 'admin_upsert_reporting_financial_rule'));
  check('Bubble original terms close Sep30, October version starts Oct1 with unchanged costs',
    state.setup.financialRules.find(item => item.id === saved.p_expected_rule_id).effective_end_date === '2026-09-30'
    && state.setup.financialRules.at(-1).effective_start_date === '2026-10-01'
    && state.setup.financialRules.at(-1).fee_amount_cents === 40);
  check('Unrelated ended Merlin version remains byte-identical', JSON.stringify(state.setup.financialRules[0]) === JSON.stringify(oldRules[0]));
  await open(page, state, ids.merlin, 'terms');
  await page.locator('summary').filter({ hasText: /^History/ }).click();
  await page.getByRole('button', { name: 'Correct end date', exact: true }).click();
  const correction = page.getByRole('dialog', { name: 'Correct historical end date' });
  check('Historical correction shows original Aug7 end and requires reason',
    await correction.locator('#rule-correction-end').inputValue() === '2026-08-07'
    && await correction.getByRole('button', { name: 'Review end-date correction' }).isDisabled());
  await correction.locator('#rule-correction-end').fill('2026-09-30');
  await correction.locator('#rule-correction-reason').fill('Owner confirmed ongoing 30/70 agreement through September');
  await correction.getByRole('button', { name: 'Review end-date correction' }).click();
  check('Review makes exact Aug7 to Sep30 correction clear without writing',
    /2026-08-07.*2026-09-30/.test((await correction.innerText()).replace(/\s+/g, ' '))
    && !state.calls.some(call => call.name === 'admin_correct_partnership_rule_end_date'));
  await page.screenshot({ path: `${output}/390-history-correction.png` });
  await correction.getByRole('button', { name: 'Confirm end-date correction' }).click();
  await correction.waitFor({ state: 'hidden' });
  const correctedCall = state.calls.find(call => call.name === 'admin_correct_partnership_rule_end_date').body;
  check('Merlin historical correction uses exact original snapshot and date-only writer',
    correctedCall.p_rule_id === oldRules[0].id && correctedCall.p_end_date === '2026-09-30'
    && correctedCall.p_expected_rule.effective_end_date === '2026-08-07'
    && correctedCall.p_expected_rule.fever_share_basis_points === 3000
    && correctedCall.p_expected_rule.bloomjoy_share_basis_points === 7000);
  check('Only Merlin original end date changes in the synthetic UI receipt',
    JSON.stringify(state.setup.financialRules[0]) === JSON.stringify({ ...oldRules[0], effective_end_date: '2026-09-30' }));
  await page.getByRole('button', { name: 'Change split', exact: true }).click();
  await page.locator('#split-effective-from').fill('2026-10-01');
  await page.getByLabel('Merlin payout share percentage').fill('70');
  await page.getByLabel('Bloomjoy payout share percentage').fill('30');
  await page.getByRole('button', { name: 'Review split change', exact: true }).click();
  const merlinReview = page.getByRole('dialog', { name: 'Review split change' });
  check('Merlin Oct1 review includes existing Peppa and exact recipient percentages',
    /Merlin 70(?:\.00)?%.*Bloomjoy 30(?:\.00)?%/.test((await merlinReview.innerText()).replace(/\s+/g, ' '))
    && (await merlinReview.innerText()).includes('Peppa Pig'));
  await merlinReview.getByRole('button', { name: 'Confirm split change' }).click();
  await merlinReview.waitFor({ state: 'hidden' });
  const merlinSave = state.calls.filter(call => call.name === 'admin_change_partnership_split').at(-1).body;
  check('Merlin Oct1 split binds corrected Sep30 version without lifecycle backdating',
    merlinSave.p_expected_rule_id === oldRules[0].id && merlinSave.p_expected_rule.effective_end_date === '2026-09-30'
    && merlinSave.p_effective_from === '2026-10-01' && merlinSave.p_primary_share === 7000 && merlinSave.p_bloomjoy_share === 3000);
  await open(page, state, ids.merlin, 'machines');
  const peppa = page.locator('label').filter({ hasText: 'Peppa Pig' });
  check('Peppa exact source already assigned without duplicate write', await peppa.getByRole('checkbox').isChecked()
    && (await peppa.innerText()).includes(sourceIds.peppa) && (await peppa.innerText()).includes('This partnership'));
  check('Hub-only provisional LA excluded from physical choices', await page.locator('label').filter({ hasText: 'Bubble Planet LA provisional' }).count() === 0);
  await open(page, state, ids.bubble, 'machines');
  const la = page.locator('label').filter({ hasText: sourceIds.la });
  await la.waitFor();
  check('LA assignment choice retains exact imported source ID', await la.count() === 1);
  await la.getByRole('checkbox').check(); await page.locator('#assignment-start').fill('2026-10-01');
  state.sourcesFail = true;
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await page.getByRole('button', { name: 'Retry source inventory' }).waitFor();
  check('Cached source outage removes new physical choices', await page.locator('label').filter({ hasText: sourceIds.la }).count() === 0);
  await page.getByRole('button', { name: 'Save Machine Alignment' }).click();
  await page.getByText('Choose an assignment date and reload verified source identity before adding machines.', { exact: true }).waitFor();
  check('Cached source failure performs no new assignment writer', !state.calls.some(call => call.name === 'admin_upsert_reporting_machine_assignment'));
  state.sourcesFail = false; await page.getByRole('button', { name: 'Retry source inventory' }).click();
  await la.waitFor();
  await page.getByRole('button', { name: 'Save Machine Alignment' }).click();
  await page.getByText('Machine alignment saved.', { exact: true }).waitFor();
  const assignments = state.calls.filter(call => call.name === 'admin_upsert_reporting_machine_assignment');
  check('Exactly LA assigned Oct1, Peppa untouched', assignments.length === 1 && assignments[0].body.p_machine_id === ids.la
    && assignments[0].body.p_effective_start_date === '2026-10-01' && assignments[0].body.p_effective_end_date === null);
  check('No unexpected RPC, browser failures or external business writers', !state.unexpected.length && !state.errors.length);
  const scoped = createState(); scoped.scoped = true;
  const scopedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await install(scopedContext, scoped);
  const scopedPage = await scopedContext.newPage();
  scopedPage.on('pageerror', error => scoped.errors.push(error.message));
  scopedPage.on('requestfailed', request => scoped.errors.push(request.failure()?.errorText));
  await scopedPage.goto(`${app}/admin/partnerships`);
  await scopedPage.getByRole('button', { name: /^Merlin\b/ }).click();
  await scopedPage.waitForFunction(() => document.querySelector('#scoped-partnership-name')?.value === 'Merlin');
  await scopedPage.locator('#scoped-assignment-start').fill('2026-10-01');
  await scopedPage.locator('#scoped-partnership-reason').fill('Synthetic reviewed source assignment');
  const scopedLa = scopedPage.locator('label').filter({ hasText: 'Bubble Planet LA' });
  await scopedLa.getByRole('checkbox').check();
  check('Scoped new assignment exposes editable effective date', await scopedPage.locator('#scoped-assignment-start').inputValue() === '2026-10-01');
  scoped.sourcesFail = true; await scopedPage.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await scopedPage.getByRole('button', { name: 'Retry source inventory' }).waitFor();
  check('Scoped cached source failure disables save and keeps existing Peppa', await scopedPage.getByRole('button', { name: 'Save partnership', exact: true }).isDisabled()
    && await scopedPage.locator('label').filter({ hasText: 'Peppa Pig' }).getByRole('checkbox').isChecked());
  check('Scoped failure cannot perform any business write', !scoped.calls.some(call => call.name === 'admin_upsert_reporting_partnership' || call.name === 'admin_upsert_reporting_machine_assignment'));
  scoped.sourcesFail = false; await scopedPage.getByRole('button', { name: 'Retry source inventory' }).click();
  await scopedLa.waitFor();
  check('Scoped physical choice displays exact source ID', (await scopedLa.innerText()).includes(sourceIds.la));
  await scopedPage.getByRole('button', { name: 'Save partnership', exact: true }).click();
  await scopedPage.getByText('Partnership updated.', { exact: true }).waitFor();
  const scopedAdds = scoped.calls.filter(call => call.name === 'admin_upsert_reporting_machine_assignment');
  check('Scoped addition uses chosen Oct1 date and leaves existing Peppa untouched', scopedAdds.length === 1
    && scopedAdds[0].body.p_machine_id === ids.la && scopedAdds[0].body.p_effective_start_date === '2026-10-01');
  check('Scoped browser preserves strict request and RPC provenance', !scoped.errors.length && !scoped.unexpected.length);
  await scopedPage.screenshot({ path: `${output}/390-scoped-assignment.png` });
  await writeFile(`${output}/results.json`, JSON.stringify({ candidate: process.env.TESTED_SHA, engine,
    physicalIPhoneTested: false, assertions: results }, null, 2));
  }
} finally { await browser.close(); }
