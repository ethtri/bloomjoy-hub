import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { supabaseClient } from '@/lib/supabaseClient';
export {
  getAccessInviteLoginUrl,
  resolveAccessInviteLoginOrigin,
  validateAccessInvitePreflight,
  type AccessInvitePreflight,
} from '@/lib/accessInviteLoginUrls';

export type AccessInviteType = 'corporate_partner' | 'technician' | 'machine_manager';
export type AccessInviteSourceType =
  | 'corporate_partner_membership'
  | 'technician_grant'
  | 'reporting_machine';

export type AccessInviteDelivery = {
  id: string;
  inviteType: AccessInviteType;
  sourceType: AccessInviteSourceType;
  sourceId: string;
  targetEmail: string;
  sentBy: string | null;
  sentAt: string;
  deliveryStatus: 'sent' | 'failed';
  errorMessage: string | null;
};

const asString = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const asNullableString = (value: unknown) => (typeof value === 'string' ? value : null);

const mapInviteDelivery = (item: Record<string, unknown>): AccessInviteDelivery => ({
  id: asString(item.id),
  inviteType: asString(item.invite_type, 'corporate_partner') as AccessInviteType,
  sourceType: asString(item.source_type, 'corporate_partner_membership') as AccessInviteSourceType,
  sourceId: asString(item.source_id),
  targetEmail: asString(item.target_email),
  sentBy: asNullableString(item.sent_by),
  sentAt: asString(item.sent_at),
  deliveryStatus: asString(item.delivery_status, 'sent') === 'failed' ? 'failed' : 'sent',
  errorMessage: asNullableString(item.error_message),
});

export const sendAccessInvite = async ({
  inviteType,
  sourceId,
  targetEmail,
  loginUrl,
}: {
  inviteType: AccessInviteType;
  sourceId: string;
  targetEmail: string;
  loginUrl: string;
}): Promise<void> => {
  await invokeEdgeFunction(
    'access-invite',
    {
      inviteType,
      sourceId,
      targetEmail,
      loginUrl,
    },
    {
      requireUserAuth: true,
      authErrorMessage: 'Log in as a Super Admin to send an access invite.',
    }
  );
};

export const fetchAccessInviteDeliveries = async ({
  inviteType,
  sourceType,
  sourceIds,
}: {
  inviteType?: AccessInviteType;
  sourceType: AccessInviteSourceType;
  sourceIds: string[];
}): Promise<AccessInviteDelivery[]> => {
  const uniqueSourceIds = [...new Set(sourceIds.filter(Boolean))];
  if (uniqueSourceIds.length === 0) return [];

  let query = supabaseClient
    .from('access_invite_deliveries')
    .select(
      'id, invite_type, source_type, source_id, target_email, sent_by, sent_at, delivery_status, error_message'
    )
    .eq('source_type', sourceType)
    .in('source_id', uniqueSourceIds);

  if (inviteType) {
    query = query.eq('invite_type', inviteType);
  }

  const { data, error } = await query.order('sent_at', { ascending: false });

  if (error) {
    throw new Error(error.message || 'Unable to load invite delivery history.');
  }

  return (Array.isArray(data) ? data : [])
    .map((item) => mapInviteDelivery(item as Record<string, unknown>))
    .filter((delivery) => delivery.id && delivery.sourceId);
};
