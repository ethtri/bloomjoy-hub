import { supabaseClient } from '@/lib/supabaseClient';
import type { PublishedPayStub } from '@/lib/publishedPayStub';

export type OperatorWorkerType =
  | 'contractor_1099'
  | 'employee_w2'
  | 'part_time_employee'
  | 'owner_operator'
  | 'partner'
  | 'other'
  | 'unspecified';

export type PayoutFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

export type PayoutRoundingRule =
  | 'none'
  | 'round_up_15_minutes'
  | 'round_up_30_minutes'
  | 'round_up_60_minutes'
  | 'round_nearest_15_minutes'
  | 'round_nearest_30_minutes'
  | 'custom';

export type PayoutReviewModel = 'final_review_only' | 'per_entry_approval' | 'no_review_required';

export type OperatorPayoutProfileStatus = 'active' | 'inactive';

export type TimeEntryStatus =
  | 'draft'
  | 'submitted'
  | 'locked'
  | 'included_in_payout'
  | 'paid'
  | 'voided';

export type TimeEntryManagerReviewStatus = 'pending' | 'approved' | 'needs_correction';

export type PayStatementStatus = 'draft' | 'issued' | 'revised' | 'voided';

export type OperatorAssignedMachine = {
  assignmentId: string;
  machineId: string;
  machineLabel: string;
  locationId: string;
  locationName: string;
  locationTimezone: string;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
};

export type OperatorIssuedStatement = {
  id: string;
  statementNumber: string;
  statementLabel: string;
  status: Extract<PayStatementStatus, 'issued' | 'revised'>;
  version: number;
  issuedAt: string | null;
  storageBucket: string;
  storagePath: string | null;
  totalPayoutCents: number;
  periodStartDate: string;
  periodEndDate: string;
};

export type OperatorPayStatementSummary = OperatorIssuedStatement & {
  notificationStatus:
    | 'not_sent'
    | 'portal_published'
    | 'email_queued'
    | 'email_sent'
    | 'failed'
    | 'skipped';
  targetPayoutDate: string;
  revisionCount: number;
  downloadFileName: string;
};

export type OperatorPayStatementProfileContext = {
  id: string;
  accountId: string;
  accountName: string;
  displayName: string;
  workerType: OperatorWorkerType;
  statements: OperatorPayStatementSummary[];
};

export type OperatorPayStatementContext = {
  profiles: OperatorPayStatementProfileContext[];
};

export type OperatorPayStatementPayloadMachine = {
  machineId: string;
  machineLabel: string;
  locationId: string;
  locationName: string;
  rawMinutes: number;
  roundedPaidMinutes: number;
  paidHours: number;
  shiftCount: number;
  netRevenueCents: number;
  eligibleNetRevenueCents: number;
  commissionBasisPoints: number | null;
  commissionPayCents: number;
  includedInCommissionBasis: boolean;
};

export type OperatorPayStatementPayloadAdjustment = {
  id: string;
  amountCents: number;
  adjustmentType: string;
  description: string;
  createdAt: string;
};

export type OperatorPayStatementPayload = {
  schemaVersion: 'operator-pay-statement-v1';
  id: string | null;
  statementNumber: string;
  statementLabel: string;
  status: 'draft' | 'issued' | 'revised';
  version: number;
  generatedAt: string;
  issuedAt: string | null;
  revision?: {
    revisedFromStatementId?: string | null;
    revisionReason?: string | null;
  };
  revisionReason?: string | null;
  entity: {
    accountId: string;
    name: string;
    legalName?: string | null;
    contactEmail?: string | null;
    logoStoragePath?: string | null;
    address?: {
      line1?: string | null;
      line2?: string | null;
      city?: string | null;
      state?: string | null;
      postalCode?: string | null;
    };
  };
  operator: {
    operatorProfileId: string;
    displayName: string;
    workerType: OperatorWorkerType;
  };
  period: {
    payoutPeriodId: string;
    periodStartDate: string;
    periodEndDate: string;
    targetPayoutDate: string;
  };
  payoutRun: {
    id: string;
    status: PayoutRunStatus;
    finalizedAt: string | null;
    issuedAt: string | null;
  };
  time: {
    rawMinutes: number;
    roundedPaidMinutes: number;
    rawHours: number;
    paidHours: number;
    shiftCount: number;
  };
  revenueBasis: {
    eligibleNetRevenueCents: number;
    commissionBasisPoints: number | null;
    commissionRatePercent: number | null;
  };
  totals: {
    hourlyRateCents: number | null;
    hourlyPayCents: number;
    commissionPayCents: number;
    adjustmentsTotalCents: number;
    totalPayoutCents: number;
  };
  machines: OperatorPayStatementPayloadMachine[];
  adjustments: OperatorPayStatementPayloadAdjustment[];
  disclaimer: string;
  automation: {
    rawProviderPayloadsIncluded: false;
    taxComplianceEngine: false;
    payrollProviderExecution: false;
    artifactSource: 'database_payload';
  };
};

export type OperatorPayStubPayload = PublishedPayStub;

export type OperatorPayStatementArtifact = {
  statement: OperatorPayStatementPayload | OperatorPayStubPayload;
  artifact: {
    format: 'html' | 'pdf';
    source: 'database_payload' | 'private_storage';
    storageBucket: string;
    storagePath: string | null;
    downloadFileName: string;
  };
};

