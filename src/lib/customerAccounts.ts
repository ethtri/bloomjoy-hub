import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { supabaseClient } from '@/lib/supabaseClient';
import type { PortalAccessTier, PortalAccountRole } from '@/lib/portalAccess';

type PortalAccessContextRpcRecord = {
  account_id: string | null;
  account_role: PortalAccountRole;
  access_tier: PortalAccessTier;
  can_manage_operators: boolean;
  is_admin: boolean;
};

type CustomerAccountRecordRow = {
  id: string;
  name: string;
  operator_seat_limit: number;
  created_at: string;
  updated_at: string;
};

type CustomerAccountMembershipRow = {
  id: string;
  account_id: string;
  user_id: string;
  email: string;
  role: 'partner' | 'operator';
  invited_by_user_id: string | null;
  joined_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

type CustomerAccountInviteRow = {
  id: string;
  account_id: string;
  email: string;
  role: 'partner' | 'operator';
  invited_by_user_id: string | null;
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  last_sent_at: string | null;
  last_send_error: string | null;
  created_at: string;
  updated_at: string;
};

type CustomerAccountInviteMutationResponse = {
  invite?: CustomerAccountInviteRow;
  deliveryStatus?: 'sent' | 'failed';
  deliveryError?: string | null;
  loginUrl?: string;
  accountName?: string;
  error?: string;
};

type CustomerAccountRevokeMutationResponse = {
  result?: Record<string, unknown>;
  error?: string;
};

export type PortalAccessContext = {
  accountId: string | null;
  accountRole: PortalAccountRole;
  accessTier: PortalAccessTier;
  canManageOperators: boolean;
  isAdmin: boolean;
};

export type CustomerAccountRecord = {
  id: string;
  name: string;
  operatorSeatLimit: number;
  createdAt: string;
  updatedAt: string;
};

export type CustomerAccountMembershipRecord = {
  id: string;
  accountId: string;
  userId: string;
  email: string;
  role: 'partner' | 'operator';
  invitedByUserId: string | null;
  joinedAt: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CustomerAccountInviteRecord = {
  id: string;
  accountId: string;
  email: string;
  role: 'partner' | 'operator';
  invitedByUserId: string | null;
  acceptedByUserId: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  lastSentAt: string | null;
  lastSendError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CustomerAccountState = {
  account: CustomerAccountRecord;
  activeOperators: CustomerAccountMembershipRecord[];
  pendingInvites: CustomerAccountInviteRecord[];
  seatLimit: number;
  activeOperatorCount: number;
  pendingInviteCount: number;
  usedSeats: number;
  availableSeats: number;
};

export type CustomerAccountInviteMutationResult = {
  invite: CustomerAccountInviteRecord;
  deliveryStatus: 'sent' | 'failed';
  deliveryError: string | null;
  loginUrl: string | null;
  accountName: string | null;
};

const mapPortalAccessContext = (
  record: PortalAccessContextRpcRecord | null | undefined
): PortalAccessContext => ({
  accountId: record?.account_id ?? null,
  accountRole: record?.account_role ?? null,
  accessTier: record?.access_tier ?? 'baseline',
  canManageOperators: Boolean(record?.can_manage_operators),
  isAdmin: Boolean(record?.is_admin),
});

const mapAccountRecord = (record: CustomerAccountRecordRow): CustomerAccountRecord => ({
  id: record.id,
  name: record.name,
  operatorSeatLimit: record.operator_seat_limit,
  createdAt: record.created_at,
  updatedAt: record.updated_at,
});

const mapMembershipRecord = (
  record: CustomerAccountMembershipRow
): CustomerAccountMembershipRecord => ({
  id: record.id,
  accountId: record.account_id,
  userId: record.user_id,
  email: record.email,
  role: record.role,
  invitedByUserId: record.invited_by_user_id,
  joinedAt: record.joined_at,
  revokedAt: record.revoked_at,
  createdAt: record.created_at,
  updatedAt: record.updated_at,
});

const mapInviteRecord = (record: CustomerAccountInviteRow): CustomerAccountInviteRecord => ({
  id: record.id,
  accountId: record.account_id,
  email: record.email,
  role: record.role,
  invitedByUserId: record.invited_by_user_id,
  acceptedByUserId: record.accepted_by_user_id,
  acceptedAt: record.accepted_at,
  revokedAt: record.revoked_at,
  revokeReason: record.revoke_reason,
  lastSentAt: record.last_sent_at,
  lastSendError: record.last_send_error,
  createdAt: record.created_at,
  updatedAt: record.updated_at,
});

const mapInviteMutationResponse = (
  data: CustomerAccountInviteMutationResponse
): CustomerAccountInviteMutationResult => {
  if (!data.invite) {
    throw new Error(data.error || 'Unable to manage invite.');
  }

  return {
    invite: mapInviteRecord(data.invite),
    deliveryStatus: data.deliveryStatus ?? 'sent',
    deliveryError: data.deliveryError ?? null,
    loginUrl: data.loginUrl ?? null,
    accountName: data.accountName ?? null,
  };
};

export const fetchPortalAccessContext = async (): Promise<PortalAccessContext> => {
  const { data, error } = await supabaseClient.rpc('get_portal_access_context');

  if (error) {
    throw new Error(error.message || 'Unable to load portal access.');
  }

  return mapPortalAccessContext((data as PortalAccessContextRpcRecord | null) ?? null);
};

export const acceptPendingInvite = async (): Promise<PortalAccessContext> => {
  const { data, error } = await supabaseClient.rpc('accept_customer_account_invite');

  if (error) {
    throw new Error(error.message || 'Unable to accept pending invite.');
  }

  return mapPortalAccessContext((data as PortalAccessContextRpcRecord | null) ?? null);
};

export const fetchCurrentAccountState = async (
  accountId: string
): Promise<CustomerAccountState> => {
  const [{ data: accountData, error: accountError }, { data: membershipsData, error: membershipsError }, { data: invitesData, error: invitesError }] =
    await Promise.all([
      supabaseClient
        .from('customer_accounts')
        .select('id,name,operator_seat_limit,created_at,updated_at')
        .eq('id', accountId)
        .single(),
      supabaseClient
        .from('customer_account_memberships')
        .select(
          'id,account_id,user_id,email,role,invited_by_user_id,joined_at,revoked_at,created_at,updated_at'
        )
        .eq('account_id', accountId)
        .eq('role', 'operator')
        .is('revoked_at', null)
        .order('joined_at', { ascending: true }),
      supabaseClient
        .from('customer_account_invites')
        .select(
          'id,account_id,email,role,invited_by_user_id,accepted_by_user_id,accepted_at,revoked_at,revoke_reason,last_sent_at,last_send_error,created_at,updated_at'
        )
        .eq('account_id', accountId)
        .eq('role', 'operator')
        .is('accepted_at', null)
        .is('revoked_at', null)
        .order('created_at', { ascending: false }),
    ]);

  if (accountError || !accountData) {
    throw new Error(accountError?.message || 'Unable to load account details.');
  }

  if (membershipsError) {
    throw new Error(membershipsError.message || 'Unable to load active operators.');
  }

  if (invitesError) {
    throw new Error(invitesError.message || 'Unable to load pending invites.');
  }

  const account = mapAccountRecord(accountData as CustomerAccountRecordRow);
  const activeOperators = ((membershipsData as CustomerAccountMembershipRow[] | null) ?? []).map(
    mapMembershipRecord
  );
  const pendingInvites = ((invitesData as CustomerAccountInviteRow[] | null) ?? []).map(
    mapInviteRecord
  );
  const usedSeats = activeOperators.length + pendingInvites.length;

  return {
    account,
    activeOperators,
    pendingInvites,
    seatLimit: account.operatorSeatLimit,
    activeOperatorCount: activeOperators.length,
    pendingInviteCount: pendingInvites.length,
    usedSeats,
    availableSeats: Math.max(0, account.operatorSeatLimit - usedSeats),
  };
};

export const createOperatorInvite = async (
  email: string
): Promise<CustomerAccountInviteMutationResult> =>
  mapInviteMutationResponse(
    await invokeEdgeFunction<CustomerAccountInviteMutationResponse>(
      'customer-account-team',
      {
        action: 'create_operator_invite',
        email,
      },
      {
        requireUserAuth: true,
        authErrorMessage: 'Log in to manage operator access.',
      }
    )
  );

export const resendInvite = async (
  inviteId: string
): Promise<CustomerAccountInviteMutationResult> =>
  mapInviteMutationResponse(
    await invokeEdgeFunction<CustomerAccountInviteMutationResponse>(
      'customer-account-team',
      {
        action: 'resend_invite',
        inviteId,
      },
      {
        requireUserAuth: true,
        authErrorMessage: 'Log in to manage operator access.',
      }
    )
  );

export const revokeInviteOrMembership = async ({
  inviteId,
  membershipId,
  reason,
}: {
  inviteId?: string;
  membershipId?: string;
  reason?: string;
}) => {
  const data = await invokeEdgeFunction<CustomerAccountRevokeMutationResponse>(
    'customer-account-team',
    {
      action: 'revoke_access',
      inviteId,
      membershipId,
      reason,
    },
    {
      requireUserAuth: true,
      authErrorMessage: 'Log in to manage operator access.',
    }
  );

  if (!data.result) {
    throw new Error(data.error || 'Unable to revoke access.');
  }

  return data.result;
};

export const adminInvitePartnerAccess = async ({
  email,
  accountName,
}: {
  email: string;
  accountName?: string;
}): Promise<CustomerAccountInviteMutationResult> =>
  mapInviteMutationResponse(
    await invokeEdgeFunction<CustomerAccountInviteMutationResponse>(
      'customer-account-team',
      {
        action: 'admin_invite_partner',
        email,
        accountName,
      },
      {
        requireUserAuth: true,
        authErrorMessage: 'Log in to provision partner access.',
      }
    )
  );
