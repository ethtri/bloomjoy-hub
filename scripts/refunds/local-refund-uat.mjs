#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const PRODUCTION_SUPABASE_PROJECT_REFS = new Set(['ygbzkgxktzqsiygjlqyg']);
const DEFAULT_ENV_FILES = ['.env', '.env.local'];

const FIXTURE = {
  accountId: '41000000-0000-4000-8000-000000000001',
  locationId: '41000000-0000-4000-8000-000000000002',
  machineId: '41000000-0000-4000-8000-000000000003',
  salesFactId: '41000000-0000-4000-8000-000000000004',
  managerAssignmentId: '41000000-0000-4000-8000-000000000005',
  adminRoleId: '41000000-0000-4000-8000-000000000006',
  cardCaseId: '41000000-0000-4000-8000-000000000101',
  waitingCaseId: '41000000-0000-4000-8000-000000000102',
  cashCaseId: '41000000-0000-4000-8000-000000000103',
};

function parseArgs(argv) {
  const parsed = {
    email: 'refund-sponsor-uat@bloomjoy.localhost',
    appUrl: 'http://localhost:8080',
    envFiles: [...DEFAULT_ENV_FILES],
    explicitEnvFiles: [],
    dryRun: false,
    open: false,
    allowRemote: false,
    target: 'local',
    projectRef: '',
    confirmProjectRef: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--email' && next) {
      parsed.email = next.trim().toLowerCase();
      index += 1;
      continue;
    }

    if (arg === '--app-url' && next) {
      parsed.appUrl = next.replace(/\/+$/, '');
      index += 1;
      continue;
    }

    if (arg === '--env-file' && next) {
      parsed.envFiles.push(next);
      parsed.explicitEnvFiles.push(next);
      index += 1;
      continue;
    }

    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }

    if (arg === '--open') {
      parsed.open = true;
      continue;
    }

    if (arg === '--allow-remote') {
      parsed.allowRemote = true;
      continue;
    }

    if (arg === '--target' && next) {
      parsed.target = next.trim();
      index += 1;
      continue;
    }

    if (arg === '--project-ref' && next) {
      parsed.projectRef = next.trim();
      index += 1;
      continue;
    }

    if (arg === '--confirm-project-ref' && next) {
      parsed.confirmProjectRef = next.trim();
      index += 1;
    }
  }

  return parsed;
}

function parseEnvFile(contents) {
  const result = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function loadEnv(envFiles) {
  const env = {};
  const loadedFiles = [];

  for (const envFile of envFiles) {
    const absolutePath = path.resolve(repoRoot, envFile);
    if (!fs.existsSync(absolutePath)) continue;

    Object.assign(env, parseEnvFile(fs.readFileSync(absolutePath, 'utf8')));
    loadedFiles.push(path.relative(repoRoot, absolutePath));
  }

  return {
    env: { ...env, ...process.env },
    loadedFiles,
  };
}

function isLocalSupabaseUrl(value) {
  try {
    const url = new URL(value);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function getSupabaseProjectRef(value) {
  try {
    const url = new URL(value);
    const match = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return match?.[1] ?? '';
  } catch {
    return '';
  }
}

function isProductionAppHost(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'bloomjoysweets.com' || hostname.endsWith('.bloomjoysweets.com');
  } catch {
    return false;
  }
}

function assertRemoteSeedSafety(args, supabaseUrl) {
  const projectRef = getSupabaseProjectRef(supabaseUrl);

  if (args.target !== 'preview-uat') {
    throw new Error(
      'Refusing remote seed without --target preview-uat. Use local Supabase by default.'
    );
  }

  if (!args.allowRemote) {
    throw new Error('Remote preview UAT seeding requires --allow-remote.');
  }

  if (!args.projectRef || args.projectRef !== args.confirmProjectRef) {
    throw new Error('Remote preview UAT seeding requires matching --project-ref and --confirm-project-ref.');
  }

  if (!projectRef || projectRef !== args.projectRef) {
    throw new Error(
      `Supabase URL project ref (${projectRef || 'unknown'}) does not match --project-ref ${args.projectRef}.`
    );
  }

  if (PRODUCTION_SUPABASE_PROJECT_REFS.has(projectRef)) {
    throw new Error(`Refusing to seed known production Supabase project ${projectRef}.`);
  }

  if (isProductionAppHost(args.appUrl)) {
    throw new Error(`Refusing to create UAT magic links for production app host ${args.appUrl}.`);
  }

  if (args.explicitEnvFiles.length === 0) {
    throw new Error(
      'Remote preview UAT seeding requires an explicit --env-file for the preview branch.'
    );
  }
}

function assertSupabase(result, label) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result.data;
}

async function findUserByEmail(supabase, email) {
  let page = 1;

  while (page < 10) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`List users: ${error.message}`);

    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 1000) return null;
    page += 1;
  }

  return null;
}

