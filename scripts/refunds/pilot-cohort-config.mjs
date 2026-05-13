#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const DEFAULT_ENV_FILES = ['.env', '.env.local'];
const DEFAULT_READINESS_DIR = 'output/refund-pilot-readiness';
const DEFAULT_OUTPUT_DIR = 'output/refund-pilot-cohort-config';
const DEFAULT_ACCOUNT_KEY = 'TGPACI_USA_DB';

function parseArgs(argv) {
  const parsed = {
    envFiles: [...DEFAULT_ENV_FILES],
    file: '',
    readinessDir: DEFAULT_READINESS_DIR,
    outputFile: '',
    outputDir: DEFAULT_OUTPUT_DIR,
    projectRef: '',
    confirmProjectRef: '',
    actorEmail: '',
    reason: '',
    createTemplate: false,
    apply: false,
    allowMissingNayax: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--env-file' && next) {
      parsed.envFiles.push(next);
      index += 1;
      continue;
    }

    if (arg === '--file' && next) {
      parsed.file = next;
      index += 1;
      continue;
    }

    if (arg === '--readiness-dir' && next) {
      parsed.readinessDir = next;
      index += 1;
      continue;
    }

    if (arg === '--output-file' && next) {
      parsed.outputFile = next;
      index += 1;
      continue;
    }

    if (arg === '--output-dir' && next) {
      parsed.outputDir = next;
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
      continue;
    }

    if (arg === '--actor-email' && next) {
      parsed.actorEmail = next.trim().toLowerCase();
      index += 1;
      continue;
    }

    if (arg === '--reason' && next) {
      parsed.reason = next.trim();
      index += 1;
      continue;
    }

    if (arg === '--create-template') {
      parsed.createTemplate = true;
      continue;
    }

    if (arg === '--apply') {
      parsed.apply = true;
      continue;
    }

    if (arg === '--allow-missing-nayax') {
      parsed.allowMissingNayax = true;
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Refund pilot cohort config helper

Create a local setup template from the readiness audit:
  npm run refunds:pilot-cohort-config -- --create-template --readiness-dir output/refund-pilot-readiness

Dry-run a filled template against Supabase:
  npm run refunds:pilot-cohort-config -- --file output/refund-pilot-readiness/pilot-cohort-config-template.csv --env-file <local-env-file> --project-ref ygbzkgxktzqsiygjlqyg

Apply a filled template after explicit confirmation:
  npm run refunds:pilot-cohort-config -- --file <filled.csv> --env-file <local-env-file> --project-ref ygbzkgxktzqsiygjlqyg --apply --confirm-project-ref ygbzkgxktzqsiygjlqyg --actor-email <super-admin-email> --reason "Refund shadow pilot cohort setup"

This helper never enables live Nayax refund execution.`);
}

function resolvePath(relativeOrAbsolutePath) {
  return path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.resolve(repoRoot, relativeOrAbsolutePath);
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

  for (const envFile of envFiles) {
    const absolutePath = resolvePath(envFile);
    if (!fs.existsSync(absolutePath)) continue;
    Object.assign(env, parseEnvFile(fs.readFileSync(absolutePath, 'utf8')));
  }

  return { ...env, ...process.env };
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

function ensureNoClientExposedServiceRole(env) {
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITE_') && key.toUpperCase().includes('SERVICE_ROLE')) {
      throw new Error(`Refusing to run because ${key} looks client-exposed.`);
    }
  }
}

function parseCsv(contents) {
  const normalized = contents.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index]?.trim() ?? '';
    });
    return record;
  });
}

function csvValue(value) {
  if (value === null || typeof value === 'undefined') return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(filePath, rows, columns) {
  const content = [
    columns.map((column) => csvValue(column.header)).join(','),
    ...rows.map((row) => columns.map((column) => csvValue(row[column.key])).join(',')),
  ].join('\n');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content}\n`);
}

