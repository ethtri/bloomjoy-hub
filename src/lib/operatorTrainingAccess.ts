import { supabaseClient } from '@/lib/supabaseClient';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';

export type OperatorTrainingGrant = {
  id: string;
  sponsorUserId: string;
  operatorEmail: string;
  operatorUserId: string | null;
  startsAt: string;
  expiresAt: string | null;
  grantReason: string;
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
};

type OperatorTrainingGrantRecord = {
  id: string;
  sponsor_user_id: string;
  operator_email: string;
  operator_user_id: string | null;
  starts_at: string;
  expires_at: string | null;
  grant_reason: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  created_at: string;
  updated_at: string;
  is_active: boolean | null;
};

const getOperatorTrainingErrorMessage = (
  message: string | undefined,
  fallback: string
): string => {
  const rawMessage = message ?? '';
  const missingRpc =
    rawMessage.includes('schema cache') &&
    (rawMessage.includes('grant_operator_training_access') ||
      rawMessage.includes('revoke_operator_training_access') ||
      rawMessage.includes('get_my_operator_training_grants'));

  if (missingRpc) {
    return 'Training-only Technician access is not enabled in this environment yet. Bloomjoy needs to finish the database rollout before this access can be managed.';
  }

  return rawMessage || fallback;
};

const mapGrantRecord = (record: OperatorTrainingGrantRecord): OperatorTrainingGrant => ({
  id: record.id,
  sponsorUserId: record.sponsor_user_id,
  operatorEmail: record.operator_email,
  operatorUserId: record.operator_user_id,
  startsAt: record.starts_at,
  expiresAt: record.expires_at,
  grantReason: record.grant_reason,
  revokedAt: record.revoked_at,
  revokeReason: record.revoke_reason,
  createdAt: record.created_at,
  updatedAt: record.updated_at,
  isActive: Boolean(record.is_active),
});

export const fetchMyOperatorTrainingGrants = async (): Promise<OperatorTrainingGrant[]> => {
  const { data, error } = await supabaseClient.rpc('get_my_operator_training_grants');

  if (error) {
    throw new Error(
      getOperatorTrainingErrorMessage(error.message, 'Unable to load training-only Technician access.')
    );
  }

  return ((data as OperatorTrainingGrantRecord[] | null) ?? []).map(mapGrantRecord);
};

export const grantOperatorTrainingAccess = async (
  operatorEmail: string,
  reason = 'Training-only Technician access'
): Promise<OperatorTrainingGrant> => {
  const { data, error } = await supabaseClient.rpc('grant_operator_training_access', {
    p_operator_email: operatorEmail.trim(),
    p_expires_at: null,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(
      getOperatorTrainingErrorMessage(error?.message, 'Unable to grant training-only Technician access.')
    );
  }

  return mapGrantRecord(data as OperatorTrainingGrantRecord);
};

export const sendOperatorTrainingInvite = async (
  grantId: string,
  loginUrl: string
): Promise<void> => {
  await invokeEdgeFunction(
    'operator-training-invite',
    {
      grantId,
      loginUrl,
    },
    {
      requireUserAuth: true,
      authErrorMessage: 'Log in to send a training invite.',
    }
  );
};

export const revokeOperatorTrainingAccess = async (
  grantId: string,
  reason = 'Technician no longer needs training access'
): Promise<OperatorTrainingGrant> => {
  const { data, error } = await supabaseClient.rpc('revoke_operator_training_access', {
    p_grant_id: grantId,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(
      getOperatorTrainingErrorMessage(error?.message, 'Unable to revoke training-only Technician access.')
    );
  }

  return mapGrantRecord(data as OperatorTrainingGrantRecord);
};
