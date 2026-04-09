import { invokeEdgeFunction } from '@/lib/edgeFunctions';

type LeadSubmissionType = 'quote' | 'demo' | 'procurement' | 'general';

type CreateLeadSubmissionInput = {
  submissionType: LeadSubmissionType;
  name: string;
  email: string;
  message: string;
  machineInterest?: string;
  sourcePage?: string;
  website?: string;
};

export const createLeadSubmission = async ({
  submissionType,
  name,
  email,
  message,
  machineInterest,
  sourcePage = '/contact',
  website = '',
}: CreateLeadSubmissionInput) => {
  const data = await invokeEdgeFunction<{ error?: string }>(
    'lead-submission-intake',
    {
      submissionType,
      name,
      email,
      message,
      machineInterest,
      sourcePage,
      website,
      clientSubmissionId: crypto.randomUUID(),
    }
  );

  if (data?.error) {
    throw new Error(data.error);
  }
};
