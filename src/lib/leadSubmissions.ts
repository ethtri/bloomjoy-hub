import { supabaseClient } from '@/lib/supabaseClient';

type LeadSubmissionType = 'quote' | 'demo' | 'procurement' | 'general';

type CreateLeadSubmissionInput = {
  submissionType: LeadSubmissionType;
  name: string;
  email: string;
  message: string;
  machineInterest?: string;
  sourcePage?: string;
};

export const createLeadSubmission = async ({
  submissionType,
  name,
  email,
  message,
  machineInterest,
  sourcePage = '/contact',
}: CreateLeadSubmissionInput) => {
  const { data, error } = await supabaseClient.functions.invoke<{ error?: string }>(
    'lead-submission-intake',
    {
      body: {
        submissionType,
        name,
        email,
        message,
        machineInterest,
        sourcePage,
        clientSubmissionId: crypto.randomUUID(),
      },
    }
  );

  if (error) {
    throw new Error(error.message || 'Unable to submit contact request.');
  }

  if (data?.error) {
    throw new Error(data.error);
  }
};
