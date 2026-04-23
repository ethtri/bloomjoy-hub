import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { trackEvent } from '@/lib/analytics';
import {
  buildLeadAttributionPayload,
  type MarketingAttribution,
} from '@/lib/marketingAttribution';

type LeadSubmissionType = 'quote' | 'demo' | 'procurement' | 'general';
export type LeadAudienceSegment =
  | 'commercial_operator'
  | 'event_operator'
  | 'venue_or_procurement'
  | 'consumer_home_buyer'
  | 'not_sure';
export type LeadPurchaseTimeline =
  | 'now_30_days'
  | 'one_to_three_months'
  | 'three_to_six_months'
  | 'six_plus_months'
  | 'not_sure';
export type LeadBudgetStatus =
  | 'budget_approved'
  | 'procurement_started'
  | 'evaluating_budget'
  | 'no_budget_yet'
  | 'not_sure';
type LeadQualificationGrade = 'A' | 'B' | 'C';

type CreateLeadSubmissionInput = {
  submissionType: LeadSubmissionType;
  name: string;
  email: string;
  message: string;
  companyName?: string;
  machineInterest?: string;
  audienceSegment?: LeadAudienceSegment;
  purchaseTimeline?: LeadPurchaseTimeline;
  budgetStatus?: LeadBudgetStatus;
  plusInterest?: boolean;
  marketingConsent?: boolean;
  sourcePage?: string;
  attribution?: MarketingAttribution;
};

type LeadSubmissionResponse = {
  error?: string;
  qualificationGrade?: LeadQualificationGrade;
};

export const createLeadSubmission = async ({
  submissionType,
  name,
  email,
  message,
  companyName,
  machineInterest,
  audienceSegment,
  purchaseTimeline,
  budgetStatus,
  plusInterest = false,
  marketingConsent = false,
  sourcePage = '/contact',
  attribution,
}: CreateLeadSubmissionInput) => {
  const leadAttribution = attribution ?? buildLeadAttributionPayload(sourcePage);
  const data = await invokeEdgeFunction<LeadSubmissionResponse>(
    'lead-submission-intake',
    {
      submissionType,
      name,
      email,
      message,
      companyName,
      machineInterest,
      audienceSegment,
      purchaseTimeline,
      budgetStatus,
      plusInterest,
      marketingConsent,
      sourcePage,
      attribution: leadAttribution,
      clientSubmissionId: crypto.randomUUID(),
    }
  );

  if (data?.error) {
    throw new Error(data.error);
  }

  trackEvent('submit_lead_form', {
    submission_type: submissionType,
    source_page: sourcePage,
    machine_interest: machineInterest,
    audience_segment: audienceSegment,
    purchase_timeline: purchaseTimeline,
    budget_status: budgetStatus,
    plus_interest: plusInterest,
    marketing_consent: marketingConsent,
  });

  if (data?.qualificationGrade) {
    trackEvent('lead_qualification_assigned', {
      submission_type: submissionType,
      qualification_grade: data.qualificationGrade,
      machine_interest: machineInterest,
      audience_segment: audienceSegment,
    });
  }
};
