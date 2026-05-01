import { supabaseClient } from '@/lib/supabaseClient';

export type AdminTechnicianMachine = {
  machineId: string;
  machineLabel: string;
  machineType: string;
  accountId: string;
  accountName: string;
  locationId: string | null;
  locationName: string | null;
  status: string;
};

export type AdminTechnicianAccount = {
  accountId: string;
  accountName: string;
  accountStatus: string;
  machineCount: number;
  machines: AdminTechnicianMachine[];
};

export type AdminTechnicianGrantMachine = AdminTechnicianMachine & {
  assignmentId: string;
  startsAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  isActive: boolean;
};

export type AdminTechnicianGrant = {
  grantId: string;
  accountId: string;
  accountName: string;
  sponsorUserId: string;
  sponsorType: string;
  partnerId: string | null;
  partnerName: string | null;
  technicianEmail: string;
  technicianUserId: string | null;
  operatorTrainingGrantId: string | null;
  status: string;
  startsAt: string;
  expiresAt: string | null;
  grantReason: string;
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
  machines: AdminTechnicianGrantMachine[];
  activeReportingEntitlementCount: number;
};

export type AdminTechnicianAccessContext = {
  targetEmail: string;
  targetUserId: string | null;
  accounts: AdminTechnicianAccount[];
  grants: AdminTechnicianGrant[];
};

