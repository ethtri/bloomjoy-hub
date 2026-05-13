#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const DEFAULT_ENV_FILES = ['.env', '.env.local'];
const DEFAULT_OUTPUT_DIR = 'output/refund-pilot-readiness';
const DEFAULT_NAYAX_BASE_URL = 'https://lynx.nayax.com/operational/v1';
const DEFAULT_NAYAX_ACCOUNT_KEY = 'TGPACI_USA_DB';

function parseArgs(argv) {
  const parsed = {
    envFiles: [...DEFAULT_ENV_FILES],
    explicitEnvFiles: [],
    outputDir: DEFAULT_OUTPUT_DIR,
    projectRef: '',
    includeNayax: false,
    includeUserCatalog: false,
    nayaxLimit: 1000,
    candidateLimit: 3,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--env-file' && next) {
      parsed.envFiles.push(next);
      parsed.explicitEnvFiles.push(next);
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

    if (arg === '--include-nayax') {
      parsed.includeNayax = true;
      continue;
    }

    if (arg === '--include-user-catalog') {
      parsed.includeUserCatalog = true;
      continue;
    }

    if (arg === '--nayax-limit' && next) {
      parsed.nayaxLimit = Number(next);
      index += 1;
      continue;
    }

    if (arg === '--candidate-limit' && next) {
      parsed.candidateLimit = Number(next);
      index += 1;
    }
  }

  if (!Number.isInteger(parsed.nayaxLimit) || parsed.nayaxLimit < 1 || parsed.nayaxLimit > 5000) {
    throw new Error('--nayax-limit must be an integer from 1 to 5000.');
  }

  if (
    !Number.isInteger(parsed.candidateLimit) ||
    parsed.candidateLimit < 1 ||
    parsed.candidateLimit > 10
  ) {
    throw new Error('--candidate-limit must be an integer from 1 to 10.');
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
    const absolutePath = path.isAbsolute(envFile)
      ? envFile
      : path.resolve(repoRoot, envFile);

    if (!fs.existsSync(absolutePath)) continue;

    Object.assign(env, parseEnvFile(fs.readFileSync(absolutePath, 'utf8')));
    loadedFiles.push(path.relative(repoRoot, absolutePath));
  }

  return {
    env: { ...env, ...process.env },
    loadedFiles,
  };
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

function ensureNoViteServiceRole(env) {
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITE_') && key.toUpperCase().includes('SERVICE_ROLE')) {
      throw new Error(`Refusing to run because ${key} looks like a client-exposed service role key.`);
    }
  }
}

function outputPath(relativeOrAbsolutePath) {
  return path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.resolve(repoRoot, relativeOrAbsolutePath);
}

function csvValue(value) {
  if (value === null || typeof value === 'undefined') return '';
  const text = Array.isArray(value) ? value.join('; ') : String(value);
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

  fs.writeFileSync(filePath, `${content}\n`);
}

function assertSupabase(result, label) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result.data;
}

