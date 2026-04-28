import { invokeEdgeFunction } from '@/lib/edgeFunctions';

type LeadSubmissionType = 'quote' | 'demo' | 'procurement' | 'general';

type CreateLeadSubmissionInput = {
  submissionType: LeadSubmissionType;
  name: string;
  email: string;
  message: string;
  metadata?: Record<string, unknown>;
  machineInterest?: string;
  sourcePage?: string;
};

export const createLeadSubmission = async ({
  submissionType,
  name,
  email,
  message,
  metadata,
  machineInterest,
  sourcePage = '/contact',
}: CreateLeadSubmissionInput) => {
  const data = await invokeEdgeFunction<{ error?: string }>(
    'lead-submission-intake',
    {
      submissionType,
      name,
      email,
      message,
      metadata,
      machineInterest,
      sourcePage,
      clientSubmissionId: crypto.randomUUID(),
    }
  );

  if (data?.error) {
    throw new Error(data.error);
  }
};