export type AdminTechnicianMutationResult = {
  grantId: string;
  accountId: string;
  partnerId: string | null;
  sponsorType: string;
  technicianEmail: string;
  technicianUserId: string | null;
  status: string;
  expiresAt: string | null;
  operatorTrainingGrantId: string | null;
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const asNullableString = (value: unknown) => (typeof value === 'string' ? value : null);
const asBoolean = (value: unknown) => Boolean(value);
const asNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const asArray = <T>(value: unknown, mapper: (item: unknown) => T): T[] =>
  Array.isArray(value) ? value.map(mapper) : [];

const getAdminTechnicianErrorMessage = (message: string | undefined, fallback: string) => {
  const rawMessage = message ?? '';
  const missingRpc =
    rawMessage.includes('schema cache') &&
    (rawMessage.includes('admin_get_technician_access_context') ||
      rawMessage.includes('admin_grant_technician_access') ||
      rawMessage.includes('admin_update_technician_machines') ||
      rawMessage.includes('admin_renew_technician_access') ||
      rawMessage.includes('admin_revoke_technician_access'));

  if (missingRpc) {
    return 'Admin Technician controls are not enabled in this environment yet. Bloomjoy needs to finish the database rollout before Technician access can be managed from Admin Access.';
  }

  if (rawMessage.includes('Super-admin access required')) {
    return 'Super Admin access is required to manage Technicians from Admin Access.';
  }

  if (rawMessage.includes('zero or one Technician machine')) {
    return 'Admin Technician access must be training-only or scoped to one machine.';
  }

  if (rawMessage.includes('No active Technician sponsor found')) {
    return 'This account needs an active Plus owner before Technician access can be granted.';
  }

  if (rawMessage.includes('Technician grant cap exceeded')) {
    return 'This account already has 10 active Technician grants. Paid additional seats are not enabled yet.';
  }

  return rawMessage || fallback;
};

const mapMachine = (item: unknown): AdminTechnicianMachine => {
  const record = isRecord(item) ? item : {};

  return {
    machineId: asString(record.machineId),
    machineLabel: asString(record.machineLabel, 'Unnamed machine'),
    machineType: asString(record.machineType, 'unknown'),
    accountId: asString(record.accountId),
    accountName: asString(record.accountName, 'Customer account'),
    locationId: asNullableString(record.locationId),
    locationName: asNullableString(record.locationName),
    status: asString(record.status, 'active'),
  };
};

const mapAccount = (item: unknown): AdminTechnicianAccount => {
  const record = isRecord(item) ? item : {};

  return {
    accountId: asString(record.accountId),
    accountName: asString(record.accountName, 'Customer account'),
    accountStatus: asString(record.accountStatus, 'active'),
    machineCount: asNumber(record.machineCount),
    machines: asArray(record.machines, mapMachine).filter((machine) => machine.machineId),
  };
};

const mapGrantMachine = (item: unknown): AdminTechnicianGrantMachine => {
  const record = isRecord(item) ? item : {};
  const machine = mapMachine(item);

  return {
    ...machine,
    assignmentId: asString(record.assignmentId),
    startsAt: asString(record.startsAt),
    expiresAt: asNullableString(record.expiresAt),
    revokedAt: asNullableString(record.revokedAt),
    revokeReason: asNullableString(record.revokeReason),
    isActive: asBoolean(record.isActive),
  };
};

const mapGrant = (item: unknown): AdminTechnicianGrant => {
  const record = isRecord(item) ? item : {};

  return {
    grantId: asString(record.grantId),
    accountId: asString(record.accountId),
    accountName: asString(record.accountName, 'Customer account'),
    sponsorUserId: asString(record.sponsorUserId),
    sponsorType: asString(record.sponsorType, 'plus_customer_account'),
    partnerId: asNullableString(record.partnerId),
    partnerName: asNullableString(record.partnerName),
    technicianEmail: asString(record.technicianEmail),
    technicianUserId: asNullableString(record.technicianUserId),
    operatorTrainingGrantId: asNullableString(record.operatorTrainingGrantId),
    status: asString(record.status, 'pending'),
    startsAt: asString(record.startsAt),
    expiresAt: asNullableString(record.expiresAt),
    grantReason: asString(record.grantReason, 'Technician access'),
    revokedAt: asNullableString(record.revokedAt),
    revokeReason: asNullableString(record.revokeReason),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
    isActive: asBoolean(record.isActive),
    machines: asArray(record.machines, mapGrantMachine).filter((machine) => machine.machineId),
    activeReportingEntitlementCount: asNumber(record.activeReportingEntitlementCount),
  };
};

const mapMutationResult = (value: unknown): AdminTechnicianMutationResult => {
  const record = isRecord(value) ? value : {};

  return {
    grantId: asString(record.grantId),
    accountId: asString(record.accountId),
    partnerId: asNullableString(record.partnerId),
    sponsorType: asString(record.sponsorType, 'plus_customer_account'),
    technicianEmail: asString(record.technicianEmail),
    technicianUserId: asNullableString(record.technicianUserId),
    status: asString(record.status, 'pending'),
    expiresAt: asNullableString(record.expiresAt),
    operatorTrainingGrantId: asNullableString(record.operatorTrainingGrantId),
  };
};

export const fetchAdminTechnicianAccessContext = async (
  email: string
): Promise<AdminTechnicianAccessContext> => {
  const { data, error } = await supabaseClient.rpc('admin_get_technician_access_context', {
    p_target_email: email.trim(),
  });

  if (error) {
    throw new Error(
      getAdminTechnicianErrorMessage(error.message, 'Unable to load Technician access.')
    );
  }

  const record = isRecord(data) ? data : {};

  return {
    targetEmail: asString(record.targetEmail, email.trim().toLowerCase()),
    targetUserId: asNullableString(record.targetUserId),
    accounts: asArray(record.accounts, mapAccount).filter((account) => account.accountId),
    grants: asArray(record.grants, mapGrant).filter((grant) => grant.grantId),
  };
};

export const adminGrantTechnicianAccess = async (input: {
  email: string;
  accountId: string;
  machineId: string | null;
  reason: string;
}): Promise<AdminTechnicianMutationResult> => {
  const { data, error } = await supabaseClient.rpc('admin_grant_technician_access', {
    p_target_email: input.email.trim(),
    p_account_id: input.accountId,
    p_machine_id: input.machineId,
    p_reason: input.reason.trim(),
  });

  if (error || !data) {
    throw new Error(
      getAdminTechnicianErrorMessage(error?.message, 'Unable to save Technician access.')
    );
  }

  return mapMutationResult(data);
};

export const adminUpdateTechnicianMachines = async (input: {
  grantId: string;
  machineId: string | null;
  reason: string;
}): Promise<AdminTechnicianMutationResult> => {
  const { data, error } = await supabaseClient.rpc('admin_update_technician_machines', {
    p_grant_id: input.grantId,
    p_machine_id: input.machineId,
    p_reason: input.reason.trim(),
  });

  if (error || !data) {
    throw new Error(
      getAdminTechnicianErrorMessage(error?.message, 'Unable to update Technician machines.')
    );
  }

  return mapMutationResult(data);
};

export const adminRenewTechnicianAccess = async (input: {
  grantId: string;
  reason: string;
}): Promise<AdminTechnicianMutationResult> => {
  const { data, error } = await supabaseClient.rpc('admin_renew_technician_access', {
    p_grant_id: input.grantId,
    p_reason: input.reason.trim(),
  });

  if (error || !data) {
    throw new Error(
      getAdminTechnicianErrorMessage(error?.message, 'Unable to renew Technician access.')
    );
  }

  return mapMutationResult(data);
};

export const adminRevokeTechnicianAccess = async (input: {
  grantId: string;
  reason: string;
}): Promise<AdminTechnicianMutationResult> => {
  const { data, error } = await supabaseClient.rpc('admin_revoke_technician_access', {
    p_grant_id: input.grantId,
    p_reason: input.reason.trim(),
  });

  if (error || !data) {
    throw new Error(
      getAdminTechnicianErrorMessage(error?.message, 'Unable to revoke Technician access.')
    );
  }

  return mapMutationResult(data);
};
