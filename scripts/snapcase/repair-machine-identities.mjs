import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const requireText = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
};

const requireUuid = (value, label) => {
  const normalized = requireText(value, label);
  if (!uuidPattern.test(normalized)) throw new Error(`${label} must be a UUID`);
  return normalized;
};

export const normalizeRepairManifest = (value) => {
  if (!value || value.version !== 1 || !Array.isArray(value.repairs)) {
    throw new Error('Manifest must use version 1 and contain a repairs array');
  }
  if (value.repairs.length < 1 || value.repairs.length > 6) {
    throw new Error('Manifest must contain between one and six exact repairs');
  }

  const repairs = value.repairs.map((repair, index) => {
    const prefix = `repairs[${index}]`;
    if (repair.partnershipId !== null) {
      throw new Error(`${prefix}.partnershipId must be null so existing assignments remain unchanged`);
    }
    return {
      key: requireText(repair.key, `${prefix}.key`),
      providerAccountId: requireUuid(repair.providerAccountId, `${prefix}.providerAccountId`),
      sourceMachineId: requireText(repair.sourceMachineId, `${prefix}.sourceMachineId`),
      expectedSourceInventoryId: requireText(repair.expectedSourceInventoryId, `${prefix}.expectedSourceInventoryId`),
      expectedCurrentReportingMachineId: requireUuid(
        repair.expectedCurrentReportingMachineId,
        `${prefix}.expectedCurrentReportingMachineId`
      ),
      targetReportingMachineId: requireUuid(repair.targetReportingMachineId, `${prefix}.targetReportingMachineId`),
      expectedTargetAccountId: requireUuid(repair.expectedTargetAccountId, `${prefix}.expectedTargetAccountId`),
      expectedTargetLocationId: requireUuid(repair.expectedTargetLocationId, `${prefix}.expectedTargetLocationId`),
      expectedTargetMachineType: requireText(repair.expectedTargetMachineType, `${prefix}.expectedTargetMachineType`),
      expectedTargetNayaxMachineId: requireText(
        repair.expectedTargetNayaxMachineId,
        `${prefix}.expectedTargetNayaxMachineId`
      ),
      partnershipId: null,
      effectiveStartDate: requireText(repair.effectiveStartDate, `${prefix}.effectiveStartDate`),
      effectiveEndDate: repair.effectiveEndDate === null
        ? null
        : requireText(repair.effectiveEndDate, `${prefix}.effectiveEndDate`),
      reason: requireText(repair.reason, `${prefix}.reason`),
    };
  });

  const sourceKeys = new Set();
  const targets = new Set();
  for (const repair of repairs) {
    const sourceKey = `${repair.providerAccountId}:${repair.sourceMachineId}`;
    if (sourceKeys.has(sourceKey)) throw new Error(`Duplicate source identity: ${sourceKey}`);
    if (targets.has(repair.targetReportingMachineId)) {
      throw new Error(`Duplicate target identity: ${repair.targetReportingMachineId}`);
    }
    sourceKeys.add(sourceKey);
    targets.add(repair.targetReportingMachineId);
  }
  return { version: 1, repairs };
};

const isEligibleTarget = (machine) =>
  !machine.sunze_machine_id &&
  (machine.machine_type === 'snapcase' || Boolean(machine.nayax_machine_id?.trim()));

