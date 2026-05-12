import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { supabaseClient } from '@/lib/supabaseClient';

export type RefundPaymentMethod = 'card' | 'cash' | 'unknown';
export type RefundCaseStatus =
  | 'submitted'
  | 'needs_review'
  | 'waiting_on_customer'
  | 'correlated'
  | 'approved'
  | 'denied'
  | 'card_refund_pending'
  | 'cash_zelle_pending'
  | 'completed'
  | 'closed';
export type RefundCorrelationStatus =
  | 'not_started'
  | 'matched'
  | 'no_match'
  | 'multiple_candidates'
  | 'needs_nayax'
  | 'nayax_not_configured'
  | 'manual_review';
export type RefundDecision = 'approved' | 'denied' | null;

export type RefundMachineOption = {
  machineId: string;
  machineLabel: string;
  locationId: string;
  locationName: string;
  locationTimezone: string;
};

type RefundMachineOptionRpc = {
  machine_id: string;
  machine_label: string;
  location_id: string;
  location_name: string;
  location_timezone: string;
};

export type RefundAttachmentInput = {
  fileName: string;
  contentType: string;
  byteSize: number;
  base64: string;
};

export type SubmitRefundRequestInput = {
  machineId: string;
  customerName?: string;
  customerEmail: string;
  customerPhone?: string;
  zellePaymentContact?: string;
  issueSummary: string;
  incidentAt: string;
  paymentMethod: RefundPaymentMethod;
  paymentAmount?: string;
  cardLast4?: string;
  cardWalletUsed?: boolean;
  attachments?: RefundAttachmentInput[];
};

export type SubmitRefundRequestResponse = {
  error?: string;
  refundCase?: {
    id: string;
    publicReference: string;
    status: RefundCaseStatus;
    correlationStatus: RefundCorrelationStatus;
  };
};

export type RefundCaseAttachment = {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  storageBucket: string;
  storagePath: string;
  uploadedAt: string;
};

export type RefundCaseEvent = {
  id: string;
  eventType: string;
  message: string | null;
  createdAt: string;
};

