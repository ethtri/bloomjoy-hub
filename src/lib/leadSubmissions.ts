import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { buildLeadAttributionPayload } from '@/lib/leadAttribution';

type LeadSubmissionType = 'quote' | 'demo' | 'procurement' | 'general';

type CreateLeadSubmissionInput = {
  submissionType: LeadSubmissionType;
  name: string;
  email: string;
  message: string;
  metadata?: Record<string, unknown>;
  machineInterest?: string;
  sourcePage?: string;
  clientSubmissionId?: string;
};

export const createLeadSubmission = async ({
  submissionType,
  name,
  email,
  message,
  metadata,
  machineInterest,
  sourcePage = '/contact',
  clientSubmissionId = crypto.randomUUID(),
}: CreateLeadSubmissionInput) => {
  const data = await invokeEdgeFunction<{ error?: string }>(
    'lead-submission-intake',
    {
      submissionType,
      name,
      email,
      message,
      metadata,
      attribution: buildLeadAttributionPayload({ sourcePage, machineInterest }),
      machineInterest,
      sourcePage,
      clientSubmissionId,
    }
  );

  if (data?.error) {
    throw new Error(data.error);
  }
};