export const formatOperatorPayStatementLabel = (label: string | null | undefined) => {
  const trimmedLabel = label?.trim();

  if (!trimmedLabel) return 'Pay Statement';

  return trimmedLabel;
};

const getLocalDateInputValue = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

export type OperatorPayoutPolicyContext = {
  id: string;
  name: string;
  frequency: PayoutFrequency;
  roundingRule: PayoutRoundingRule;
  reviewModel: PayoutReviewModel;
};

export type OperatorPayoutPeriodContext = {
  id: string;
  periodStartDate: string;
  periodEndDate: string;
  submissionDueDate: string;
  lockDate: string;
  targetPayoutDate: string;
  status:
    | 'open'
    | 'grace_period'
    | 'locked'
    | 'review'
    | 'draft_payout'
    | 'finalized'
    | 'issued'
    | 'closed'
    | 'reopened'
    | 'voided';
};

export type OperatorTimeEntry = {
  id: string;
  accountId: string;
  operatorProfileId: string;
  machineId: string;
  machineLabel: string;
  locationId: string;
  locationName: string;
  locationTimezone: string;
  payoutPolicyId: string;
  payoutPeriodId: string;
  workDate: string;
  startTime: string;
  endTime: string;
  actualStartAt: string;
  actualEndAt: string;
  actualDurationMinutes: number;
  rawDurationMinutes: number;
  paidShifts: number;
  roundedPaidMinutes: number;
  notes: string | null;
  status: TimeEntryStatus;
  managerReviewStatus: TimeEntryManagerReviewStatus;
  managerReviewReason: string | null;
  managerReviewedAt: string | null;
  technicianCutoffAt: string;
  technicianEditable: boolean;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PayoutRevenueSnapshotStatus =
  | 'source_generated'
  | 'manual_override'
  | 'voided';

export type OperatorCompensationRuleStatus = 'active' | 'inactive';

export type PayoutRunStatus =
  | 'draft'
  | 'review'
  | 'finalized'
  | 'issued'
  | 'closed'
  | 'reopened'
  | 'voided';

export type OperatorPayoutProfileContext = {
  id: string;
  accountId: string;
  accountName: string;
  displayName: string;
  workerType: OperatorWorkerType;
  status: OperatorPayoutProfileStatus;
  payoutPolicyId: string | null;
  assignedMachines: OperatorAssignedMachine[];
  issuedStatements: OperatorIssuedStatement[];
};

export type OperatorTimekeepingProfileContext = Omit<
  OperatorPayoutProfileContext,
  'payoutPolicyId' | 'issuedStatements'
> & {
  policy: OperatorPayoutPolicyContext;
  currentPeriod: OperatorPayoutPeriodContext;
  currentEntries: OperatorTimeEntry[];
  recentEntries: OperatorTimeEntry[];
};

export type OperatorTimekeepingContext = {
  workDate: string;
  profiles: OperatorTimekeepingProfileContext[];
};

export type OperatorTimeReviewMachine = {
  machineId: string;
  machineLabel: string;
  locationId: string;
  locationName: string;
};

export type OperatorTimeReviewEntry = OperatorTimeEntry & {
  accountName: string;
  operatorName: string;
};

export type OperatorTimeReportTechnician = {
  operatorProfileId: string;
  operatorName: string;
  actualDurationMinutes: number;
  paidShifts: number;
  entryCount: number;
  machines: OperatorTimeReviewMachine[];
};

export type OperatorTimeReviewEntryOption = {
  operatorProfileId: string;
  operatorName: string;
  machineId: string;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
};

export type OperatorTimeReviewContext = {
  workDate: string;
  periodStartDate: string;
  periodEndDate: string;
  hasAccess: boolean;
  machines: OperatorTimeReviewMachine[];
  technicians: OperatorTimeReportTechnician[];
  entryOptions: OperatorTimeReviewEntryOption[];
  entries: OperatorTimeReviewEntry[];
  capabilities: {
    canCorrectTime: boolean;
    approvalRequired: false;
    paymentExecution: false;
  };
};

export type TechnicianPayReportIssue = {
  code: string;
  severity: 'info' | 'warning' | 'blocker';
  message: string;
  operatorProfileId?: string;
  machineId?: string;
  timeEntryId?: string;
  [key: string]: unknown;
};

export type TechnicianPayReportRate = {
  ruleId: string;
  rateType: OperatorCompensationRateType;
  source: 'technician_default' | 'technician_machine_override';
  shiftRateCents: number | null;
  commissionBasisPoints: number | null;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
};

export type TechnicianPayReportEntry = {
  id: string;
  workDate: string;
  actualStartAt: string;
  actualEndAt: string;
  actualDurationMinutes: number;
  paidShifts: number;
  machineId: string;
  machineLabel: string;
  locationId: string;
  locationName: string;
  shiftRate: TechnicianPayReportRate | null;
  shiftRateCents: number | null;
  shiftEarningsCents: number;
};

export type TechnicianPayReportShiftRateLine = {
  machineId?: string | null;
  machineLabel?: string | null;
  locationName?: string | null;
  shiftRateCents: number | null;
  paidShifts: number;
  actualDurationMinutes: number;
  shiftEarningsCents: number;
  firstWorkDate: string;
  lastWorkDate: string;
};

export type TechnicianPayReportCommissionSegment = {
  segmentStartDate: string;
  segmentEndDate: string;
  commissionRate: TechnicianPayReportRate | null;
  commissionBasisPoints: number | null;
  grossSalesCents: number | null;
  refundAdjustmentCents: number | null;
  refundRequestDeductionCents?: number;
  refundReversalCents?: number;
  refundPaidContextCents?: number;
  refundOutstandingContextCents?: number;
  purchaseAttributionDate?: string;
  normalizationStatus?: string;
  taxRatePercent: number | null;
  taxCents: number | null;
  netRevenueCents: number | null;
  commissionableSalesCents: number | null;
  commissionEarningsCents: number;
  sourceSalesRowCount: number;
  sourceAdjustmentRowCount: number;
  sourceLatestSaleDate: string | null;
};

export type TechnicianPayReportMachine = {
  machineId: string;
  machineLabel: string;
  locationId: string;
  locationName: string;
  assignedStartDate: string;
  assignedEndDate: string;
  assignmentScopeResolved: boolean;
  fullPeriodAssignment: boolean;
  commissionAllocationResolved: boolean;
  commissionRateCompleteForPeriod: boolean;
  taxRateCompleteForSales: boolean;
  revenueSnapshotId: string | null;
  revenueSnapshotStatus: PayoutRevenueSnapshotStatus | null;
  revenueGeneratedAt: string | null;
  sourceLatestSaleDate: string | null;
  sourceSalesRowCount: number;
  sourceAdjustmentRowCount: number;
  grossSalesCents: number | null;
  refundAdjustmentCents: number | null;
  taxCents: number | null;
  netRevenueCents: number | null;
  commissionableSalesCents: number | null;
  commissionRate: TechnicianPayReportRate | null;
  commissionBasisPoints: number | null;
  commissionEarningsCents: number;
  commissionSegments: TechnicianPayReportCommissionSegment[];
  snapshotGrossSalesCents: number | null;
  snapshotRefundAdjustmentCents: number | null;
  snapshotTaxCents: number | null;
  snapshotNetRevenueCents: number | null;
  snapshotCommissionableSalesCents: number | null;
  snapshotSourceLatestSaleDate: string | null;
  snapshotMatchesFacts: boolean;
  warnings: TechnicianPayReportIssue[];
};

export type TechnicianPayReportAssignment = {
  assignmentId: string;
  machineId: string;
  machineLabel: string;
  locationId: string;
  locationName: string;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  status: 'active' | 'revoked';
  editable: boolean;
  overlapsSelectedPeriod: boolean;
  selectedPeriodGrossSalesCents: number;
};

export type TechnicianPayReportOtherEarning = {
  id: string;
  type: OperatorRecurringCompensationItemType;
  description: string;
  amountCents: number;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
};

export type TechnicianPayReportTechnician = {
  operatorProfileId: string;
  accountId: string;
  displayName: string;
  workerType: OperatorWorkerType;
  workerIdentifier: string | null;
  positionTitle: string;
  contactEmail: string | null;
  contactPhone: string | null;
  mailingAddress: string | null;
  periodStartDate: string;
  periodEndDate: string;
  actualDurationMinutes: number;
  paidShifts: number;
  shiftEarningsCents: number;
  taxCents: number;
  commissionableSalesCents: number;
  commissionEarningsCents: number;
  bonusCents: number;
  supplyCreditCents: number;
  expenseReimbursementCents: number;
  currentTotalCents: number;
  publishable: boolean;
  payStubRegenerationRequired?: boolean;
  payStubPublication?: {
    status: 'queued' | 'processing' | 'blocked' | 'failed' | 'issued' | 'not_generated';
    retryAfter?: string | null;
    errorMessage?: string | null;
  };
  entries: TechnicianPayReportEntry[];
  shiftRateLines: TechnicianPayReportShiftRateLine[];
  machines: TechnicianPayReportMachine[];
  assignments: TechnicianPayReportAssignment[];
  otherEarnings: TechnicianPayReportOtherEarning[];
  blockers: TechnicianPayReportIssue[];
  warnings: TechnicianPayReportIssue[];
  calculationMeta: {
    schemaVersion: 'technician-pay-report-v1' | 'technician-pay-report-v2';
    commissionBasisSource: string;
    commissionFormula?: string;
    salesCalculationVersion?: string;
    refundRecognition?: string;
    paymentCreatesRefundImpact?: boolean;
    refundAppliedOnce: true;
    approvalRequired: false;
    paymentExecution: false;
    taxCalculation: boolean;
    taxRounding?: string;
    periodInProgress?: boolean;
    asOfDate?: string;
    salesThroughDate?: string | null;
    hasAssignmentInPeriod?: boolean;
    freshnessPolicy?: string;
  };
};

export type TechnicianPayReportContext = {
  month: string;
  periodStartDate: string;
  periodEndDate: string;
  asOfDate?: string;
  hasAccess: boolean;
  accounts: Array<{ accountId: string; accountName: string }>;
  technicians: TechnicianPayReportTechnician[];
  capabilities: {
    accountPayAuthorityRequired: true;
    canCorrectTime: false;
    approvalRequired: false;
    paymentExecution: false;
    taxCalculation: boolean;
  };
};

export type TimekeepingSetupMachine = {
  machineId: string;
  machineLabel: string;
  locationName: string | null;
  operationalPhase: 'setup' | 'live';
};

export type TimekeepingSetupAccount = {
  accountId: string;
  accountName: string;
  machines: TimekeepingSetupMachine[];
};

export type TimekeepingSetupContext = {
  accounts: TimekeepingSetupAccount[];
  capabilities: {
    accountPayAuthorityRequired: true;
    approvalRequired: false;
    paymentExecution: false;
  };
};

export type TimekeepingMachineCompensation = {
  machineId: string;
  shiftRateCents: number;
  commissionBasisPoints: number;
  commissionEffectiveStartDate: string;
};

export type SetupTimekeepingTechnicianInput = {
  payerAccountId: string;
  userEmail: string;
  displayName: string;
  workerType: OperatorWorkerType;
  workerIdentifier?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  mailingAddress?: string | null;
  effectiveStartDate: string;
  machineCompensation: TimekeepingMachineCompensation[];
};

export type UpdateOperatorContactInput = {
  operatorProfileId: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  mailingAddress?: string | null;
};

export type SetupTimekeepingTechnicianResult = {
  displayName: string;
  profiles: Array<{ operatorProfileId: string; accountId: string }>;
  machineCount: number;
  payerCount: number;
  effectiveStartDate: string;
};

export type OperatorContactRecord = {
  user_id: string;
  contact_email: string | null;
  contact_phone: string | null;
  mailing_address: string | null;
  created_at: string;
  updated_at: string;
};

export type UpsertEffectiveOperatorMachineAssignmentInput = {
  assignmentId?: string | null;
  operatorProfileId: string;
  machineId: string;
  effectiveStartDate: string;
  effectiveEndDate?: string | null;
};

export type EffectiveOperatorMachineAssignment = {
  id: string;
  operatorProfileId: string;
  machineId: string;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  status: 'active';
};

export type SaveCompletedOperatorTimeEntryInput = {
  timeEntryId?: string | null;
  operatorProfileId: string;
  machineId: string;
  actualStartAt: string;
  actualEndAt: string;
  notes?: string | null;
};

export type SaveCompletedOperatorTimeEntryResult = {
  timeEntry: OperatorTimeEntry;
  context: OperatorTimekeepingContext;
};

export type CorrectOperatorTimeEntryInput = {
  timeEntryId: string;
  machineId: string;
  actualStartAt: string;
  actualEndAt: string;
  notes?: string | null;
  void?: boolean;
};

export type CreateManagerTimeEntryInput = {
  operatorProfileId: string;
  machineId: string;
  actualStartAt: string;
  actualEndAt: string;
  notes?: string | null;
};

export type CreateManagerTimeEntryResult = {
  timeEntry: OperatorTimeReviewEntry;
  context: OperatorTimeReviewContext;
  afterTechnicianCutoff: boolean;
};

export type OperatorCompensationRateType = 'shift' | 'commission';

export type OperatorCompensationRate = {
  id: string;
  accountId: string;
  operatorProfileId: string;
  machineId: string | null;
  rateType: OperatorCompensationRateType;
  rateValue: number;
  shiftRateCents: number | null;
  commissionBasisPoints: number | null;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  status: OperatorCompensationRuleStatus;
  notes: string | null;
};

export type UpsertOperatorCompensationRateInput = {
  rateId?: string | null;
  accountId: string;
  operatorProfileId: string;
  machineId?: string | null;
  rateType: OperatorCompensationRateType;
  rateValue: number;
  effectiveStartDate: string;
  effectiveEndDate?: string | null;
  status?: OperatorCompensationRuleStatus;
  notes?: string | null;
};

export type SupersedeOperatorCompensationRateInput = Omit<
  UpsertOperatorCompensationRateInput,
  'rateId' | 'status'
>;

export type OperatorRecurringCompensationItemType =
  | 'bonus'
  | 'supply_credit'
  | 'expense_reimbursement';

export type UpsertOperatorRecurringItemInput = {
  itemId?: string | null;
  accountId: string;
  operatorProfileId: string;
  itemType: OperatorRecurringCompensationItemType;
  description: string;
  amountCents: number;
  effectiveStartDate: string;
  effectiveEndDate?: string | null;
  status?: OperatorCompensationRuleStatus;
};

export const calculateOperatorPaidShifts = (actualDurationMinutes: number) => {
  const minutes = Math.max(0, Math.ceil(actualDurationMinutes));
  return minutes === 0 ? 0 : Math.ceil(minutes / 60);
};

export const fetchMyOperatorPayStatementContext =
  async (): Promise<OperatorPayStatementContext> => {
    const { data, error } = await supabaseClient.rpc('get_my_operator_pay_statement_context');

    if (error) {
      throw new Error(error.message || 'Unable to load pay statements.');
    }

    return {
      profiles: [],
      ...((data as Partial<OperatorPayStatementContext> | null) ?? {}),
    };
  };

export const fetchPayStatementArtifact = async (
  payStatementId: string
): Promise<OperatorPayStatementArtifact> => {
  const { data, error } = await supabaseClient.rpc('get_pay_statement_artifact', {
    p_pay_statement_id: payStatementId,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to load pay statement.');
  }

  return data as OperatorPayStatementArtifact;
};

export const requestPayStubGenerationAdmin = async (
  operatorProfileId: string,
  month: string
): Promise<{ requestId: string; status: string }> => {
  const { data: request, error: requestError } = await supabaseClient.rpc(
    'admin_request_pay_stub_generation',
    {
      p_operator_profile_id: operatorProfileId,
      p_month: `${month}-01`,
    }
  );
  if (requestError || !request) {
    throw new Error(requestError?.message || 'Unable to request the Pay Stub.');
  }

  const requestId = String((request as { requestId?: string }).requestId ?? '');
  const { data: generated, error: generationError } = await supabaseClient.functions.invoke(
    'pay-stub-generator',
    { body: { requestId } }
  );
  if (generationError) throw new Error(generationError.message || 'Unable to generate the Pay Stub PDF.');
  const result = (generated as { results?: Array<{ status?: string; blockers?: Array<{ message?: string }> }> } | null)
    ?.results?.[0];
  if (result?.status === 'blocked') {
    throw new Error(result.blockers?.[0]?.message || 'Resolve the calculation blockers before publishing this Pay Stub.');
  }
  return { requestId, status: result?.status || 'completed' };
};

export const fetchMyOperatorTimekeepingContext = async (
  workDate?: string
): Promise<OperatorTimekeepingContext> => {
  const { data, error } = await supabaseClient.rpc('get_my_operator_timekeeping_context', {
    p_work_date: workDate ?? null,
  });

  if (error) {
    throw new Error(error.message || 'Unable to load Technician timekeeping.');
  }

  return {
    workDate: workDate ?? getLocalDateInputValue(),
    profiles: [],
    ...((data as Partial<OperatorTimekeepingContext> | null) ?? {}),
  };
};

export const fetchMyTimeReviewContext = async (
  workDate?: string
): Promise<OperatorTimeReviewContext> => {
  const [contextResult, entryOptionsResult] = await Promise.all([
    supabaseClient.rpc('get_my_time_review_context', {
      p_work_date: workDate ?? null,
    }),
    supabaseClient.rpc('get_my_time_review_entry_options', {
      p_work_date: workDate ?? null,
    }),
  ]);

  const { data, error } = contextResult;

  if (error) {
    throw new Error(error.message || 'Unable to load time review.');
  }

  if (entryOptionsResult.error) {
    throw new Error(entryOptionsResult.error.message || 'Unable to load Technician choices.');
  }

  return {
    workDate: workDate ?? getLocalDateInputValue(),
    periodStartDate: '',
    periodEndDate: '',
    hasAccess: false,
    machines: [],
    technicians: [],
    entries: [],
    capabilities: {
      canCorrectTime: false,
      approvalRequired: false,
      paymentExecution: false,
    },
    ...((data as Partial<OperatorTimeReviewContext> | null) ?? {}),
    entryOptions: (entryOptionsResult.data as OperatorTimeReviewEntryOption[] | null) ?? [],
  };
};

export const fetchTechnicianPayReportContext = async (
  month: string
): Promise<TechnicianPayReportContext> => {
  const normalizedMonth = /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : month;
  const { data, error } = await supabaseClient.rpc('get_current_technician_pay_report_context', {
    p_month: normalizedMonth,
  });

  if (error) {
    throw new Error(error.message || 'Unable to load the Technician Pay Report.');
  }

  const context: TechnicianPayReportContext = {
    month,
    periodStartDate: '',
    periodEndDate: '',
    hasAccess: false,
    accounts: [],
    technicians: [],
    capabilities: {
      accountPayAuthorityRequired: true,
      canCorrectTime: false,
      approvalRequired: false,
      paymentExecution: false,
      taxCalculation: true,
    },
    ...((data as Partial<TechnicianPayReportContext> | null) ?? {}),
  };

  const profileIds = context.technicians.map((technician) => technician.operatorProfileId);
  if (!profileIds.length) return context;

  const { data: contacts, error: contactsError } = await supabaseClient.rpc(
    'get_operator_contact_directory',
    { p_operator_profile_ids: profileIds }
  );

  const contactDirectoryUnavailable = contactsError?.code === 'PGRST202' || contactsError?.code === '42883';
  if (contactsError && !contactDirectoryUnavailable) {
    throw new Error(contactsError.message || 'Unable to load Technician contact details.');
  }

  const contactByProfileId = new Map(
    ((contacts ?? []) as Array<{
      operator_profile_id: string;
      contact_email: string | null;
      contact_phone: string | null;
      mailing_address: string | null;
    }>).map((contact) => [contact.operator_profile_id, contact] as const)
  );

  return {
    ...context,
    technicians: context.technicians.map((technician) => {
      const contact = contactByProfileId.get(technician.operatorProfileId);
      return {
        ...technician,
        contactEmail: contact?.contact_email ?? null,
        contactPhone: contact?.contact_phone ?? null,
        mailingAddress: contact?.mailing_address ?? null,
      };
    }),
  };
};

export const fetchTimekeepingSetupContext = async (): Promise<TimekeepingSetupContext> => {
  const { data, error } = await supabaseClient.rpc('get_timekeeping_setup_context');

  if (error) {
    throw new Error(error.message || 'Unable to load Timekeeping setup choices.');
  }

  return {
    accounts: [],
    capabilities: {
      accountPayAuthorityRequired: true,
      approvalRequired: false,
      paymentExecution: false,
    },
    ...((data as Partial<TimekeepingSetupContext> | null) ?? {}),
  };
};

export const setupTimekeepingTechnicianAdmin = async ({
  payerAccountId,
  userEmail,
  displayName,
  workerType,
  workerIdentifier,
  contactEmail,
  contactPhone,
  mailingAddress,
  effectiveStartDate,
  machineCompensation,
}: SetupTimekeepingTechnicianInput): Promise<SetupTimekeepingTechnicianResult> => {
  const { data, error } = await supabaseClient.rpc('admin_setup_timekeeping_for_payer_with_contact', {
    p_payer_account_id: payerAccountId,
    p_user_email: userEmail,
    p_display_name: displayName,
    p_worker_type: workerType,
    p_worker_identifier: workerIdentifier ?? null,
    p_contact_email: contactEmail ?? null,
    p_contact_phone: contactPhone ?? null,
    p_mailing_address: mailingAddress ?? null,
    p_effective_start_date: effectiveStartDate,
    p_machine_compensation: machineCompensation,
  });

  if (error || !data) {
    if (error?.code === 'PGRST202' || error?.code === '42883') {
      throw new Error('Technician contact setup will be available after the database rollout completes.');
    }
    throw new Error(error?.message || 'Unable to activate Timekeeping for this Technician.');
  }

  return data as SetupTimekeepingTechnicianResult;
};

export const updateOperatorContactAdmin = async ({
  operatorProfileId,
  contactEmail,
  contactPhone,
  mailingAddress,
}: UpdateOperatorContactInput): Promise<OperatorContactRecord> => {
  const { data, error } = await supabaseClient.rpc('admin_update_operator_contact', {
    p_operator_profile_id: operatorProfileId,
    p_contact_email: contactEmail ?? null,
    p_contact_phone: contactPhone ?? null,
    p_mailing_address: mailingAddress ?? null,
    p_reason: 'Technician contact details updated from Admin Payouts',
  });

  if (error || !data) {
    if (error?.code === 'PGRST202' || error?.code === '42883') {
      throw new Error('Technician contact editing will be available after the database rollout completes.');
    }
    throw new Error(error?.message || 'Unable to update Technician contact details.');
  }

  return data as OperatorContactRecord;
};

export const voidOperatorTimeEntry = async ({
  timeEntryId,
  reason = 'Operator deleted unlocked shift',
}: {
  timeEntryId: string;
  reason?: string;
}): Promise<OperatorTimekeepingContext> => {
  const { data, error } = await supabaseClient.rpc('void_operator_time_entry', {
    p_time_entry_id: timeEntryId,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to delete time entry.');
  }

  const payload = data as { context?: OperatorTimekeepingContext };
  if (!payload.context) {
    throw new Error('Time entry deleted, but the updated context was not returned.');
  }

  return payload.context;
};

export const saveCompletedOperatorTimeEntry = async (
  input: SaveCompletedOperatorTimeEntryInput
): Promise<SaveCompletedOperatorTimeEntryResult> => {
  const { data, error } = await supabaseClient.rpc('save_operator_time_entry', {
    p_time_entry_id: input.timeEntryId ?? null,
    p_operator_profile_id: input.operatorProfileId,
    p_reporting_machine_id: input.machineId,
    p_actual_start_at: input.actualStartAt,
    p_actual_end_at: input.actualEndAt,
    p_notes: input.notes ?? null,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save completed Technician time.');
  }

  const payload = data as Partial<SaveCompletedOperatorTimeEntryResult>;
  if (!payload.context || !payload.timeEntry) {
    throw new Error('Time entry saved, but the updated calendar was not returned.');
  }

  return {
    timeEntry: payload.timeEntry,
    context: payload.context,
  };
};

export const correctOperatorTimeEntry = async (
  input: CorrectOperatorTimeEntryInput
): Promise<OperatorTimeReviewContext> => {
  const { data, error } = await supabaseClient.rpc('manager_correct_operator_time_entry', {
    p_time_entry_id: input.timeEntryId,
    p_reporting_machine_id: input.machineId,
    p_actual_start_at: input.actualStartAt,
    p_actual_end_at: input.actualEndAt,
    p_notes: input.notes ?? null,
    p_void: input.void ?? false,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to correct Technician time.');
  }

  const payload = data as { context?: OperatorTimeReviewContext };
  if (!payload.context) {
    throw new Error('Time entry corrected, but the updated manager report was not returned.');
  }

  return payload.context;
};

export const createManagerTimeEntry = async (
  input: CreateManagerTimeEntryInput
): Promise<CreateManagerTimeEntryResult> => {
  const { data, error } = await supabaseClient.rpc('manager_create_operator_time_entry', {
    p_operator_profile_id: input.operatorProfileId,
    p_reporting_machine_id: input.machineId,
    p_actual_start_at: input.actualStartAt,
    p_actual_end_at: input.actualEndAt,
    p_notes: input.notes ?? null,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to add missed Technician time.');
  }

  const payload = data as Partial<CreateManagerTimeEntryResult>;
  if (!payload.context || !payload.timeEntry) {
    throw new Error('Time entry saved, but the updated manager report was not returned.');
  }

  return {
    timeEntry: payload.timeEntry,
    context: payload.context,
    afterTechnicianCutoff: payload.afterTechnicianCutoff === true,
  };
};

export const supersedeOperatorCompensationRateAdmin = async ({
  accountId,
  operatorProfileId,
  machineId = null,
  rateType,
  rateValue,
  effectiveStartDate,
  effectiveEndDate = null,
  notes = null,
}: SupersedeOperatorCompensationRateInput): Promise<OperatorCompensationRate> => {
  const { data, error } = await supabaseClient.rpc(
    'admin_supersede_operator_compensation_rate',
    {
      p_account_id: accountId,
      p_operator_profile_id: operatorProfileId,
      p_reporting_machine_id: machineId,
      p_rate_type: rateType,
      p_rate_value: rateValue,
      p_effective_start_date: effectiveStartDate,
      p_effective_end_date: effectiveEndDate,
      p_notes: notes,
    }
  );

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save Technician compensation rate change.');
  }

  return data as OperatorCompensationRate;
};

export const upsertOperatorRecurringItemAdmin = async ({
  itemId = null,
  accountId,
  operatorProfileId,
  itemType,
  description,
  amountCents,
  effectiveStartDate,
  effectiveEndDate = null,
  status = 'active',
}: UpsertOperatorRecurringItemInput): Promise<Record<string, unknown>> => {
  const { data, error } = await supabaseClient.rpc('admin_upsert_operator_recurring_item', {
    p_item_id: itemId,
    p_account_id: accountId,
    p_operator_profile_id: operatorProfileId,
    p_item_type: itemType,
    p_description: description,
    p_amount_cents: amountCents,
    p_effective_start_date: effectiveStartDate,
    p_effective_end_date: effectiveEndDate,
    p_status: status,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save recurring compensation item.');
  }

  return data as Record<string, unknown>;
};

export const upsertEffectiveOperatorMachineAssignmentAdmin = async ({
  assignmentId = null,
  operatorProfileId,
  machineId,
  effectiveStartDate,
  effectiveEndDate = null,
}: UpsertEffectiveOperatorMachineAssignmentInput): Promise<EffectiveOperatorMachineAssignment> => {
  const { data, error } = await supabaseClient.rpc(
    'admin_upsert_operator_machine_assignment',
    {
      p_assignment_id: assignmentId,
      p_operator_profile_id: operatorProfileId,
      p_reporting_machine_id: machineId,
      p_effective_start_date: effectiveStartDate,
      p_effective_end_date: effectiveEndDate,
    }
  );

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save effective machine assignment.');
  }

  return data as EffectiveOperatorMachineAssignment;
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatTechnicianPayDisclaimer = (disclaimer: string) =>
  disclaimer
    .replace(/Bloomjoy operator payout inputs/gi, 'Bloomjoy Technician pay inputs')
    .replace(/Bloomjoy operator payouts/gi, 'Bloomjoy Technician pay');

const formatStatementDate = (value: string | null | undefined) =>
  value
    ? new Date(value.includes('T') ? value : `${value}T00:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'n/a';

const formatStatementMoney = (cents: number | null | undefined) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format((cents ?? 0) / 100);

const formatStatementBps = (basisPoints: number | null | undefined) =>
  typeof basisPoints === 'number' ? `${(basisPoints / 100).toFixed(2)}%` : 'n/a';

export const buildOperatorPayStatementHtml = (statement: OperatorPayStatementPayload) => {
  const address = statement.entity.address;
  const addressLine = [address?.line1, address?.line2, address?.city, address?.state, address?.postalCode]
    .filter(Boolean)
    .join(', ');
  const safeStatus = statement.status === 'revised' ? 'Revised' : 'Issued';
  const statementLabel = formatOperatorPayStatementLabel(statement.statementLabel);
  const machineRows = statement.machines
    .map(
      (machine) => `
        <tr>
          <td>${escapeHtml(machine.machineLabel)}</td>
          <td>${escapeHtml(machine.shiftCount)}</td>
          <td>${escapeHtml(machine.paidHours.toFixed(2))}</td>
          <td>${escapeHtml(formatStatementMoney(machine.eligibleNetRevenueCents))}</td>
          <td>${escapeHtml(formatStatementBps(machine.commissionBasisPoints))}</td>
          <td>${escapeHtml(formatStatementMoney(machine.commissionPayCents))}</td>
        </tr>`
    )
    .join('');
  const adjustmentRows = statement.adjustments
    .map(
      (adjustment) => `
        <tr>
          <td>${escapeHtml(adjustment.description)}</td>
          <td>${escapeHtml(adjustment.adjustmentType.replaceAll('_', ' '))}</td>
          <td>${escapeHtml(formatStatementMoney(adjustment.amountCents))}</td>
        </tr>`
    )
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(statement.statementNumber)}</title>
    <style>
      :root { color-scheme: light; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: oklch(27% 0.018 172); }
      body { margin: 0; background: oklch(98% 0.008 172); }
      main { max-width: 920px; margin: 0 auto; padding: 40px 24px; }
      .sheet { background: oklch(99% 0.004 172); border: 1px solid oklch(88% 0.015 172); border-radius: 8px; padding: 32px; }
      header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 1px solid oklch(92% 0.012 172); padding-bottom: 24px; }
      h1, h2, p { margin: 0; }
      h1 { font-size: 28px; line-height: 1.2; }
      h2 { font-size: 16px; margin-top: 28px; margin-bottom: 12px; }
      .muted { color: oklch(48% 0.025 172); font-size: 13px; line-height: 1.5; }
      .status { display: inline-block; border: 1px solid oklch(67% 0.065 164); border-radius: 999px; padding: 5px 10px; color: oklch(39% 0.07 164); font-size: 12px; font-weight: 700; text-transform: uppercase; }
      .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 24px; }
      .metric { border: 1px solid oklch(91% 0.014 172); border-radius: 8px; padding: 14px; }
      .label { color: oklch(48% 0.025 172); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      .value { margin-top: 8px; font-size: 18px; font-weight: 700; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th { text-align: left; color: oklch(48% 0.025 172); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; border-bottom: 1px solid oklch(91% 0.014 172); padding: 10px 8px; }
      td { border-bottom: 1px solid oklch(95% 0.01 172); padding: 12px 8px; vertical-align: top; }
      td span { color: oklch(48% 0.025 172); font-size: 12px; }
      footer { margin-top: 28px; color: oklch(48% 0.025 172); font-size: 12px; line-height: 1.5; }
      @media print { body { background: oklch(99% 0.004 172); } main { padding: 0; } .sheet { border: 0; } }
    </style>
  </head>
  <body>
    <main>
      <section class="sheet">
        <header>
          <div>
            <p class="status">${escapeHtml(safeStatus)}</p>
            <h1>${escapeHtml(statementLabel)}</h1>
            <p class="muted">${escapeHtml(statement.statementNumber)} / Version ${escapeHtml(statement.version)}</p>
          </div>
          <div class="muted">
            <strong>${escapeHtml(statement.entity.name)}</strong><br />
            ${escapeHtml(addressLine)}<br />
            ${escapeHtml(statement.entity.contactEmail ?? '')}
          </div>
        </header>

        <div class="grid">
          <div class="metric"><p class="label">Technician</p><p class="value">${escapeHtml(statement.operator.displayName)}</p></div>
          <div class="metric"><p class="label">Period</p><p class="value">${escapeHtml(formatStatementDate(statement.period.periodStartDate))} - ${escapeHtml(formatStatementDate(statement.period.periodEndDate))}</p></div>
          <div class="metric"><p class="label">Issued</p><p class="value">${escapeHtml(formatStatementDate(statement.issuedAt))}</p></div>
          <div class="metric"><p class="label">Total Technician pay</p><p class="value">${escapeHtml(formatStatementMoney(statement.totals.totalPayoutCents))}</p></div>
        </div>

        <h2>Summary</h2>
        <div class="grid">
          <div class="metric"><p class="label">Paid hours</p><p class="value">${escapeHtml(statement.time.paidHours.toFixed(2))}</p></div>
          <div class="metric"><p class="label">Hourly pay</p><p class="value">${escapeHtml(formatStatementMoney(statement.totals.hourlyPayCents))}</p></div>
          <div class="metric"><p class="label">Commission</p><p class="value">${escapeHtml(formatStatementMoney(statement.totals.commissionPayCents))}</p></div>
          <div class="metric"><p class="label">Adjustments</p><p class="value">${escapeHtml(formatStatementMoney(statement.totals.adjustmentsTotalCents))}</p></div>
        </div>

        <h2>Machine Basis</h2>
        <table>
          <thead>
            <tr><th>Machine</th><th>Shifts</th><th>Paid hours</th><th>Eligible revenue</th><th>Rate</th><th>Commission</th></tr>
          </thead>
          <tbody>${machineRows || '<tr><td colspan="6">No machine rows.</td></tr>'}</tbody>
        </table>

        <h2>Adjustments</h2>
        <table>
          <thead>
            <tr><th>Description</th><th>Type</th><th>Amount</th></tr>
          </thead>
          <tbody>${adjustmentRows || '<tr><td colspan="3">No Technician-visible adjustments.</td></tr>'}</tbody>
        </table>

        ${
          statement.revisionReason || statement.revision?.revisionReason
            ? `<h2>Revision Note</h2><p class="muted">${escapeHtml(
                statement.revisionReason ?? statement.revision?.revisionReason
              )}</p>`
            : ''
        }

        <footer>${escapeHtml(formatTechnicianPayDisclaimer(statement.disclaimer))}</footer>
      </section>
    </main>
  </body>
</html>`;
};

export const downloadOperatorPayStatementHtml = async (artifact: OperatorPayStatementArtifact) => {
  if (artifact.artifact.format === 'pdf' && artifact.artifact.storagePath) {
    const { data, error } = await supabaseClient.storage
      .from(artifact.artifact.storageBucket)
      .createSignedUrl(artifact.artifact.storagePath, 60, {
        download: artifact.artifact.downloadFileName,
      });
    if (error || !data?.signedUrl) {
      throw new Error(error?.message || 'Unable to open the Pay Stub PDF.');
    }
    const anchor = document.createElement('a');
    anchor.href = data.signedUrl;
    anchor.download = artifact.artifact.downloadFileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return;
  }

  if (artifact.statement.schemaVersion !== 'operator-pay-statement-v1') {
    throw new Error('This Pay Stub PDF is not available yet.');
  }
  const html = buildOperatorPayStatementHtml(artifact.statement);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.artifact.downloadFileName || `${artifact.statement.statementNumber}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