async function ensureSponsorUser(supabase, email) {
  const existingUser = await findUserByEmail(supabase, email);
  if (existingUser) return existingUser;

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      name: 'Refund UAT Sponsor',
      fixture: 'refund-operations-local-uat',
    },
  });

  if (error) throw new Error(`Create sponsor user: ${error.message}`);
  return data.user;
}

async function upsertRows(supabase, table, rows, label) {
  assertSupabase(
    await supabase.from(table).upsert(rows, { onConflict: 'id' }).select('id'),
    label
  );
}

async function ensureSponsorAdminRole(supabase, sponsorUser) {
  const existing = assertSupabase(
    await supabase
      .from('admin_roles')
      .select('id')
      .eq('user_id', sponsorUser.id)
      .eq('role', 'super_admin')
      .eq('active', true)
      .maybeSingle(),
    'Check sponsor admin role'
  );

  if (existing?.id) return;

  await upsertRows(
    supabase,
    'admin_roles',
    [
      {
        id: FIXTURE.adminRoleId,
        user_id: sponsorUser.id,
        role: 'super_admin',
        active: true,
      },
    ],
    'Grant local sponsor super-admin role'
  );
}

async function ensureManagerAssignment(supabase, sponsorUser, email) {
  const existing = assertSupabase(
    await supabase
      .from('reporting_machine_refund_managers')
      .select('id')
      .eq('reporting_machine_id', FIXTURE.machineId)
      .eq('manager_user_id', sponsorUser.id)
      .eq('status', 'active')
      .is('revoked_at', null)
      .maybeSingle(),
    'Check local refund manager assignment'
  );

  if (existing?.id) {
    assertSupabase(
      await supabase
        .from('reporting_machine_refund_managers')
        .update({
          manager_email: email,
          grant_reason: 'Local refund operations sponsor UAT fixture',
        })
        .eq('id', existing.id)
        .select('id'),
      'Refresh local refund manager assignment'
    );
    return;
  }

  await upsertRows(
    supabase,
    'reporting_machine_refund_managers',
    [
      {
        id: FIXTURE.managerAssignmentId,
        reporting_machine_id: FIXTURE.machineId,
        manager_user_id: sponsorUser.id,
        manager_email: email,
        status: 'active',
        grant_reason: 'Local refund operations sponsor UAT fixture',
        granted_by: sponsorUser.id,
      },
    ],
    'Seed local refund manager assignment'
  );
}

