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

export const fetchAdminLeadsDashboard = async (): Promise<AdminLeadsDashboard> => {
  const [leadResult, waitlistResult] = await Promise.all([
    supabaseClient
      .from('lead_submissions')
      .select(
        'id, submission_type, name, email, message, source_page, created_at, internal_notification_sent_at'
      )
      .order('created_at', { ascending: false }),
    supabaseClient
      .from('mini_waitlist_submissions')
      .select('id, product_slug, email, source_page, created_at, internal_notification_sent_at')
      .order('created_at', { ascending: false }),
  ]);

  if (leadResult.error || !leadResult.data) {
    throw new Error(leadResult.error?.message || 'Unable to load lead submissions.');
  }

  if (waitlistResult.error || !waitlistResult.data) {
    throw new Error(waitlistResult.error?.message || 'Unable to load Mini waitlist.');
  }

  return {
    leadSubmissions: leadResult.data as LeadSubmissionRecord[],
    miniWaitlist: waitlistResult.data as MiniWaitlistRecord[],
  };
};
