import { supabaseClient } from '@/lib/supabaseClient';

export type TechnicianGrantStatus = 'pending' | 'active' | 'suspended' | 'revoked';

export type TechnicianManagementMachine = {
  machineId: string;
  machineLabel: string;
  machineType: string;
  locationId: string;
  locationName: string;
  status: string;
};

export type TechnicianManagementAccount = {
  accountId: string;
  accountName: string;
  accountStatus: string;
  seatCap: number;
  activeSeatCount: number;
  machineCount: number;
  machines: TechnicianManagementMachine[];
};

export type TechnicianManagementContext = {
  canManage: boolean;
  seatCap: number;
  accounts: TechnicianManagementAccount[];
};

export type TechnicianGrantMachine = {
  assignmentId: string;
  machineId: string;
  machineLabel: string;
  locationId: string;
  locationName: string;
  status: string;
  startsAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  isActive: boolean;
};

export type TechnicianGrant = {
  grantId: string;
  accountId: string;
  sponsorUserId: string;
  technicianEmail: string;
  technicianUserId: string | null;
  operatorTrainingGrantId: string | null;
  status: TechnicianGrantStatus;
  startsAt: string;
  expiresAt: string | null;
  grantReason: string;
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
  canManage: boolean;
  authorityPath: string;
  seatCap: number;
  activeSeatCount: number;
  machines: TechnicianGrantMachine[];
  activeReportingEntitlementCount: number;
};

export type TechnicianMutationResult = {
  grantId: string;
  accountId: string;
  technicianEmail: string;
  technicianUserId: string | null;
  status: TechnicianGrantStatus;
  operatorTrainingGrantId: string | null;
};

