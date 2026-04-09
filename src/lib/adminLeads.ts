import { supabaseClient } from '@/lib/supabaseClient';

export type LeadSubmissionType = 'quote' | 'demo' | 'procurement' | 'general';

export type LeadSubmissionRecord = {
  id: string;
  submission_type: LeadSubmissionType;
  name: string;
  email: string;
  message: string;
  source_page: string;
  created_at: string;
  internal_notification_sent_at: string | null;
};

export type MiniWaitlistRecord = {
  id: string;
  product_slug: string;
  email: string;
  source_page: string;
  created_at: string;
  internal_notification_sent_at: string | null;
};

export type AdminLeadsDashboard = {
  leadSubmissions: LeadSubmissionRecord[];
  miniWaitlist: MiniWaitlistRecord[];
};

const isMissingWaitlistNotificationColumn = (code?: string, message?: string) =>
  code === '42703' &&
  typeof message === 'string' &&
  message.includes('mini_waitlist_submissions.internal_notification_sent_at');

const normalizeMiniWaitlistRecords = (
  rows: Array<Omit<MiniWaitlistRecord, 'internal_notification_sent_at'> & {
    internal_notification_sent_at?: string | null;
  }>
): MiniWaitlistRecord[] =>
  rows.map((row) => ({
    ...row,
    internal_notification_sent_at: row.internal_notification_sent_at ?? null,
  }));

export const fetchAdminLeadsDashboard = async (): Promise<AdminLeadsDashboard> => {
  const leadPromise = supabaseClient
    .from('lead_submissions')
    .select(
      'id, submission_type, name, email, message, source_page, created_at, internal_notification_sent_at'
    )
    .order('created_at', { ascending: false });

  const waitlistPromise = supabaseClient
    .from('mini_waitlist_submissions')
    .select('id, product_slug, email, source_page, created_at, internal_notification_sent_at')
    .order('created_at', { ascending: false });

  const [leadResult, waitlistResult] = await Promise.all([
    leadPromise,
    waitlistPromise,
  ]);

  if (leadResult.error || !leadResult.data) {
    throw new Error(leadResult.error?.message || 'Unable to load lead submissions.');
  }

  if (!waitlistResult.error && waitlistResult.data) {
    return {
      leadSubmissions: leadResult.data as LeadSubmissionRecord[],
      miniWaitlist: waitlistResult.data as MiniWaitlistRecord[],
    };
  }

  if (
    !isMissingWaitlistNotificationColumn(
      waitlistResult.error?.code,
      waitlistResult.error?.message
    )
  ) {
    throw new Error(waitlistResult.error?.message || 'Unable to load Mini waitlist.');
  }

  const fallbackWaitlistResult = await supabaseClient
    .from('mini_waitlist_submissions')
    .select('id, product_slug, email, source_page, created_at')
    .order('created_at', { ascending: false });

  if (fallbackWaitlistResult.error || !fallbackWaitlistResult.data) {
    throw new Error(fallbackWaitlistResult.error?.message || 'Unable to load Mini waitlist.');
  }

  return {
    leadSubmissions: leadResult.data as LeadSubmissionRecord[],
    miniWaitlist: normalizeMiniWaitlistRecords(
      fallbackWaitlistResult.data as Array<
        Omit<MiniWaitlistRecord, 'internal_notification_sent_at'>
      >
    ),
  };
};
