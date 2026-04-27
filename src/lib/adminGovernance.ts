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
