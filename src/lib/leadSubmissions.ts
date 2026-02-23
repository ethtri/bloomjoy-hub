import { supabaseClient } from '@/lib/supabaseClient';

type LeadSubmissionType = 'quote' | 'demo' | 'procurement' | 'general';

type CreateLeadSubmissionInput = {
  submissionType: LeadSubmissionType;
  name: string;
  email: string;
  message: string;
  sourcePage?: string;
};

export const createLeadSubmission = async ({
  submissionType,
  name,
  email,
  message,
  sourcePage = '/contact',
}: CreateLeadSubmissionInput) => {
  const { error } = await supabaseClient.from('lead_submissions').insert({
    submission_type: submissionType,
    name,
    email,
    message,
    source_page: sourcePage,
  });

  if (error) {
    throw new Error(error.message || 'Unable to submit contact request.');
  }
};