function text(value, maxLength = 500) {
  if (value === null || typeof value === 'undefined') return '';
  return String(value).trim().slice(0, maxLength);
}

function yes(value) {
  return ['1', 'true', 'yes', 'y', 'x'].includes(text(value).toLowerCase());
}

function no(value) {
  return ['0', 'false', 'no', 'n'].includes(text(value).toLowerCase());
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    text(value)
  );
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value).toLowerCase());
}

function normalizeEmail(value) {
  return text(value).toLowerCase();
}

function validNayaxMachineId(value) {
  const raw = text(value);
  return raw === '' || /^[A-Za-z0-9][A-Za-z0-9._:-]{1,119}$/.test(raw);
}

function validNayaxAccountKey(value) {
  const raw = text(value || DEFAULT_ACCOUNT_KEY).toUpperCase();
  return /^[A-Za-z0-9][A-Za-z0-9_:-]{1,79}$/.test(raw);
}

function splitEmails(value) {
  return text(value, 1000)
    .split(/[;,]/)
    .map(normalizeEmail)
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function requireSupabaseConfig(args) {
  const env = loadEnv(args.envFiles);
  ensureNoClientExposedServiceRole(env);

  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error('SUPABASE_URL or VITE_SUPABASE_URL is required.');
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required.');

  const derivedProjectRef = getSupabaseProjectRef(supabaseUrl);
  if (args.projectRef && derivedProjectRef && args.projectRef !== derivedProjectRef) {
    throw new Error(
      `Supabase URL project ref (${derivedProjectRef}) does not match --project-ref ${args.projectRef}.`
    );
  }

  return {
    supabaseUrl,
    serviceRoleKey,
    projectRef: args.projectRef || derivedProjectRef || 'unknown',
  };
}

function createSupabaseClient(supabaseUrl, serviceRoleKey) {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function assertSupabase(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function listAuthUsers(supabase) {
  const users = [];
  let page = 1;

  while (page < 100) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`List auth users: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) break;
    page += 1;
  }

  return users;
}

function getBestCandidates(readinessDir) {
  const candidatesPath = path.join(readinessDir, 'nayax-mapping-candidates.csv');
  if (!fs.existsSync(candidatesPath)) return new Map();

  const candidates = parseCsv(fs.readFileSync(candidatesPath, 'utf8'));
  const byMachineId = new Map();

  for (const candidate of candidates) {
    const machineId = text(candidate.reporting_machine_id);
    const score = Number(candidate.candidate_score || 0);
    const existing = byMachineId.get(machineId);

    if (!existing || score > Number(existing.candidate_score || 0)) {
      byMachineId.set(machineId, candidate);
    }
  }

  return byMachineId;
}

function createTemplate(args) {
  const readinessDir = resolvePath(args.readinessDir);
  const readinessPath = path.join(readinessDir, 'machine-readiness.csv');
  if (!fs.existsSync(readinessPath)) {
    throw new Error(`Missing readiness file: ${readinessPath}`);
  }

  const outputFile = resolvePath(
    args.outputFile || path.join(args.readinessDir, 'pilot-cohort-config-template.csv')
  );
  const readinessRows = parseCsv(fs.readFileSync(readinessPath, 'utf8'));
  const bestCandidates = getBestCandidates(readinessDir);

  const templateRows = readinessRows.map((row) => {
    const candidate = bestCandidates.get(row.reporting_machine_id) ?? {};
    const score = Number(candidate.candidate_score || 0);
    const highConfidence = score >= 0.85;

    return {
      selected_for_pilot: '',
      reporting_machine_id: row.reporting_machine_id,
      account_name: row.account_name,
      location_name: row.location_name,
      machine_label: row.machine_label,
      current_refund_intake_enabled: row.refund_intake_enabled,
      enable_refund_intake: 'yes',
      public_display_label_to_apply: row.public_display_label || row.machine_label,
      manager_email_1: '',
      manager_email_2: '',
      manager_email_3: '',
      nayax_machine_id_to_apply: highConfidence ? candidate.candidate_nayax_machine_id : '',
      nayax_account_key_to_apply: DEFAULT_ACCOUNT_KEY,
      suggested_nayax_machine_id: candidate.candidate_nayax_machine_id || '',
      suggested_nayax_machine_name: candidate.candidate_nayax_machine_name || '',
      suggested_nayax_score: candidate.candidate_score || '',
      mapping_review_required: highConfidence ? 'no' : 'yes',
      setup_notes: '',
    };
  });

  writeCsv(outputFile, templateRows, [
    { key: 'selected_for_pilot', header: 'selected_for_pilot' },
    { key: 'reporting_machine_id', header: 'reporting_machine_id' },
    { key: 'account_name', header: 'account_name' },
    { key: 'location_name', header: 'location_name' },
    { key: 'machine_label', header: 'machine_label' },
    { key: 'current_refund_intake_enabled', header: 'current_refund_intake_enabled' },
    { key: 'enable_refund_intake', header: 'enable_refund_intake' },
    { key: 'public_display_label_to_apply', header: 'public_display_label_to_apply' },
    { key: 'manager_email_1', header: 'manager_email_1' },
    { key: 'manager_email_2', header: 'manager_email_2' },
    { key: 'manager_email_3', header: 'manager_email_3' },
    { key: 'nayax_machine_id_to_apply', header: 'nayax_machine_id_to_apply' },
    { key: 'nayax_account_key_to_apply', header: 'nayax_account_key_to_apply' },
    { key: 'suggested_nayax_machine_id', header: 'suggested_nayax_machine_id' },
    { key: 'suggested_nayax_machine_name', header: 'suggested_nayax_machine_name' },
    { key: 'suggested_nayax_score', header: 'suggested_nayax_score' },
    { key: 'mapping_review_required', header: 'mapping_review_required' },
    { key: 'setup_notes', header: 'setup_notes' },
  ]);

  console.log(`Created pilot cohort config template: ${path.relative(repoRoot, outputFile)}`);
  console.log(`Rows: ${templateRows.length}`);
}

function parseSelectedPlans(rows, args) {
  const selectedRows = rows.filter((row) => yes(row.selected_for_pilot));
  const errors = [];

  const plans = selectedRows.map((row, index) => {
    const rowNumber = index + 2;
    const managerEmails = unique([
      ...splitEmails(row.machine_manager_emails_to_apply),
      normalizeEmail(row.manager_email_1),
      normalizeEmail(row.manager_email_2),
      normalizeEmail(row.manager_email_3),
    ].filter(Boolean));
    const enableRefundIntake = no(row.enable_refund_intake) ? false : true;
    const nayaxMachineId = text(row.nayax_machine_id_to_apply || row.nayax_machine_id);
    const nayaxAccountKey = text(row.nayax_account_key_to_apply || row.nayax_account_key || DEFAULT_ACCOUNT_KEY)
      .toUpperCase();
    const publicDisplayLabel = text(row.public_display_label_to_apply || row.public_display_label);

    if (!validUuid(row.reporting_machine_id)) {
      errors.push(`Row ${rowNumber}: reporting_machine_id is required and must be a UUID.`);
    }

    if (managerEmails.length < 1) {
      errors.push(`Row ${rowNumber}: at least one Machine Manager email is required.`);
    }

    if (managerEmails.length > 3) {
      errors.push(`Row ${rowNumber}: no more than three Machine Managers are allowed.`);
    }

    for (const email of managerEmails) {
      if (!validEmail(email)) {
        errors.push(`Row ${rowNumber}: invalid Machine Manager email ${email}.`);
      }
    }

    if (!args.allowMissingNayax && enableRefundIntake && !nayaxMachineId) {
      errors.push(
        `Row ${rowNumber}: Nayax machine ID is required when refund intake is enabled for card-capable shadow UAT.`
      );
    }

    if (!validNayaxMachineId(nayaxMachineId)) {
      errors.push(`Row ${rowNumber}: Nayax machine ID format is invalid.`);
    }

    if (!validNayaxAccountKey(nayaxAccountKey)) {
      errors.push(`Row ${rowNumber}: Nayax account key format is invalid.`);
    }

    if (publicDisplayLabel.length > 120) {
      errors.push(`Row ${rowNumber}: public display label must be 120 characters or fewer.`);
    }

    return {
      rowNumber,
      machineId: text(row.reporting_machine_id),
      machineLabel: text(row.machine_label),
      locationName: text(row.location_name),
      enableRefundIntake,
      publicDisplayLabel,
      managerEmails,
      nayaxMachineId,
      nayaxAccountKey: nayaxMachineId ? nayaxAccountKey : '',
    };
  });

  return { plans, errors };
}

async function validatePlansAgainstSupabase(supabase, plans, args) {
  const errors = [];
  const machineIds = unique(plans.map((plan) => plan.machineId));
  const allEmails = unique(plans.flatMap((plan) => plan.managerEmails));
  const machineIdSeen = new Set();
  const nayaxKeySeen = new Set();

  for (const plan of plans) {
    if (machineIdSeen.has(plan.machineId)) {
      errors.push(`Row ${plan.rowNumber}: machine is selected more than once.`);
    }
    machineIdSeen.add(plan.machineId);

    if (!plan.nayaxMachineId) continue;
    const nayaxKey = `${plan.nayaxAccountKey.toLowerCase()}::${plan.nayaxMachineId.toLowerCase()}`;
    if (nayaxKeySeen.has(nayaxKey)) {
      errors.push(`Row ${plan.rowNumber}: Nayax machine ID is duplicated in the selected cohort.`);
    }
    nayaxKeySeen.add(nayaxKey);
  }

  const machines = machineIds.length
    ? assertSupabase(
        await supabase
          .from('reporting_machines')
          .select(
            'id, machine_label, status, refund_intake_enabled, refund_public_display_label, nayax_machine_id, nayax_account_key, nayax_refunds_enabled'
          )
          .in('id', machineIds),
        'Read selected machines'
      )
    : [];
  const machinesById = new Map(machines.map((machine) => [machine.id, machine]));

  for (const plan of plans) {
    const machine = machinesById.get(plan.machineId);
    if (!machine) {
      errors.push(`Row ${plan.rowNumber}: machine was not found in reporting_machines.`);
      continue;
    }

    if (machine.status !== 'active') {
      errors.push(`Row ${plan.rowNumber}: machine is not active.`);
    }

    if (machine.nayax_refunds_enabled) {
      errors.push(
        `Row ${plan.rowNumber}: live Nayax refunds are enabled for this machine; shadow setup must not enable execution.`
      );
    }
  }

  if (plans.some((plan) => Boolean(plan.nayaxMachineId))) {
    const existingNayaxMachines = assertSupabase(
      await supabase
        .from('reporting_machines')
        .select('id, machine_label, nayax_machine_id, nayax_account_key')
        .not('nayax_machine_id', 'is', null),
      'Read existing Nayax machine mappings'
    );
    const selectedMachineIds = new Set(machineIds);
    const existingNayaxByKey = new Map(
      existingNayaxMachines
        .filter((machine) => !selectedMachineIds.has(machine.id))
        .filter((machine) => text(machine.nayax_machine_id))
        .map((machine) => [
          `${text(machine.nayax_account_key || DEFAULT_ACCOUNT_KEY).toLowerCase()}::${text(
            machine.nayax_machine_id
          ).toLowerCase()}`,
          machine,
        ])
    );

    for (const plan of plans) {
      if (!plan.nayaxMachineId) continue;
      const key = `${plan.nayaxAccountKey.toLowerCase()}::${plan.nayaxMachineId.toLowerCase()}`;
      const existing = existingNayaxByKey.get(key);
      if (existing) {
        errors.push(
          `Row ${plan.rowNumber}: Nayax machine ID is already configured on ${existing.machine_label}.`
        );
      }
    }
  }

  const users = await listAuthUsers(supabase);
  const usersByEmail = new Map(
    users
      .filter((user) => user.email)
      .map((user) => [user.email.toLowerCase(), user])
  );

  for (const email of allEmails) {
    if (!usersByEmail.has(email)) {
      errors.push(`Machine Manager ${email} is not an authenticated Bloomjoy user yet.`);
    }
  }

  let actorUser = null;
  if (args.apply) {
    actorUser = usersByEmail.get(args.actorEmail) ?? null;

    if (!args.confirmProjectRef || args.confirmProjectRef !== args.projectRef) {
      errors.push('Apply requires --confirm-project-ref to match --project-ref.');
    }

    if (!args.reason) {
      errors.push('Apply requires --reason for the admin audit log.');
    }

    if (!actorUser) {
      errors.push('--actor-email must be an authenticated super-admin email for apply.');
    } else {
      const adminRole = assertSupabase(
        await supabase
          .from('admin_roles')
          .select('id')
          .eq('user_id', actorUser.id)
          .eq('role', 'super_admin')
          .eq('active', true)
          .maybeSingle(),
        'Check actor super-admin role'
      );

      if (!adminRole) {
        errors.push('--actor-email must belong to an active super-admin.');
      }
    }
  }

  return { errors, machinesById, usersByEmail, actorUser };
}

async function applyPlan({ supabase, plan, machine, usersByEmail, actorUser, reason }) {
  const beforeManagers = assertSupabase(
    await supabase
      .from('reporting_machine_refund_managers')
      .select('id, manager_user_id, manager_email, status, revoked_at')
      .eq('reporting_machine_id', plan.machineId)
      .eq('status', 'active')
      .is('revoked_at', null),
    `Read active Machine Managers for ${plan.machineId}`
  );

  const targetUserIds = new Set(plan.managerEmails.map((email) => usersByEmail.get(email).id));
  const targetEmailsByUserId = new Map(
    plan.managerEmails.map((email) => [usersByEmail.get(email).id, email])
  );

  for (const manager of beforeManagers) {
    if (targetUserIds.has(manager.manager_user_id)) continue;

    assertSupabase(
      await supabase
        .from('reporting_machine_refund_managers')
        .update({
          status: 'revoked',
          revoked_at: new Date().toISOString(),
          revoked_by: actorUser.id,
          revoke_reason: reason,
        })
        .eq('id', manager.id)
        .select('id')
        .single(),
      `Revoke Machine Manager ${manager.manager_email}`
    );
  }

  const activeManagerUserIds = new Set(beforeManagers.map((manager) => manager.manager_user_id));
  const managersToInsert = [...targetUserIds]
    .filter((userId) => !activeManagerUserIds.has(userId))
    .map((userId) => ({
      reporting_machine_id: plan.machineId,
      manager_user_id: userId,
      manager_email: targetEmailsByUserId.get(userId),
      grant_reason: reason,
      granted_by: actorUser.id,
    }));

  if (managersToInsert.length > 0) {
    assertSupabase(
      await supabase.from('reporting_machine_refund_managers').insert(managersToInsert).select('id'),
      `Insert Machine Managers for ${plan.machineId}`
    );
  }

  const updateResult = assertSupabase(
    await supabase
      .from('reporting_machines')
      .update({
        refund_intake_enabled: plan.enableRefundIntake,
        refund_public_display_label: plan.publicDisplayLabel || null,
        nayax_machine_id: plan.nayaxMachineId || null,
        nayax_account_key: plan.nayaxMachineId ? plan.nayaxAccountKey : null,
      })
      .eq('id', plan.machineId)
      .select(
        'id, refund_intake_enabled, refund_public_display_label, nayax_machine_id, nayax_account_key, nayax_refunds_enabled'
      )
      .single(),
    `Update refund pilot config for ${plan.machineId}`
  );

  assertSupabase(
    await supabase.from('admin_audit_log').insert({
      actor_user_id: actorUser.id,
      action: 'reporting_machine.refund_shadow_pilot_config.apply',
      entity_type: 'reporting_machine',
      entity_id: plan.machineId,
      before: {
        refund_intake_enabled: Boolean(machine.refund_intake_enabled),
        has_refund_public_display_label: Boolean(text(machine.refund_public_display_label)),
        has_nayax_machine_id: Boolean(text(machine.nayax_machine_id)),
        has_nayax_account_key: Boolean(text(machine.nayax_account_key)),
      },
      after: {
        refund_intake_enabled: Boolean(updateResult.refund_intake_enabled),
        has_refund_public_display_label: Boolean(text(updateResult.refund_public_display_label)),
        has_nayax_machine_id: Boolean(text(updateResult.nayax_machine_id)),
        has_nayax_account_key: Boolean(text(updateResult.nayax_account_key)),
        live_nayax_refunds_enabled: Boolean(updateResult.nayax_refunds_enabled),
      },
      meta: {
        reason,
        source: 'refund_pilot_cohort_config_script',
        manager_count: plan.managerEmails.length,
        card_lookup_configured: Boolean(plan.nayaxMachineId),
        live_nayax_refund_execution_enabled: false,
      },
    }),
    `Write admin audit log for ${plan.machineId}`
  );
}

async function validateOrApply(args) {
  if (!args.file) throw new Error('--file is required unless --create-template is used.');

  const configPath = resolvePath(args.file);
  if (!fs.existsSync(configPath)) throw new Error(`Config file not found: ${configPath}`);

  const rows = parseCsv(fs.readFileSync(configPath, 'utf8'));
  const { plans, errors: parseErrors } = parseSelectedPlans(rows, args);
  if (plans.length === 0) {
    console.log('No rows have selected_for_pilot=yes. Nothing to validate or apply.');
  }

  const config = requireSupabaseConfig(args);
  const supabase = createSupabaseClient(config.supabaseUrl, config.serviceRoleKey);
  args.projectRef = args.projectRef || config.projectRef;

  const validation = await validatePlansAgainstSupabase(supabase, plans, args);
  const errors = [...parseErrors, ...validation.errors];

  const outputDir = resolvePath(args.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const summary = {
    generatedAt: new Date().toISOString(),
    projectRef: config.projectRef,
    mode: args.apply ? 'apply' : 'dry-run',
    selectedRows: plans.length,
    managerAssignmentsPlanned: plans.reduce((total, plan) => total + plan.managerEmails.length, 0),
    machinesWithNayaxLookupPlanned: plans.filter((plan) => Boolean(plan.nayaxMachineId)).length,
    errors,
    applied: false,
  };

  if (errors.length > 0) {
    fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    console.error(`Pilot cohort config validation failed with ${errors.length} issue(s).`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  if (args.apply && plans.length > 0) {
    for (const plan of plans) {
      await applyPlan({
        supabase,
        plan,
        machine: validation.machinesById.get(plan.machineId),
        usersByEmail: validation.usersByEmail,
        actorUser: validation.actorUser,
        reason: args.reason,
      });
    }
    summary.applied = true;
  }

  fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

  console.log(`Pilot cohort config ${args.apply ? 'applied' : 'validated in dry-run mode'}.`);
  console.log(`Selected machines: ${summary.selectedRows}`);
  console.log(`Manager assignments planned: ${summary.managerAssignmentsPlanned}`);
  console.log(`Machines with Nayax lookup planned: ${summary.machinesWithNayaxLookupPlanned}`);
  console.log(`Local output: ${path.relative(repoRoot, outputDir)}`);
  if (!args.apply) console.log('No production data was changed.');
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.createTemplate) {
    createTemplate(args);
    return;
  }

  await validateOrApply(args);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exit(1);
});