function createSupabaseClient(supabaseUrl, key) {
  return createClient(supabaseUrl, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function fetchAllRows(supabase, table, select, applyFilters = (query) => query) {
  const pageSize = 1000;
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const query = applyFilters(supabase.from(table).select(select).range(from, to));
    const data = assertSupabase(await query, `Read ${table}`);
    rows.push(...data);

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function countRows(supabase, table, applyFilters = (query) => query) {
  const query = applyFilters(supabase.from(table).select('id', { count: 'exact', head: true }));
  const result = await query;
  if (result.error) {
    throw new Error(`Count ${table}: ${result.error.message}`);
  }
  return result.count ?? 0;
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

function normalizeAccountKey(value) {
  const raw = String(value || DEFAULT_NAYAX_ACCOUNT_KEY).trim();
  return raw.toUpperCase().replace(/[^A-Z0-9_]/g, '_') || DEFAULT_NAYAX_ACCOUNT_KEY;
}

function resolveNayaxToken(env, accountKey = DEFAULT_NAYAX_ACCOUNT_KEY) {
  const normalizedAccountKey = normalizeAccountKey(accountKey);
  return (
    env[`NAYAX_LYNX_API_TOKEN_${normalizedAccountKey}`] ||
    env.NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB ||
    env.NAYAX_LYNX_API_TOKEN ||
    ''
  );
}

function extractRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  for (const key of ['data', 'Data', 'machines', 'Machines', 'result', 'Result', 'records', 'Records']) {
    if (Array.isArray(payload[key])) return payload[key];
  }

  return [];
}

function text(value, maxLength = 500) {
  if (value === null || typeof value === 'undefined') return '';
  return String(value).trim().slice(0, maxLength);
}

function normalizeSearchText(value) {
  return text(value, 500)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(value) {
  return normalizeSearchText(value)
    .split(' ')
    .map((word) => word.trim())
    .filter((word) => word.length >= 3);
}

function getNayaxField(record, ...keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== null && typeof value !== 'undefined' && String(value).trim() !== '') {
      return value;
    }
  }
  return '';
}

function normalizeNayaxMachine(record) {
  return {
    machineId: text(getNayaxField(record, 'MachineID', 'MachineId', 'machineId'), 120),
    actorId: text(getNayaxField(record, 'ActorID', 'ActorId', 'actorId'), 120),
    operatorActorId: text(
      getNayaxField(record, 'OperatorActorID', 'OperatorActorId', 'operatorActorId'),
      120
    ),
    machineName: text(getNayaxField(record, 'MachineName', 'Machine_Name', 'machineName'), 220),
    machineNumber: text(getNayaxField(record, 'MachineNumber', 'Machine_Number', 'machineNumber'), 120),
    machineStatusBit: text(getNayaxField(record, 'MachineStatusBit', 'machineStatusBit'), 80),
    machineTypeId: text(getNayaxField(record, 'MachineTypeID', 'MachineTypeId', 'machineTypeId'), 80),
    vposSerialPresent: Boolean(text(getNayaxField(record, 'VPOSSerialNumber', 'vposSerialNumber'), 120)),
    deviceSerialPresent: Boolean(text(getNayaxField(record, 'DeviceSerialNumber', 'deviceSerialNumber'), 120)),
  };
}

async function fetchNayaxMachines({ env, limit }) {
  const token = resolveNayaxToken(env);
  if (!token) {
    throw new Error('Nayax inventory requested, but no server-only Nayax token was found in local env.');
  }

  const baseUrl = text(env.NAYAX_LYNX_BASE_URL || DEFAULT_NAYAX_BASE_URL, 300).replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/machines?ResultsLimit=${encodeURIComponent(String(limit))}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Nayax machine inventory returned HTTP ${response.status}.`);
  }

  const payload = await response.json();
  return extractRecords(payload).map(normalizeNayaxMachine);
}

function scoreNayaxCandidate(machine, nayaxMachine) {
  const machineLabel = normalizeSearchText(machine.machine_label);
  const locationName = normalizeSearchText(machine.location_name);
  const sunzeId = normalizeSearchText(machine.sunze_machine_id);
  const nayaxName = normalizeSearchText(nayaxMachine.machineName);
  const nayaxNumber = normalizeSearchText(nayaxMachine.machineNumber);
  const nayaxId = normalizeSearchText(nayaxMachine.machineId);
  const reasons = [];
  let score = 0;

  if (machine.nayax_machine_id && normalizeSearchText(machine.nayax_machine_id) === nayaxId) {
    return {
      score: 1,
      reasons: ['existing Nayax machine ID matches inventory'],
    };
  }

  if (sunzeId && (sunzeId === nayaxNumber || sunzeId === nayaxId)) {
    score += 0.45;
    reasons.push('external machine ID matches Nayax number/id');
  }

  if (machineLabel && nayaxName.includes(machineLabel)) {
    score += 0.4;
    reasons.push('machine label appears in Nayax name');
  }

  const labelMatches = words(machine.machine_label).filter((word) => nayaxName.includes(word));
  if (labelMatches.length > 0) {
    score += Math.min(0.3, labelMatches.length * 0.1);
    reasons.push('machine label words overlap');
  }

  if (locationName && nayaxName.includes(locationName)) {
    score += 0.3;
    reasons.push('location name appears in Nayax name');
  }

  const locationMatches = words(machine.location_name).filter((word) => nayaxName.includes(word));
  if (locationMatches.length > 0) {
    score += Math.min(0.2, locationMatches.length * 0.07);
    reasons.push('location words overlap');
  }

  return {
    score: Math.min(1, Number(score.toFixed(2))),
    reasons,
  };
}

function buildNayaxCandidates(machines, nayaxMachines, candidateLimit) {
  if (nayaxMachines.length === 0) return [];

  return machines.flatMap((machine) =>
    nayaxMachines
      .map((nayaxMachine) => {
        const scored = scoreNayaxCandidate(machine, nayaxMachine);
        return {
          reporting_machine_id: machine.id,
          location_name: machine.location_name,
          machine_label: machine.machine_label,
          current_nayax_machine_id: machine.nayax_machine_id,
          candidate_nayax_machine_id: nayaxMachine.machineId,
          candidate_nayax_machine_name: nayaxMachine.machineName,
          candidate_nayax_machine_number: nayaxMachine.machineNumber,
          candidate_score: scored.score,
          candidate_reason: scored.reasons.join('; '),
        };
      })
      .filter((candidate) => candidate.candidate_score > 0)
      .sort((left, right) => right.candidate_score - left.candidate_score)
      .slice(0, candidateLimit)
  );
}

function makeMachineReadinessRows({ machines, locationsById, accountsById, managersByMachineId }) {
  return machines
    .map((machine) => {
      const location = locationsById.get(machine.location_id) ?? {};
      const account = accountsById.get(machine.account_id) ?? {};
      const managerEmails = managersByMachineId.get(machine.id) ?? [];
      const refundIntakeEnabled = Boolean(machine.refund_intake_enabled);
      const nayaxLookupConfigured = Boolean(text(machine.nayax_machine_id));
      const actions = [];

      if (!refundIntakeEnabled) {
        actions.push('enable refund intake for selected pilot machines');
      }

      if (managerEmails.length === 0) {
        actions.push('assign at least 1 Machine Manager');
      } else if (managerEmails.length > 3) {
        actions.push('reduce Machine Managers to max 3');
      }

      if (!nayaxLookupConfigured) {
        actions.push('add Nayax machine ID before card lookup UAT');
      }

      return {
        id: machine.id,
        account_name: account.name || '',
        location_name: location.name || '',
        location_status: location.status || '',
        machine_label: machine.machine_label || '',
        machine_type: machine.machine_type || '',
        sunze_machine_id: machine.sunze_machine_id || '',
        machine_status: machine.status || '',
        refund_intake_enabled: refundIntakeEnabled ? 'yes' : 'no',
        public_display_label: machine.refund_public_display_label || '',
        manager_count: managerEmails.length,
        manager_emails: managerEmails.join('; '),
        nayax_lookup_configured: nayaxLookupConfigured ? 'yes' : 'no',
        nayax_machine_id: machine.nayax_machine_id || '',
        nayax_account_key: machine.nayax_account_key || '',
        live_nayax_refunds_enabled: machine.nayax_refunds_enabled ? 'yes' : 'no',
        max_nayax_refund_cents: machine.nayax_refund_max_amount_cents ?? '',
        pilot_ready:
          refundIntakeEnabled && managerEmails.length >= 1 && managerEmails.length <= 3 && nayaxLookupConfigured
            ? 'yes'
            : 'no',
        suggested_actions: actions.join('; '),
      };
    })
    .sort((left, right) => {
      const locationCompare = left.location_name.localeCompare(right.location_name);
      return locationCompare || left.machine_label.localeCompare(right.machine_label);
    });
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const { env, loadedFiles } = loadEnv(args.envFiles);
  ensureNoViteServiceRole(env);

  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL or VITE_SUPABASE_URL is required.');
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for this read-only readiness audit.');
  }

  const derivedProjectRef = getSupabaseProjectRef(supabaseUrl);
  if (args.projectRef && derivedProjectRef && args.projectRef !== derivedProjectRef) {
    throw new Error(
      `Supabase URL project ref (${derivedProjectRef}) does not match --project-ref ${args.projectRef}.`
    );
  }

  const supabase = createSupabaseClient(supabaseUrl, serviceRoleKey);
  const outputDir = outputPath(args.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const machines = await fetchAllRows(
    supabase,
    'reporting_machines',
    [
      'id',
      'account_id',
      'location_id',
      'machine_label',
      'machine_type',
      'sunze_machine_id',
      'status',
      'refund_intake_enabled',
      'refund_public_display_label',
      'nayax_machine_id',
      'nayax_account_key',
      'nayax_refunds_enabled',
      'nayax_refund_max_amount_cents',
    ].join(','),
    (query) => query.eq('status', 'active').order('machine_label', { ascending: true })
  );
  const locations = await fetchAllRows(
    supabase,
    'reporting_locations',
    'id, account_id, name, city, state, timezone, status'
  );
  const accounts = await fetchAllRows(supabase, 'customer_accounts', 'id, name, status');
  const managerRows = await fetchAllRows(
    supabase,
    'reporting_machine_refund_managers',
    'id, reporting_machine_id, manager_email, status, revoked_at',
    (query) => query.eq('status', 'active').is('revoked_at', null).order('manager_email')
  );

  const managersByMachineId = new Map();
  for (const manager of managerRows) {
    const existing = managersByMachineId.get(manager.reporting_machine_id) ?? [];
    existing.push(manager.manager_email);
    managersByMachineId.set(manager.reporting_machine_id, existing);
  }

  const locationsById = new Map(locations.map((location) => [location.id, location]));
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const machineRows = makeMachineReadinessRows({
    machines,
    locationsById,
    accountsById,
    managersByMachineId,
  });

  const refundCaseCount = await countRows(supabase, 'refund_cases');
  const activeRefundCaseCount = await countRows(supabase, 'refund_cases', (query) =>
    query.not('status', 'in', '("completed","closed","denied")')
  );

  let publicRefundOptionCount = null;
  if (anonKey) {
    const publicClient = createSupabaseClient(supabaseUrl, anonKey);
    const { data, error } = await publicClient.rpc('public_refund_machine_options');
    if (error) {
      throw new Error(`Public refund machine selector check failed: ${error.message}`);
    }
    publicRefundOptionCount = Array.isArray(data) ? data.length : 0;
  }

  const machineCsvPath = path.join(outputDir, 'machine-readiness.csv');
  writeCsv(machineCsvPath, machineRows, [
    { key: 'id', header: 'reporting_machine_id' },
    { key: 'account_name', header: 'account_name' },
    { key: 'location_name', header: 'location_name' },
    { key: 'machine_label', header: 'machine_label' },
    { key: 'machine_type', header: 'machine_type' },
    { key: 'sunze_machine_id', header: 'sunze_machine_id' },
    { key: 'machine_status', header: 'machine_status' },
    { key: 'refund_intake_enabled', header: 'refund_intake_enabled' },
    { key: 'public_display_label', header: 'public_display_label' },
    { key: 'manager_count', header: 'machine_manager_count' },
    { key: 'manager_emails', header: 'machine_manager_emails' },
    { key: 'nayax_lookup_configured', header: 'nayax_lookup_configured' },
    { key: 'nayax_machine_id', header: 'nayax_machine_id' },
    { key: 'nayax_account_key', header: 'nayax_account_key' },
    { key: 'live_nayax_refunds_enabled', header: 'live_nayax_refunds_enabled' },
    { key: 'max_nayax_refund_cents', header: 'max_nayax_refund_cents' },
    { key: 'pilot_ready', header: 'pilot_ready' },
    { key: 'suggested_actions', header: 'suggested_actions' },
  ]);

  let nayaxMachines = [];
  let nayaxCandidateRows = [];
  if (args.includeNayax) {
    nayaxMachines = await fetchNayaxMachines({ env, limit: args.nayaxLimit });
    const nayaxInventoryPath = path.join(outputDir, 'nayax-machine-inventory.csv');
    writeCsv(nayaxInventoryPath, nayaxMachines, [
      { key: 'machineId', header: 'nayax_machine_id' },
      { key: 'machineName', header: 'nayax_machine_name' },
      { key: 'machineNumber', header: 'nayax_machine_number' },
      { key: 'machineStatusBit', header: 'machine_status_bit' },
      { key: 'machineTypeId', header: 'machine_type_id' },
      { key: 'vposSerialPresent', header: 'vpos_serial_present' },
      { key: 'deviceSerialPresent', header: 'device_serial_present' },
    ]);

    nayaxCandidateRows = buildNayaxCandidates(machineRows, nayaxMachines, args.candidateLimit);
    const nayaxCandidatesPath = path.join(outputDir, 'nayax-mapping-candidates.csv');
    writeCsv(nayaxCandidatesPath, nayaxCandidateRows, [
      { key: 'reporting_machine_id', header: 'reporting_machine_id' },
      { key: 'location_name', header: 'location_name' },
      { key: 'machine_label', header: 'machine_label' },
      { key: 'current_nayax_machine_id', header: 'current_nayax_machine_id' },
      { key: 'candidate_nayax_machine_id', header: 'candidate_nayax_machine_id' },
      { key: 'candidate_nayax_machine_name', header: 'candidate_nayax_machine_name' },
      { key: 'candidate_nayax_machine_number', header: 'candidate_nayax_machine_number' },
      { key: 'candidate_score', header: 'candidate_score' },
      { key: 'candidate_reason', header: 'candidate_reason' },
    ]);
  }

  let authUserCount = null;
  if (args.includeUserCatalog) {
    const users = await listAuthUsers(supabase);
    authUserCount = users.length;
    writeCsv(
      path.join(outputDir, 'authenticated-users.csv'),
      users
        .map((user) => ({
          id: user.id,
          email: user.email || '',
          created_at: user.created_at || '',
          last_sign_in_at: user.last_sign_in_at || '',
          confirmed_at: user.confirmed_at || '',
        }))
        .sort((left, right) => left.email.localeCompare(right.email)),
      [
        { key: 'id', header: 'auth_user_id' },
        { key: 'email', header: 'email' },
        { key: 'created_at', header: 'created_at' },
        { key: 'last_sign_in_at', header: 'last_sign_in_at' },
        { key: 'confirmed_at', header: 'confirmed_at' },
      ]
    );
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    projectRef: args.projectRef || derivedProjectRef || 'unknown',
    loadedEnvFileCount: loadedFiles.length,
    activeReportingMachines: machines.length,
    refundIntakeEnabledMachines: machineRows.filter((row) => row.refund_intake_enabled === 'yes').length,
    publicRefundSelectorOptions: publicRefundOptionCount,
    nayaxLookupConfiguredMachines: machineRows.filter((row) => row.nayax_lookup_configured === 'yes').length,
    activeMachineManagerAssignments: managerRows.length,
    machinesWithAtLeastOneManager: machineRows.filter((row) => row.manager_count >= 1).length,
    pilotReadyMachines: machineRows.filter((row) => row.pilot_ready === 'yes').length,
    refundCases: refundCaseCount,
    activeRefundCases: activeRefundCaseCount,
    nayaxInventoryFetched: args.includeNayax ? nayaxMachines.length : null,
    nayaxMappingCandidateRows: args.includeNayax ? nayaxCandidateRows.length : null,
    authUsersCataloged: authUserCount,
    outputDir: path.relative(repoRoot, outputDir),
    nextAction:
      'Use Admin > Machines to enable selected pilot machines, assign 1-3 Machine Managers, and add Nayax machine IDs before manager shadow UAT.',
  };

  fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

  console.log('Refund pilot readiness audit complete.');
  console.log(`Project ref: ${summary.projectRef}`);
  console.log(`Active reporting machines: ${summary.activeReportingMachines}`);
  console.log(`Refund-intake-enabled machines: ${summary.refundIntakeEnabledMachines}`);
  console.log(`Public refund selector options: ${summary.publicRefundSelectorOptions ?? 'not checked'}`);
  console.log(`Nayax lookup configured machines: ${summary.nayaxLookupConfiguredMachines}`);
  console.log(`Active Machine Manager assignments: ${summary.activeMachineManagerAssignments}`);
  console.log(`Pilot-ready machines: ${summary.pilotReadyMachines}`);
  console.log(`Refund cases: ${summary.refundCases}`);
  if (args.includeNayax) {
    console.log(`Nayax inventory machines fetched: ${summary.nayaxInventoryFetched}`);
    console.log(`Nayax mapping candidate rows: ${summary.nayaxMappingCandidateRows}`);
  }
  if (args.includeUserCatalog) {
    console.log(`Authenticated users cataloged locally: ${summary.authUsersCataloged}`);
  }
  console.log(`Local output: ${summary.outputDir}`);
  console.log('No production data was changed.');
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exit(1);
});
