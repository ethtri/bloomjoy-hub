import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { supabaseClient } from '@/lib/supabaseClient';

export type SupportRequestType = 'concierge' | 'parts' | 'wechat_onboarding';
export type SupportRequestStatus =
  | 'new'
  | 'triaged'
  | 'waiting_on_customer'
  | 'resolved'
  | 'closed';
export type SupportRequestPriority = 'low' | 'normal' | 'high' | 'urgent';

export type SupportRequestIntakeMeta = {
  phone_region?: string;
  phone_number?: string;
  device_type?: string;
  blocked_step?: string;
  referral_needed?: boolean;
  wechat_id?: string;
};

export type SupportRequestRecord = {
  id: string;
  request_type: SupportRequestType;
  status: SupportRequestStatus;
  priority: SupportRequestPriority;
  customer_user_id: string;
  customer_email: string;
  subject: string;
  message: string;
  assigned_to: string | null;
  internal_notes: string | null;
  intake_meta: Record<string, unknown> | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
};

type SupportRequestIntakeResponse = {
  supportRequest: SupportRequestRecord;
};

type CreateSupportRequestInput = {
  requestType: SupportRequestType;
  subject: string;
  message: string;
  intakeMeta?: SupportRequestIntakeMeta;
};

type UpdateSupportRequestInput = {
  requestId: string;
  status: SupportRequestStatus;
  priority: SupportRequestPriority;
  assignedTo: string | null;
  internalNotes: string;
};

export const createSupportRequest = async ({
  requestType,
  subject,
  message,
  intakeMeta,
}: CreateSupportRequestInput): Promise<SupportRequestRecord> => {
  const data = await invokeEdgeFunction<SupportRequestIntakeResponse & { error?: string }>(
    'support-request-intake',
    {
      requestType,
      subject,
      message,
      intakeMeta: intakeMeta ?? {},
    },
    {
      requireUserAuth: true,
      authErrorMessage: 'Log in to submit a support request.',
    }
  );

  if (!data?.supportRequest) {
    throw new Error(data?.error || 'Unable to submit support request.');
  }

  return data.supportRequest;
};

export const fetchSupportRequests = async (): Promise<SupportRequestRecord[]> => {
  const { data, error } = await supabaseClient
    .from('support_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to load support requests.');
  }

  return data as SupportRequestRecord[];
};

export const updateSupportRequestAdmin = async ({
  requestId,
  status,
  priority,
  assignedTo,
  internalNotes,
}: UpdateSupportRequestInput): Promise<SupportRequestRecord> => {
  const { data, error } = await supabaseClient.rpc('admin_update_support_request', {
    p_request_id: requestId,
    p_status: status,
    p_priority: priority,
    p_assigned_to: assignedTo,
    p_internal_notes: internalNotes,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to update support request.');
  }

  return data as SupportRequestRecord;
};