export const buildRepairPreflight = (manifest, queue, machines) => manifest.repairs.map((repair) => {
  const sourceMatches = queue.filter((item) =>
    item.providerAccountId === repair.providerAccountId && item.sourceMachineId === repair.sourceMachineId
  );
  if (sourceMatches.length !== 1) throw new Error(`${repair.key}: exact SnapCase source identity was not found once`);
  const source = sourceMatches[0];
  if (source.sourceInventoryId !== repair.expectedSourceInventoryId) {
    throw new Error(`${repair.key}: source inventory identity changed`);
  }
  if (source.reportingMachineId !== repair.expectedCurrentReportingMachineId) {
    throw new Error(`${repair.key}: current mapping changed after evidence capture`);
  }
  if (source.partnershipId !== repair.partnershipId) {
    throw new Error(`${repair.key}: mapping partnership changed; stop to preserve assignments`);
  }
  if (source.effectiveStartDate !== repair.effectiveStartDate || source.effectiveEndDate !== repair.effectiveEndDate) {
    throw new Error(`${repair.key}: effective mapping window changed`);
  }

  const target = machines.find((machine) => machine.id === repair.targetReportingMachineId);
  if (!target) throw new Error(`${repair.key}: exact target machine was not found`);
  if (!isEligibleTarget(target)) throw new Error(`${repair.key}: target is not eligible for SnapCase mapping`);
  if (
    target.account_id !== repair.expectedTargetAccountId ||
    target.location_id !== repair.expectedTargetLocationId ||
    target.machine_type !== repair.expectedTargetMachineType ||
    target.nayax_machine_id !== repair.expectedTargetNayaxMachineId
  ) {
    throw new Error(`${repair.key}: target identity controls changed`);
  }
  if (queue.some((item) =>
    item.reportingMachineId === repair.targetReportingMachineId &&
    (item.providerAccountId !== repair.providerAccountId || item.sourceMachineId !== repair.sourceMachineId)
  )) {
    throw new Error(`${repair.key}: target already belongs to another SnapCase source`);
  }

  return {
    key: repair.key,
    source: `${repair.providerAccountId}:${repair.sourceMachineId}`,
    beforeReportingMachineId: repair.expectedCurrentReportingMachineId,
    afterReportingMachineId: repair.targetReportingMachineId,
    rollbackReportingMachineId: repair.expectedCurrentReportingMachineId,
    effectiveStartDate: repair.effectiveStartDate,
    effectiveEndDate: repair.effectiveEndDate,
    targetAccountId: repair.expectedTargetAccountId,
    targetLocationId: repair.expectedTargetLocationId,
    targetMachineType: repair.expectedTargetMachineType,
    targetNayaxMachineId: repair.expectedTargetNayaxMachineId,
  };
});

const parseArgs = (argv) => {
  const apply = argv.includes('--apply');
  const manifestIndex = argv.indexOf('--manifest');
  if (manifestIndex < 0 || !argv[manifestIndex + 1]) {
    throw new Error('Usage: node scripts/snapcase/repair-machine-identities.mjs --manifest <private-file> [--apply]');
  }
  return { apply, manifestPath: argv[manifestIndex + 1] };
};

const createRestClient = () => {
  const baseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const apiKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const accessToken = process.env.SUPABASE_ADMIN_ACCESS_TOKEN;
  if (!baseUrl || !apiKey || !accessToken) {
    throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_ADMIN_ACCESS_TOKEN are required');
  }

  return async (path, { method = 'GET', body } = {}) => {
    const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: apiKey,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Supabase request failed (${response.status})`);
    return response.status === 204 ? null : response.json();
  };
};

const loadState = async (request, manifest) => {
  const queue = await request('rpc/admin_get_snapcase_machine_mapping_queue', { method: 'POST', body: {} });
  const targetIds = manifest.repairs.map((repair) => repair.targetReportingMachineId).join(',');
  const machines = await request(
    `reporting_machines?select=id,account_id,location_id,machine_type,sunze_machine_id,nayax_machine_id&id=in.(${targetIds})`
  );
  return { queue, machines };
};

export const run = async (argv = process.argv.slice(2)) => {
  const { apply, manifestPath } = parseArgs(argv);
  const manifest = normalizeRepairManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  const request = createRestClient();
  const before = await loadState(request, manifest);
  const controls = buildRepairPreflight(manifest, before.queue, before.machines);

  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', mutationCount: 0, controls }, null, 2));
    return;
  }

  for (const repair of manifest.repairs) {
    await request('rpc/admin_map_snapcase_machine', {
      method: 'POST',
      body: {
        p_provider_account_id: repair.providerAccountId,
        p_source_machine_id: repair.sourceMachineId,
        p_reporting_machine_id: repair.targetReportingMachineId,
        p_account_id: null,
        p_location_id: null,
        p_location_name: null,
        p_machine_label: null,
        p_partnership_id: null,
        p_effective_start_date: repair.effectiveStartDate,
        p_effective_end_date: repair.effectiveEndDate,
        p_reason: repair.reason,
      },
    });
  }

  const after = await loadState(request, manifest);
  for (const repair of manifest.repairs) {
    const mapped = after.queue.find((item) =>
      item.providerAccountId === repair.providerAccountId && item.sourceMachineId === repair.sourceMachineId
    );
    if (mapped?.reportingMachineId !== repair.targetReportingMachineId) {
      throw new Error(`${repair.key}: mapping did not land on the exact target`);
    }
  }
  console.log(JSON.stringify({ mode: 'apply', mutationCount: manifest.repairs.length, controls }, null, 2));
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : 'SnapCase repair failed');
    process.exitCode = 1;
  });
}
