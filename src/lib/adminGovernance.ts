import { supabaseClient } from '@/lib/supabaseClient';

export type AdminRoleRecord = {
  id: string;
  user_id: string;
  user_email: string | null;
  role: string;
  active: boolean;
  granted_by: string | null;
  granted_at: string;
  revoked_by: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminAuditLogRecord = {
  id: string;
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  target_user_id: string | null;
  target_email: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  meta: Record<string, unknown>;
};

export type ScopedAdminScopeRecord = {
  id: string;
  scopeType: 'account' | 'machine';
  accountId: string | null;
  accountName: string | null;
  machineId: string | null;
  machineLabel: string | null;
  sunzeMachineId: string | null;
  active: boolean;
  grantedAt: string;
  revokedAt: string | null;
};

export type ScopedAdminGrantRecord = {
  id: string;
  userId: string;
  userEmail: string | null;
  role: 'scoped_admin';
  source: string;
  active: boolean;
  startsAt: string;
  expiresAt: string | null;
  grantReason: string;
  grantedBy: string | null;
  grantedAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  scopes: ScopedAdminScopeRecord[];
};

export type ScopedAdminInviteStatus = 'pending' | 'activated' | 'revoked' | 'expired';

export type ScopedAdminInviteRecord = {
  id: string;
  targetEmail: string;
  status: ScopedAdminInviteStatus;
  grantReason: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  activatedUserId: string | null;
  activatedGrantId: string | null;
  activatedAt: string | null;
  revokedBy: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  machineIds: string[];
  machineLabels: string[];
};

export type ScopedAdminInviteResolution = {
  targetEmail: string | null;
  resolvedInviteCount: number;
  grantId: string | null;
  machineCount: number;
};

type AuditLogFilterInput = {
  action?: string;
  entityType?: string;
  search?: string;
  limit?: number;
};

type ScopedAdminGrantRpc = Partial<ScopedAdminGrantRecord> & {
  userId?: string;
  userEmail?: string | null;
  startsAt?: string;
  expiresAt?: string | null;
  grantReason?: string;
  grantedBy?: string | null;
  grantedAt?: string;
  revokedBy?: string | null;
  revokedAt?: string | null;
  revokeReason?: string | null;
  scopes?: Array<Partial<ScopedAdminScopeRecord>>;
};

type ScopedAdminInviteRpc = Partial<ScopedAdminInviteRecord>;

const asNullableString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const mapScopedAdminInvite = (record: ScopedAdminInviteRpc): ScopedAdminInviteRecord => ({
  id: String(record.id ?? ''),
  targetEmail: String(record.targetEmail ?? ''),
  status:
    record.status === 'activated' || record.status === 'revoked' || record.status === 'expired'
      ? record.status
      : 'pending',
  grantReason: String(record.grantReason ?? ''),
  createdBy: asNullableString(record.createdBy),
  createdAt: String(record.createdAt ?? ''),
  expiresAt: String(record.expiresAt ?? ''),
  activatedUserId: asNullableString(record.activatedUserId),
  activatedGrantId: asNullableString(record.activatedGrantId),
  activatedAt: asNullableString(record.activatedAt),
  revokedBy: asNullableString(record.revokedBy),
  revokedAt: asNullableString(record.revokedAt),
  revokeReason: asNullableString(record.revokeReason),
  machineIds: asStringArray(record.machineIds),
  machineLabels: asStringArray(record.machineLabels),
});

export const fetchAdminRoles = async (): Promise<AdminRoleRecord[]> => {
  const { data, error } = await supabaseClient.rpc('admin_list_super_admin_roles');

  if (error || !data) {
    throw new Error(error?.message || 'Unable to load admin roles.');
  }

  return data as AdminRoleRecord[];
};

export const grantSuperAdminByEmail = async (
  targetEmail: string,
  reason: string
): Promise<AdminRoleRecord> => {
  const { data, error } = await supabaseClient.rpc('admin_grant_super_admin_by_email', {
    p_target_email: targetEmail,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to grant super-admin role.');
  }

  return data as AdminRoleRecord;
};

export const revokeSuperAdmin = async (
  targetUserId: string,
  reason: string
): Promise<AdminRoleRecord> => {
  const { data, error } = await supabaseClient.rpc('admin_revoke_super_admin', {
    p_target_user_id: targetUserId,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to revoke super-admin role.');
  }

  return data as AdminRoleRecord;
};

const mapScopedAdminGrant = (record: ScopedAdminGrantRpc): ScopedAdminGrantRecord => ({
  id: String(record.id ?? ''),
  userId: String(record.userId ?? ''),
  userEmail: record.userEmail ?? null,
  role: 'scoped_admin',
  source: String(record.source ?? 'manual_admin_grant'),
  active: Boolean(record.active),
  startsAt: String(record.startsAt ?? ''),
  expiresAt: record.expiresAt ?? null,
  grantReason: String(record.grantReason ?? ''),
  grantedBy: record.grantedBy ?? null,
  grantedAt: String(record.grantedAt ?? ''),
  revokedBy: record.revokedBy ?? null,
  revokedAt: record.revokedAt ?? null,
  revokeReason: record.revokeReason ?? null,
  scopes: (record.scopes ?? [])
    .filter((scope) => scope.id)
    .map((scope) => ({
      id: String(scope.id),
      scopeType: scope.scopeType === 'account' ? 'account' : 'machine',
      accountId: scope.accountId ?? null,
      accountName: scope.accountName ?? null,
      machineId: scope.machineId ?? null,
      machineLabel: scope.machineLabel ?? null,
      sunzeMachineId: scope.sunzeMachineId ?? null,
      active: Boolean(scope.active),
      grantedAt: String(scope.grantedAt ?? ''),
      revokedAt: scope.revokedAt ?? null,
    })),
});

export const fetchScopedAdminGrants = async (): Promise<ScopedAdminGrantRecord[]> => {
  const { data, error } = await supabaseClient.rpc('admin_list_scoped_admin_grants');

  if (error || !data) {
    throw new Error(error?.message || 'Unable to load scoped admin grants.');
  }

  return ((data as ScopedAdminGrantRpc[] | null) ?? []).map(mapScopedAdminGrant);
};

export const fetchScopedAdminInvites = async (): Promise<ScopedAdminInviteRecord[]> => {
  const { data, error } = await supabaseClient.rpc('admin_list_scoped_admin_invites');

  if (error || !data) {
    throw new Error(error?.message || 'Unable to load Scoped Admin invites.');
  }

  return ((data as ScopedAdminInviteRpc[] | null) ?? [])
    .map(mapScopedAdminInvite)
    .filter((invite) => invite.id && invite.targetEmail);
};

export const createScopedAdminInvite = async ({
  targetEmail,
  machineIds,
  reason,
}: {
  targetEmail: string;
  machineIds: string[];
  reason: string;
}): Promise<ScopedAdminInviteRecord> => {
  const { data, error } = await supabaseClient.rpc('admin_create_scoped_admin_invite', {
    p_target_email: targetEmail,
    p_machine_ids: machineIds,
    p_reason: reason,
    p_expires_at: null,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to create Scoped Admin invite.');
  }

  return mapScopedAdminInvite(data as ScopedAdminInviteRpc);
};

export const revokeScopedAdminInvite = async ({
  inviteId,
  reason,
}: {
  inviteId: string;
  reason: string;
}): Promise<void> => {
  const { error } = await supabaseClient.rpc('admin_revoke_scoped_admin_invite', {
    p_invite_id: inviteId,
    p_reason: reason,
  });

  if (error) {
    throw new Error(error.message || 'Unable to revoke Scoped Admin invite.');
  }
};

export const resolveMyScopedAdminInvites = async (): Promise<ScopedAdminInviteResolution> => {
  const { data, error } = await supabaseClient.rpc('resolve_my_scoped_admin_invites', {
    p_reason: 'Scoped Admin invite accepted',
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to resolve Scoped Admin invite.');
  }

  const record = data as Partial<ScopedAdminInviteResolution>;
  return {
    targetEmail: asNullableString(record.targetEmail),
    resolvedInviteCount: Number(record.resolvedInviteCount ?? 0),
    grantId: asNullableString(record.grantId),
    machineCount: Number(record.machineCount ?? 0),
  };
};

export const grantScopedAdminByEmail = async ({
  targetEmail,
  machineIds,
  reason,
}: {
  targetEmail: string;
  machineIds: string[];
  reason: string;
}): Promise<void> => {
  const { error } = await supabaseClient.rpc('admin_grant_scoped_admin_by_email', {
    p_target_email: targetEmail,
    p_machine_ids: machineIds,
    p_reason: reason,
  });

  if (error) {
    throw new Error(error.message || 'Unable to grant scoped admin.');
  }
};

export const revokeScopedAdmin = async ({
  grantId,
  reason,
}: {
  grantId: string;
  reason: string;
}): Promise<void> => {
  const { error } = await supabaseClient.rpc('admin_revoke_scoped_admin', {
    p_grant_id: grantId,
    p_reason: reason,
  });

  if (error) {
    throw new Error(error.message || 'Unable to revoke scoped admin.');
  }
};

export const fetchAdminAuditLog = async ({
  action,
  entityType,
  search,
  limit = 200,
}: AuditLogFilterInput): Promise<AdminAuditLogRecord[]> => {
  const { data, error } = await supabaseClient.rpc('admin_get_audit_log', {
    p_action: action?.trim() ? action.trim() : null,
    p_entity_type: entityType?.trim() ? entityType.trim() : null,
    p_search: search?.trim() ? search.trim() : null,
    p_limit: limit,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to load audit log.');
  }

  return data as AdminAuditLogRecord[];
};