async function seedFixtures(supabase, sponsorUser, email) {
  const now = new Date();
  const isoMinutesAgo = (minutes) => new Date(now.getTime() - minutes * 60_000).toISOString();
  const today = now.toISOString().slice(0, 10);

  await upsertRows(
    supabase,
    'customer_accounts',
    [
      {
        id: FIXTURE.accountId,
        name: 'Refund UAT Synthetic Account',
        account_type: 'internal',
        status: 'active',
        notes: 'Local synthetic fixture for refund operations sponsor UAT. No real customer data.',
        created_by: sponsorUser.id,
      },
    ],
    'Seed synthetic account'
  );

  await upsertRows(
    supabase,
    'reporting_locations',
    [
      {
        id: FIXTURE.locationId,
        account_id: FIXTURE.accountId,
        name: 'Refund UAT Mall',
        partner_name: 'Synthetic Partner',
        city: 'Los Angeles',
        state: 'CA',
        timezone: 'America/Los_Angeles',
        status: 'active',
        notes: 'Synthetic local UAT location.',
      },
    ],
    'Seed synthetic location'
  );

  await upsertRows(
    supabase,
    'reporting_machines',
    [
      {
        id: FIXTURE.machineId,
        account_id: FIXTURE.accountId,
        location_id: FIXTURE.locationId,
        machine_label: 'Refund UAT Kiosk',
        machine_type: 'commercial',
        sunze_machine_id: 'refund-uat-kiosk-local',
        status: 'active',
        installed_at: today,
        notes: 'Synthetic local UAT machine.',
      },
    ],
    'Seed synthetic machine'
  );

  await upsertRows(
    supabase,
    'machine_sales_facts',
    [
      {
        id: FIXTURE.salesFactId,
        reporting_machine_id: FIXTURE.machineId,
        reporting_location_id: FIXTURE.locationId,
        sale_date: today,
        payment_method: 'cash',
        net_sales_cents: 1200,
        transaction_count: 1,
        source: 'sample_seed',
        source_row_hash: 'refund-ops-uat-cash-match',
        raw_payload: {
          fixture: 'refund-operations-local-uat',
          privacy: 'synthetic-no-real-customer-data',
        },
      },
    ],
    'Seed synthetic cash sales fact'
  );

  await ensureSponsorAdminRole(supabase, sponsorUser);
  await ensureManagerAssignment(supabase, sponsorUser, email);

  await upsertRows(
    supabase,
    'refund_cases',
    [
      {
        id: FIXTURE.cardCaseId,
        public_reference: 'RF-UAT-CARD',
        reporting_machine_id: FIXTURE.machineId,
        reporting_location_id: FIXTURE.locationId,
        customer_email: 'customer-card-uat@example.test',
        customer_name: 'Synthetic Card Customer',
        customer_phone: '555-0100',
        issue_summary: 'Synthetic card request with a matched transaction ready for manager completion.',
        incident_at: isoMinutesAgo(45),
        payment_method: 'card',
        payment_amount_cents: 1200,
        card_last4: '4242',
        card_wallet_used: true,
        status: 'card_refund_pending',
        priority: 'normal',
        correlation_status: 'matched',
        correlation_source: 'nayax',
        correlation_confidence: 0.96,
        correlation_summary: 'Synthetic Nayax match found for sponsor UAT review.',
        matched_nayax_transaction_id: 'UAT-NAYAX-410',
        assigned_manager_id: sponsorUser.id,
        decision: 'approved',
        decision_reason: 'Synthetic UAT approval path.',
        decided_by: sponsorUser.id,
        decided_at: isoMinutesAgo(25),
        refund_amount_cents: 1200,
        intake_meta: {
          fixture: 'refund-operations-local-uat',
          privacy: 'synthetic-no-real-customer-data',
        },
      },
      {
        id: FIXTURE.waitingCaseId,
        public_reference: 'RF-UAT-WAIT',
        reporting_machine_id: FIXTURE.machineId,
        reporting_location_id: FIXTURE.locationId,
        customer_email: 'customer-waiting-uat@example.test',
        customer_name: 'Synthetic Waiting Customer',
        customer_phone: '555-0101',
        zelle_payment_contact: 'waiting-zelle-uat@example.test',
        issue_summary: 'Synthetic request missing enough payment detail; manager should verify more-info email state.',
        incident_at: isoMinutesAgo(180),
        payment_method: 'cash',
        payment_amount_cents: null,
        card_wallet_used: false,
        status: 'waiting_on_customer',
        priority: 'normal',
        correlation_status: 'no_match',
        correlation_source: null,
        correlation_confidence: 0,
        correlation_summary: 'No conservative match because the synthetic request omitted amount details.',
        assigned_manager_id: sponsorUser.id,
        decision: null,
        refund_amount_cents: null,
        intake_meta: {
          fixture: 'refund-operations-local-uat',
          privacy: 'synthetic-no-real-customer-data',
        },
      },
      {
        id: FIXTURE.cashCaseId,
        public_reference: 'RF-UAT-CASH',
        reporting_machine_id: FIXTURE.machineId,
        reporting_location_id: FIXTURE.locationId,
        customer_email: 'customer-cash-uat@example.test',
        customer_name: 'Synthetic Cash Customer',
        customer_phone: '555-0102',
        zelle_payment_contact: 'cash-zelle-uat@example.test',
        issue_summary: 'Synthetic cash request with one conservative sales match and no manager decision yet.',
        incident_at: isoMinutesAgo(15),
        payment_method: 'cash',
        payment_amount_cents: 1200,
        card_wallet_used: false,
        status: 'correlated',
        priority: 'high',
        correlation_status: 'matched',
        correlation_source: 'sunze',
        correlation_confidence: 0.9,
        correlation_summary: 'Synthetic exact cash amount match within the one-hour review window.',
        matched_sales_fact_id: FIXTURE.salesFactId,
        assigned_manager_id: sponsorUser.id,
        decision: null,
        refund_amount_cents: 1200,
        intake_meta: {
          fixture: 'refund-operations-local-uat',
          privacy: 'synthetic-no-real-customer-data',
        },
      },
    ],
    'Seed synthetic refund cases'
  );

  await upsertRows(
    supabase,
    'refund_case_events',
    [
      {
        id: '41000000-0000-4000-8000-000000000201',
        refund_case_id: FIXTURE.cardCaseId,
        actor_user_id: sponsorUser.id,
        event_type: 'manager_approved',
        message: 'Synthetic manager approved card refund and recorded the matched transaction.',
        metadata: { fixture: 'refund-operations-local-uat' },
        created_at: isoMinutesAgo(25),
      },
      {
        id: '41000000-0000-4000-8000-000000000202',
        refund_case_id: FIXTURE.waitingCaseId,
        actor_user_id: sponsorUser.id,
        event_type: 'more_info_requested',
        message: 'Synthetic more-info email was queued because payment details were incomplete.',
        metadata: { fixture: 'refund-operations-local-uat' },
        created_at: isoMinutesAgo(160),
      },
      {
        id: '41000000-0000-4000-8000-000000000203',
        refund_case_id: FIXTURE.cashCaseId,
        actor_user_id: null,
        event_type: 'cash_correlation_matched',
        message: 'Synthetic exact cash sales match found for manager review.',
        metadata: { fixture: 'refund-operations-local-uat' },
        created_at: isoMinutesAgo(12),
      },
    ],
    'Seed synthetic refund timeline events'
  );

  await upsertRows(
    supabase,
    'refund_case_messages',
    [
      {
        id: '41000000-0000-4000-8000-000000000301',
        refund_case_id: FIXTURE.cardCaseId,
        message_type: 'confirmation',
        status: 'sent',
        recipient_email: 'customer-card-uat@example.test',
        subject: 'We received your Bloomjoy refund request RF-UAT-CARD',
        body: 'Synthetic confirmation body for local UAT only.',
        template_key: 'refund_case_confirmation_v1',
        sent_at: isoMinutesAgo(42),
        created_by: sponsorUser.id,
        created_at: isoMinutesAgo(43),
      },
      {
        id: '41000000-0000-4000-8000-000000000302',
        refund_case_id: FIXTURE.waitingCaseId,
        message_type: 'confirmation',
        status: 'sent',
        recipient_email: 'customer-waiting-uat@example.test',
        subject: 'We received your Bloomjoy refund request RF-UAT-WAIT',
        body: 'Synthetic confirmation body for local UAT only.',
        template_key: 'refund_case_confirmation_v1',
        sent_at: isoMinutesAgo(178),
        created_by: sponsorUser.id,
        created_at: isoMinutesAgo(179),
      },
      {
        id: '41000000-0000-4000-8000-000000000303',
        refund_case_id: FIXTURE.waitingCaseId,
        message_type: 'more_info',
        status: 'sent',
        recipient_email: 'customer-waiting-uat@example.test',
        subject: 'More information needed for refund request RF-UAT-WAIT',
        body: 'Synthetic more-info body for local UAT only.',
        template_key: 'refund_case_more_info_v1',
        sent_at: isoMinutesAgo(160),
        created_by: sponsorUser.id,
        created_at: isoMinutesAgo(161),
      },
      {
        id: '41000000-0000-4000-8000-000000000304',
        refund_case_id: FIXTURE.cashCaseId,
        message_type: 'confirmation',
        status: 'sent',
        recipient_email: 'customer-cash-uat@example.test',
        subject: 'We received your Bloomjoy refund request RF-UAT-CASH',
        body: 'Synthetic confirmation body for local UAT only.',
        template_key: 'refund_case_confirmation_v1',
        sent_at: isoMinutesAgo(14),
        created_by: sponsorUser.id,
        created_at: isoMinutesAgo(15),
      },
    ],
    'Seed synthetic customer message history'
  );
}

