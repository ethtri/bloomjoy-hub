import { supabaseClient } from '@/lib/supabaseClient';

export type SupportRequestType = 'concierge' | 'parts';
export type SupportRequestStatus =
  | 'new'
  | 'triaged'
  | 'waiting_on_customer'
  | 'resolved'
  | 'closed';
export type SupportRequestPriority = 'low' | 'normal' | 'high' | 'urgent';

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
}: CreateSupportRequestInput): Promise<SupportRequestRecord> => {
  const { data, error } = await supabaseClient.functions.invoke<SupportRequestIntakeResponse>(
    'support-request-intake',
    {
      body: {
        requestType,
        subject,
        message,
      },
    }
  );

  if (error || !data?.supportRequest) {
    throw new Error(error?.message || 'Unable to submit support request.');
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