export type RefundCaseMessage = {
  id: string;
  messageType: string;
  status: string;
  recipientEmail: string;
  subject: string;
  body: string;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type RefundCaseRecord = {
  id: string;
  publicReference: string;
  status: RefundCaseStatus;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  correlationStatus: RefundCorrelationStatus;
  correlationSource: 'nayax' | 'sunze' | 'manual' | null;
  correlationConfidence: number;
  correlationSummary: string | null;
  machineLabel: string;
  locationName: string;
  customerEmail: string;
  customerName: string | null;
  customerPhone: string | null;
  zellePaymentContact: string | null;
  issueSummary: string;
  incidentAt: string;
  paymentMethod: RefundPaymentMethod;
  paymentAmountCents: number | null;
  cardLast4: string | null;
  cardWalletUsed: boolean;
  hasMatchedSalesFact: boolean;
  hasMatchedNayaxTransaction: boolean;
  matchedNayaxMachineAuthTime: string | null;
  matchedNayaxAmountCents: number | null;
  matchedNayaxCardLast4: string | null;
  matchedNayaxCurrencyCode: string | null;
  assignedManagerEmail: string | null;
  decision: RefundDecision;
  decisionReason: string | null;
  decidedAt: string | null;
  refundAmountCents: number | null;
  manualRefundReference: string | null;
  hasReportingAdjustment: boolean;
  createdAt: string;
  updatedAt: string;
  attachments: RefundCaseAttachment[];
  events: RefundCaseEvent[];
  messages: RefundCaseMessage[];
};

export type RefundAdminMachine = {
  id: string;
  machineLabel: string;
  nayaxLookupConfigured: boolean;
  locationName: string;
};

export type RefundManagerAssignment = {
  reportingMachineId: string;
  managerEmail: string;
};

export type RefundOperationsOverview = {
  cases: RefundCaseRecord[];
  machines: RefundAdminMachine[];
  managerAssignments: RefundManagerAssignment[];
};

export type RefundManagerSetupMachine = {
  id: string;
  machineLabel: string;
  locationName: string;
  nayaxLookupConfigured: boolean;
  managerEmails: string[];
};

export type RefundManagerSetup = {
  machines: RefundManagerSetupMachine[];
};

export type UpdateRefundCaseInput = {
  caseId: string;
  status: RefundCaseStatus;
  assignedManagerEmail?: string | null;
  decision?: RefundDecision;
  decisionReason?: string | null;
  internalNote?: string | null;
  refundAmountCents?: number | null;
  manualRefundReference?: string | null;
  clearNayaxMatch?: boolean;
  matchedNayaxTransactionId?: string | null;
  matchedNayaxSiteId?: number | null;
  matchedNayaxMachineAuthTime?: string | null;
  matchedNayaxAmountCents?: number | null;
  matchedNayaxCardLast4?: string | null;
  matchedNayaxCurrencyCode?: string | null;
};

export type NayaxLookupCandidate = {
  transactionId: string;
  siteId: number | null;
  authorizedAt: string;
  machineAuthorizationTime: string;
  amountCents: number | null;
  cardLast4: string;
  currencyCode: string;
  cardBrand: string;
  recognitionMethod: string;
  paymentStatus: string;
  matchConfidence: number;
  matchReason: string;
};

export type NayaxLookupResponse = {
  error?: string;
  configured: boolean;
  providerRecordCount?: number;
  providerParseableRecordCount?: number;
  providerWindowRecordCount?: number;
  candidates: NayaxLookupCandidate[];
  message?: string;
};

export const fetchRefundMachineOptions = async (): Promise<RefundMachineOption[]> => {
  const { data, error } = await supabaseClient.rpc('public_refund_machine_options');

  if (error) {
    throw new Error(error.message || 'Unable to load refund locations.');
  }

  return ((data as RefundMachineOptionRpc[] | null) ?? []).map((record) => ({
    machineId: record.machine_id,
    machineLabel: record.machine_label,
    locationId: record.location_id,
    locationName: record.location_name,
    locationTimezone: record.location_timezone,
  }));
};

export const submitRefundRequest = async (
  input: SubmitRefundRequestInput
): Promise<SubmitRefundRequestResponse['refundCase']> => {
  const data = await invokeEdgeFunction<SubmitRefundRequestResponse>('refund-case-intake', input);

  if (!data.refundCase) {
    throw new Error(data.error || 'Unable to submit refund request.');
  }

  return data.refundCase;
};

const emptyOverview: RefundOperationsOverview = {
  cases: [],
  machines: [],
  managerAssignments: [],
};

const emptyRefundManagerSetup: RefundManagerSetup = {
  machines: [],
};

const demoIsoHoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

export const canUseLocalUatDemoMode = () => {
  if (typeof window === 'undefined') return false;
  if (!import.meta.env.DEV) return false;

  const host = window.location.hostname;

  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
};

export const isLocalUatDemoForced = () => {
  if (!canUseLocalUatDemoMode()) return false;

  const searchParams = new URLSearchParams(window.location.search);

  return searchParams.get('demo') === 'on';
};

export const canUseLocalRefundDemoData = () => {
  if (!canUseLocalUatDemoMode()) return false;

  const searchParams = new URLSearchParams(window.location.search);

  return searchParams.get('demo') === 'on';
};

export const buildLocalRefundDemoOverview = (): RefundOperationsOverview => {
  const managerEmail = 'machine-manager@example.test';

  return {
    machines: [
      {
        id: 'demo-machine-card',
        machineLabel: 'Cotton Candy 01',
        locationName: 'Mall Atrium',
        nayaxLookupConfigured: true,
      },
      {
        id: 'demo-machine-cash',
        machineLabel: 'Cotton Candy 02',
        locationName: 'Arcade Hall',
        nayaxLookupConfigured: false,
      },
    ],
    managerAssignments: [
      {
        reportingMachineId: 'demo-machine-card',
        managerEmail,
      },
      {
        reportingMachineId: 'demo-machine-cash',
        managerEmail,
      },
    ],
    cases: [
      {
        id: 'demo-card-match',
        publicReference: 'RF-UAT-CARD',
        status: 'card_refund_pending',
        priority: 'normal',
        correlationStatus: 'matched',
        correlationSource: 'nayax',
        correlationConfidence: 0.97,
        correlationSummary: 'Card sale matched inside the incident window.',
        machineLabel: 'Cotton Candy 01',
        locationName: 'Mall Atrium',
        customerEmail: 'card-customer@example.test',
        customerName: 'Card Customer',
        customerPhone: null,
        zellePaymentContact: null,
        issueSummary: 'Machine spun but product did not dispense correctly.',
        incidentAt: demoIsoHoursAgo(5),
        paymentMethod: 'card',
        paymentAmountCents: 700,
        cardLast4: '4242',
        cardWalletUsed: true,
        hasMatchedSalesFact: false,
        hasMatchedNayaxTransaction: true,
        matchedNayaxMachineAuthTime: demoIsoHoursAgo(5),
        matchedNayaxAmountCents: 700,
        matchedNayaxCardLast4: '4242',
        matchedNayaxCurrencyCode: 'USD',
        assignedManagerEmail: managerEmail,
        decision: 'approved',
        decisionReason: 'Confirmed matching card transaction and customer report.',
        decidedAt: demoIsoHoursAgo(4),
        refundAmountCents: 700,
        manualRefundReference: '',
        hasReportingAdjustment: false,
        createdAt: demoIsoHoursAgo(6),
        updatedAt: demoIsoHoursAgo(2),
        attachments: [],
        events: [
          {
            id: 'demo-card-event-created',
            eventType: 'created',
            message: 'Case submitted from hosted refund form.',
            createdAt: demoIsoHoursAgo(6),
          },
          {
            id: 'demo-card-event-match',
            eventType: 'nayax_match_selected',
            message: 'Manager selected sanitized card lookup evidence.',
            createdAt: demoIsoHoursAgo(4.5),
          },
        ],
        messages: [
          {
            id: 'demo-card-message-confirmation',
            messageType: 'confirmation',
            status: 'sent',
            recipientEmail: 'card-customer@example.test',
            subject: 'We received your Bloomjoy refund request RF-UAT-CARD',
            body: 'Thanks for reaching out. Our team will review this with care.',
            sentAt: demoIsoHoursAgo(6),
            errorMessage: null,
            createdAt: demoIsoHoursAgo(6),
          },
        ],
      },
      {
        id: 'demo-cash-waiting',
        publicReference: 'RF-UAT-WAIT',
        status: 'waiting_on_customer',
        priority: 'normal',
        correlationStatus: 'no_match',
        correlationSource: 'sunze',
        correlationConfidence: 0,
        correlationSummary: 'No conservative cash match found for the reported time.',
        machineLabel: 'Cotton Candy 02',
        locationName: 'Arcade Hall',
        customerEmail: 'cash-customer@example.test',
        customerName: 'Cash Customer',
        customerPhone: '555-0100',
        zellePaymentContact: 'cash-customer@example.test',
        issueSummary: 'Paid cash and the machine did not start.',
        incidentAt: demoIsoHoursAgo(12),
        paymentMethod: 'cash',
        paymentAmountCents: 500,
        cardLast4: null,
        cardWalletUsed: false,
        hasMatchedSalesFact: false,
        hasMatchedNayaxTransaction: false,
        matchedNayaxMachineAuthTime: null,
        matchedNayaxAmountCents: null,
        matchedNayaxCardLast4: null,
        matchedNayaxCurrencyCode: null,
        assignedManagerEmail: managerEmail,
        decision: null,
        decisionReason: null,
        decidedAt: null,
        refundAmountCents: null,
        manualRefundReference: null,
        hasReportingAdjustment: false,
        createdAt: demoIsoHoursAgo(13),
        updatedAt: demoIsoHoursAgo(11),
        attachments: [],
        events: [
          {
            id: 'demo-cash-event-created',
            eventType: 'created',
            message: 'Case submitted from hosted refund form.',
            createdAt: demoIsoHoursAgo(13),
          },
          {
            id: 'demo-cash-event-more-info',
            eventType: 'more_info_requested',
            message: 'More information email sent.',
            createdAt: demoIsoHoursAgo(12.5),
          },
        ],
        messages: [
          {
            id: 'demo-cash-message-more-info',
            messageType: 'more_info',
            status: 'sent',
            recipientEmail: 'cash-customer@example.test',
            subject: 'A little more information for RF-UAT-WAIT',
            body: 'We want to make this right and need one more detail to find the transaction.',
            sentAt: demoIsoHoursAgo(12.5),
            errorMessage: null,
            createdAt: demoIsoHoursAgo(12.5),
          },
        ],
      },
      {
        id: 'demo-cash-completed',
        publicReference: 'RF-UAT-CASH',
        status: 'completed',
        priority: 'normal',
        correlationStatus: 'matched',
        correlationSource: 'sunze',
        correlationConfidence: 0.92,
        correlationSummary: 'Single cash sale matched within one hour and amount matched.',
        machineLabel: 'Cotton Candy 02',
        locationName: 'Arcade Hall',
        customerEmail: 'zelle-customer@example.test',
        customerName: 'Zelle Customer',
        customerPhone: '555-0101',
        zellePaymentContact: 'zelle-customer@example.test',
        issueSummary: 'Paid cash, product started, but did not finish correctly.',
        incidentAt: demoIsoHoursAgo(28),
        paymentMethod: 'cash',
        paymentAmountCents: 600,
        cardLast4: null,
        cardWalletUsed: false,
        hasMatchedSalesFact: true,
        hasMatchedNayaxTransaction: false,
        matchedNayaxMachineAuthTime: null,
        matchedNayaxAmountCents: null,
        matchedNayaxCardLast4: null,
        matchedNayaxCurrencyCode: null,
        assignedManagerEmail: managerEmail,
        decision: 'approved',
        decisionReason: 'Cash transaction matched and Zelle refund completed manually.',
        decidedAt: demoIsoHoursAgo(24),
        refundAmountCents: 600,
        manualRefundReference: 'Zelle demo reference',
        hasReportingAdjustment: true,
        createdAt: demoIsoHoursAgo(30),
        updatedAt: demoIsoHoursAgo(22),
        attachments: [],
        events: [
          {
            id: 'demo-zelle-event-created',
            eventType: 'created',
            message: 'Case submitted from hosted refund form.',
            createdAt: demoIsoHoursAgo(30),
          },
          {
            id: 'demo-zelle-event-completed',
            eventType: 'completed',
            message: 'Manual Zelle refund marked complete.',
            createdAt: demoIsoHoursAgo(22),
          },
        ],
        messages: [],
      },
    ],
  };
};

export const fetchRefundOperationsOverview = async (): Promise<RefundOperationsOverview> => {
  const { data, error } = await supabaseClient.rpc('admin_get_refund_operations_overview');

  if (error) {
    throw new Error(error.message || 'Unable to load refund operations.');
  }

  return {
    ...emptyOverview,
    ...((data as Partial<RefundOperationsOverview> | null) ?? {}),
  };
};

export const fetchRefundManagerSetup = async (): Promise<RefundManagerSetup> => {
  const { data, error } = await supabaseClient.rpc('admin_get_refund_manager_setup');

  if (error) {
    throw new Error(error.message || 'Unable to load machine manager setup.');
  }

  return {
    ...emptyRefundManagerSetup,
    ...((data as Partial<RefundManagerSetup> | null) ?? {}),
  };
};

export const updateRefundCaseAdmin = async (input: UpdateRefundCaseInput) => {
  const { data, error } = await supabaseClient.rpc('admin_update_refund_case', {
    p_case_id: input.caseId,
    p_status: input.status,
    p_assigned_manager_email: input.assignedManagerEmail ?? null,
    p_decision: input.decision ?? null,
    p_decision_reason: input.decisionReason ?? null,
    p_internal_note: input.internalNote ?? null,
    p_refund_amount_cents: input.refundAmountCents ?? null,
    p_manual_refund_reference: input.manualRefundReference ?? null,
    p_clear_nayax_match: input.clearNayaxMatch ?? false,
    p_matched_nayax_transaction_id: input.matchedNayaxTransactionId ?? null,
    p_matched_nayax_site_id: input.matchedNayaxSiteId ?? null,
    p_matched_nayax_machine_auth_time: input.matchedNayaxMachineAuthTime ?? null,
    p_matched_nayax_amount_cents: input.matchedNayaxAmountCents ?? null,
    p_matched_nayax_card_last4: input.matchedNayaxCardLast4 ?? null,
    p_matched_nayax_currency_code: input.matchedNayaxCurrencyCode ?? null,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to update refund case.');
  }

  return data as Record<string, unknown>;
};

export const setMachineRefundManagersAdmin = async ({
  machineId,
  managerEmails,
  reason,
}: {
  machineId: string;
  managerEmails: string[];
  reason: string;
}) => {
  const { data, error } = await supabaseClient.rpc(
    'admin_set_reporting_machine_refund_managers',
    {
      p_machine_id: machineId,
      p_manager_emails: managerEmails,
      p_reason: reason,
    }
  );

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save machine managers.');
  }

  return data as Record<string, unknown>;
};

export const setMachineNayaxConfigAdmin = async ({
  machineId,
  nayaxMachineId,
  nayaxAccountKey,
  reason,
}: {
  machineId: string;
  nayaxMachineId: string | null;
  nayaxAccountKey: string | null;
  reason: string;
}) => {
  const { data, error } = await supabaseClient.rpc('admin_set_reporting_machine_nayax_config', {
    p_machine_id: machineId,
    p_nayax_machine_id: nayaxMachineId,
    p_nayax_account_key: nayaxAccountKey,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save Nayax setup.');
  }

  return data as Record<string, unknown>;
};

export const lookupNayaxTransactions = async ({
  caseId,
  incidentAt,
  amountCents,
  cardLast4,
  cardWalletUsed,
}: {
  caseId: string;
  incidentAt: string;
  amountCents: number | null;
  cardLast4: string | null;
  cardWalletUsed: boolean;
}): Promise<NayaxLookupResponse> =>
  invokeEdgeFunction<NayaxLookupResponse>(
    'nayax-transaction-lookup',
    {
      caseId,
      incidentAt,
      amountCents,
      cardLast4,
      cardWalletUsed,
    },
    {
      requireUserAuth: true,
      authErrorMessage: 'Log in to look up Nayax transactions.',
    }
  );

export const createRefundAttachmentSignedUrl = async (
  attachment: Pick<RefundCaseAttachment, 'storageBucket' | 'storagePath'>
) => {
  const { data, error } = await supabaseClient.storage
    .from(attachment.storageBucket)
    .createSignedUrl(attachment.storagePath, 60 * 10);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Unable to open attachment.');
  }

  return data.signedUrl;
};
