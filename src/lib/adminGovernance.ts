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

type AuditLogFilterInput = {
  action?: string;
  entityType?: string;
  search?: string;
  limit?: number;
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