export type TechnicianResolutionResult = {
  technicianEmail: string | null;
  resolvedGrantCount: number;
  resolvedOperatorTrainingGrantCount: number;
  upsertedReportingEntitlementCount: number;
  skippedGrantCount: number;
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const asNullableString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const asBoolean = (value: unknown): boolean => Boolean(value);

const asNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asArray = <T>(value: unknown, mapItem: (item: unknown) => T): T[] =>
  Array.isArray(value) ? value.map(mapItem) : [];

const normalizeStatus = (value: unknown): TechnicianGrantStatus => {
  switch (value) {
    case 'active':
    case 'suspended':
    case 'revoked':
      return value;
    case 'pending':
    default:
      return 'pending';
  }
};

const getTechnicianErrorMessage = (
  message: string | undefined,
  fallback: string
): string => {
  const rawMessage = message ?? '';
  const missingRpc =
    rawMessage.includes('schema cache') &&
    (rawMessage.includes('get_my_technician_management_context') ||
      rawMessage.includes('get_my_technician_grants') ||
      rawMessage.includes('resolve_my_technician_entitlements') ||
      rawMessage.includes('grant_technician_access') ||
      rawMessage.includes('update_technician_machines') ||
      rawMessage.includes('revoke_technician_access'));

  if (missingRpc) {
    return 'Technician management is not enabled in this environment yet. Bloomjoy needs to finish the database rollout before Technician access can be managed.';
  }

  if (rawMessage.includes('Technician grant cap exceeded')) {
    return 'This Plus account already has 10 active Technician grants. Paid additional seats are not enabled yet.';
  }

  if (rawMessage.includes('outside your control')) {
    return 'One or more selected machines are outside this Plus account owner boundary.';
  }

  if (rawMessage.includes('At least one reporting machine is required')) {
    return 'Select at least one reporting machine for this Technician.';
  }

  if (rawMessage.includes('Use a different email')) {
    return 'Use a different email for Technician access.';
  }

  return rawMessage || fallback;
};

const mapManagementMachine = (item: unknown): TechnicianManagementMachine => {
  const record = isRecord(item) ? item : {};

  return {
    machineId: asString(record.machineId),
    machineLabel: asString(record.machineLabel, 'Unnamed machine'),
    machineType: asString(record.machineType, 'unknown'),
    locationId: asString(record.locationId),
    locationName: asString(record.locationName, 'Unassigned location'),
    status: asString(record.status, 'active'),
  };
};

const mapManagementAccount = (item: unknown): TechnicianManagementAccount => {
  const record = isRecord(item) ? item : {};

  return {
    accountId: asString(record.accountId),
    accountName: asString(record.accountName, 'Bloomjoy account'),
    accountStatus: asString(record.accountStatus, 'active'),
    seatCap: asNumber(record.seatCap, 10),
    activeSeatCount: asNumber(record.activeSeatCount),
    machineCount: asNumber(record.machineCount),
    machines: asArray(record.machines, mapManagementMachine).filter((machine) => machine.machineId),
  };
};

const mapTechnicianGrantMachine = (item: unknown): TechnicianGrantMachine => {
  const record = isRecord(item) ? item : {};

  return {
    assignmentId: asString(record.assignmentId),
    machineId: asString(record.machineId),
    machineLabel: asString(record.machineLabel, 'Unnamed machine'),
    locationId: asString(record.locationId),
    locationName: asString(record.locationName, 'Unassigned location'),
    status: asString(record.status, 'active'),
    startsAt: asString(record.startsAt),
    expiresAt: asNullableString(record.expiresAt),
    revokedAt: asNullableString(record.revokedAt),
    revokeReason: asNullableString(record.revokeReason),
    isActive: asBoolean(record.isActive),
  };
};

const mapTechnicianGrant = (item: unknown): TechnicianGrant => {
  const record = isRecord(item) ? item : {};

  return {
    grantId: asString(record.grantId),
    accountId: asString(record.accountId),
    sponsorUserId: asString(record.sponsorUserId),
    technicianEmail: asString(record.technicianEmail),
    technicianUserId: asNullableString(record.technicianUserId),
    operatorTrainingGrantId: asNullableString(record.operatorTrainingGrantId),
    status: normalizeStatus(record.status),
    startsAt: asString(record.startsAt),
    expiresAt: asNullableString(record.expiresAt),
    grantReason: asString(record.grantReason, 'Technician access'),
    revokedAt: asNullableString(record.revokedAt),
    revokeReason: asNullableString(record.revokeReason),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
    isActive: asBoolean(record.isActive),
    canManage: asBoolean(record.canManage),
    authorityPath: asString(record.authorityPath, 'technician'),
    seatCap: asNumber(record.seatCap, 10),
    activeSeatCount: asNumber(record.activeSeatCount),
    machines: asArray(record.machines, mapTechnicianGrantMachine).filter(
      (machine) => machine.machineId
    ),
    activeReportingEntitlementCount: asNumber(record.activeReportingEntitlementCount),
  };
};

const mapMutationResult = (value: unknown): TechnicianMutationResult => {
  const record = isRecord(value) ? value : {};

  return {
    grantId: asString(record.grantId),
    accountId: asString(record.accountId),
    technicianEmail: asString(record.technicianEmail),
    technicianUserId: asNullableString(record.technicianUserId),
    status: normalizeStatus(record.status),
    operatorTrainingGrantId: asNullableString(record.operatorTrainingGrantId),
  };
};

const mapResolutionResult = (value: unknown): TechnicianResolutionResult => {
  const record = isRecord(value) ? value : {};

  return {
    technicianEmail: asNullableString(record.technicianEmail),
    resolvedGrantCount: asNumber(record.resolvedGrantCount),
    resolvedOperatorTrainingGrantCount: asNumber(record.resolvedOperatorTrainingGrantCount),
    upsertedReportingEntitlementCount: asNumber(record.upsertedReportingEntitlementCount),
    skippedGrantCount: asNumber(record.skippedGrantCount),
  };
};

export const resolveMyTechnicianEntitlements =
  async (): Promise<TechnicianResolutionResult> => {
    const { data, error } = await supabaseClient.rpc('resolve_my_technician_entitlements', {
      p_reason: 'Technician invite accepted',
    });

    if (error) {
      throw new Error(
        getTechnicianErrorMessage(error.message, 'Unable to resolve Technician access.')
      );
    }

    return mapResolutionResult(data);
  };

export const fetchTechnicianManagementContext =
  async (): Promise<TechnicianManagementContext> => {
    const { data, error } = await supabaseClient.rpc('get_my_technician_management_context');

    if (error) {
      throw new Error(
        getTechnicianErrorMessage(error.message, 'Unable to load Technician management.')
      );
    }

    const record = isRecord(data) ? data : {};

    return {
      canManage: asBoolean(record.canManage),
      seatCap: asNumber(record.seatCap, 10),
      accounts: asArray(record.accounts, mapManagementAccount).filter(
        (account) => account.accountId
      ),
    };
  };

export const fetchMyTechnicianGrants = async (): Promise<TechnicianGrant[]> => {
  const { data, error } = await supabaseClient.rpc('get_my_technician_grants');

  if (error) {
    throw new Error(
      getTechnicianErrorMessage(error.message, 'Unable to load Technician access.')
    );
  }

  return asArray(data, mapTechnicianGrant).filter((grant) => grant.grantId);
};

export const grantTechnicianAccess = async (input: {
  technicianEmail: string;
  machineIds: string[];
  reason?: string;
}): Promise<TechnicianMutationResult> => {
  const { data, error } = await supabaseClient.rpc('grant_technician_access', {
    p_technician_email: input.technicianEmail.trim(),
    p_machine_ids: input.machineIds,
    p_reason: input.reason?.trim() || 'Technician access',
  });

  if (error || !data) {
    throw new Error(
      getTechnicianErrorMessage(error?.message, 'Unable to grant Technician access.')
    );
  }

  return mapMutationResult(data);
};

export const updateTechnicianMachines = async (input: {
  grantId: string;
  machineIds: string[];
  reason?: string;
}): Promise<TechnicianMutationResult> => {
  const { data, error } = await supabaseClient.rpc('update_technician_machines', {
    p_grant_id: input.grantId,
    p_machine_ids: input.machineIds,
    p_reason: input.reason?.trim() || 'Technician machine assignments updated',
  });

  if (error || !data) {
    throw new Error(
      getTechnicianErrorMessage(error?.message, 'Unable to update Technician machines.')
    );
  }

  return mapMutationResult(data);
};

export const revokeTechnicianAccess = async (input: {
  grantId: string;
  reason: string;
}): Promise<TechnicianMutationResult> => {
  const { data, error } = await supabaseClient.rpc('revoke_technician_access', {
    p_grant_id: input.grantId,
    p_reason: input.reason.trim(),
  });

  if (error || !data) {
    throw new Error(
      getTechnicianErrorMessage(error?.message, 'Unable to revoke Technician access.')
    );
  }

  return mapMutationResult(data);
};