async function generateMagicLink(supabase, email, appUrl) {
  const redirectTo = `${appUrl}/portal/refunds`;
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo },
  });

  if (error) throw new Error(`Generate magic link: ${error.message}`);

  const actionLink = data.properties?.action_link;
  if (!actionLink) throw new Error('Supabase did not return a magic-link action URL.');

  return actionLink;
}

function openUrl(url) {
  const command =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];

  const child = spawn(command[0], command[1], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const { env, loadedFiles } = loadEnv(args.envFiles);
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in local env.'
    );
  }

  if (!isLocalSupabaseUrl(supabaseUrl)) {
    assertRemoteSeedSafety(args, supabaseUrl);
  }

  console.log('Refund Operations local UAT setup');
  console.log(`- Env files loaded: ${loadedFiles.length ? loadedFiles.join(', ') : 'process env only'}`);
  console.log(`- Supabase URL: ${supabaseUrl}`);
  console.log(`- Target: ${args.target}`);
  console.log(`- Supabase project ref: ${getSupabaseProjectRef(supabaseUrl) || 'local'}`);
  console.log(`- Sponsor email: ${args.email}`);
  console.log(`- App URL: ${args.appUrl}`);
  console.log('- Data policy: synthetic fixture only; no real customer/payment/free-text export data.');

  if (args.dryRun) {
    console.log('Dry run complete. No data was written and no magic link was generated.');
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const sponsorUser = await ensureSponsorUser(supabase, args.email);
  await seedFixtures(supabase, sponsorUser, args.email);
  const actionLink = await generateMagicLink(supabase, args.email, args.appUrl);

  console.log('\nSeeded synthetic refund UAT data.');
  console.log('Open this one-click local magic link to review /portal/refunds:');
  console.log(actionLink);

  if (args.open) {
    openUrl(actionLink);
    console.log('Opened the magic link in the default browser.');
  }
}

run().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
