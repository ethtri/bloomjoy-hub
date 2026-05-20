import { supabaseClient } from '@/lib/supabaseClient';

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

export type PayStatementStatus = 'draft' | 'issued' | 'revised' | 'voided';

export type OperatorAssignedMachine = {
  assignmentId: string;
  machineId: string;
  machineLabel: string;
  locationId: string;
  locationName: string;
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

export type OperatorPayStatementArtifact = {
  statement: OperatorPayStatementPayload;
  artifact: {
    format: 'html';
    source: 'database_payload';
    storageBucket: string;
    storagePath: string | null;
    downloadFileName: string;
  };
};

export type PayStatementPreviewResult = {
  payoutRunId: string;
  status: PayoutRunStatus;
  previewOnly: true;
  statementCount: number;
  statements: OperatorPayStatementPayload[];
};

export type IssuePayStatementsInput = {
  payoutRunId: string;
  reason: string;
  revisionReason?: string | null;
};

export type IssuePayStatementsResult = {
  payoutRun: PayoutRun;
  statements: OperatorPayStatementPayload[];
  issuedStatementCount: number;
  notificationStatus: OperatorPayStatementSummary['notificationStatus'];
  revision: boolean;
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
  payoutPolicyId: string;
  payoutPeriodId: string;
  workDate: string;
  startTime: string;
  endTime: string;
  rawDurationMinutes: number;
  roundedPaidMinutes: number;
  notes: string | null;
  status: TimeEntryStatus;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PayoutRevenueSnapshotWarning = {
  code: string;
  severity: 'info' | 'warning' | 'blocker';
  message: string;
  [key: string]: unknown;
};

export type PayoutRevenueSnapshotStatus =
  | 'source_generated'
  | 'manual_override'
  | 'voided';

export type PayoutRevenueSnapshot = {
  id: string;
  accountId: string;
  payoutPeriodId: string;
  machineId: string;
  machineLabel: string;
  locationId: string;
  locationName: string;
  periodStartDate: string;
  periodEndDate: string;
  grossSalesCents: number;
  refundAdjustmentCents: number;
  netRevenueCents: number;
  eligibleCommissionRevenueCents: number;
  transactionCount: number;
  sourceSalesRowCount: number;
  sourceAdjustmentRowCount: number;
  sourceLatestSaleDate: string | null;
  sourceLatestAdjustmentDate: string | null;
  sourceMetadata: Record<string, unknown>;
  warnings: PayoutRevenueSnapshotWarning[];
  status: PayoutRevenueSnapshotStatus;
  manualOverrideReason: string | null;
  generatedAt: string;
  regeneratedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PayoutRevenueSnapshotContext = {
  payoutPeriodId: string;
  periodStartDate: string;
  periodEndDate: string;
  snapshots: PayoutRevenueSnapshot[];
  totals: {
    grossSalesCents: number;
    refundAdjustmentCents: number;
    netRevenueCents: number;
    eligibleCommissionRevenueCents: number;
    transactionCount: number;
    warningCount: number;
  };
};

export type OperatorCompensationRuleStatus = 'active' | 'inactive';

export type OperatorCompensationRule = {
  id: string;
  accountId: string;
  operatorProfileId: string | null;
  operatorDisplayName: string | null;
  machineId: string | null;
  machineLabel: string | null;
  locationId: string | null;
  hourlyRateCents: number | null;
  commissionBasisPoints: number | null;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  status: OperatorCompensationRuleStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PayoutCalculationWarning = {
  code: string;
  severity: 'info' | 'warning' | 'blocker';
  message: string;
  [key: string]: unknown;
};

export type PayoutRunStatus =
  | 'draft'
  | 'review'
  | 'finalized'
  | 'issued'
  | 'closed'
  | 'reopened'
  | 'voided';

export type PayoutRunAdjustment = {
  id: string;
  amountCents: number;
  adjustmentType: string;
  description: string;
  visibleToOperator: boolean;
  createdAt: string;
};

export type PayoutRunItemMachine = {
  id: string;
  machineId: string;
  machineLabel: string;
  locationId: string;
  locationName: string;
  netRevenueCents: number;
  eligibleNetRevenueCents: number;
  commissionBasisPoints: number | null;
  commissionPayCents: number;
  shiftCount: number;
  rawMinutes: number;
  roundedPaidMinutes: number;
  includedInCommissionBasis: boolean;
  inclusionReason: string | null;
};

export type PayoutRunItem = {
  id: string;
  operatorProfileId: string;
  operatorDisplayName: string;
  workerType: OperatorWorkerType;
  rawMinutes: number;
  roundedPaidMinutes: number;
  shiftCount: number;
  hourlyRateCents: number | null;
  hourlyPayCents: number;
  eligibleNetRevenueCents: number;
  commissionBasisPoints: number | null;
  commissionPayCents: number;
  adjustmentsTotalCents: number;
  totalPayoutCents: number;
  status: 'draft' | 'reviewed' | 'finalized' | 'issued' | 'revised' | 'voided';
  warnings: PayoutCalculationWarning[];
  calculationNotes: Record<string, unknown>;
  machines: PayoutRunItemMachine[];
  adjustments: PayoutRunAdjustment[];
};

export type PayoutRun = {
  id: string;
  accountId: string;
  payoutPeriodId: string;
  status: PayoutRunStatus;
  totalRawMinutes: number;
  totalRoundedPaidMinutes: number;
  totalHourlyPayCents: number;
  totalCommissionPayCents: number;
  totalAdjustmentsCents: number;
  totalPayoutCents: number;
  warnings: PayoutCalculationWarning[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items: PayoutRunItem[];
};

export type PayoutCalculationContext = {
  payoutPeriodId: string;
  periodStartDate: string;
  periodEndDate: string;
  periodStatus: OperatorPayoutPeriodContext['status'];
  payoutRun: PayoutRun | null;
};

export type PayoutReviewAccount = {
  id: string;
  name: string;
};

export type PayoutReviewSnapshot = {
  id: string;
  payoutRunId: string;
  revisionNumber: number;
  action: 'marked_reviewed' | 'finalized' | 'reopened' | 'voided';
  previousStatus: PayoutRunStatus;
  revisionReason: string;
  createdAt: string;
};

export type PayoutReviewPeriod = OperatorPayoutPeriodContext & {
  accountId: string;
  accountName: string;
  payoutRun: PayoutRun | null;
  canReview: boolean;
  canFinalize: boolean;
  hasBlockers: boolean;
  issuedStatementCount: number;
  revisionCount: number;
};

export type PayoutReviewContext = {
  accounts: PayoutReviewAccount[];
  periods: PayoutReviewPeriod[];
};

export type PayoutReviewWorkflowResult = {
  payoutRun: PayoutRun;
  reviewSnapshot?: PayoutReviewSnapshot;
  finalized?: boolean;
  reopened?: boolean;
  voided?: boolean;
  overrideBlockers?: boolean;
};

export type MarkPayoutRunReviewedInput = {
  payoutRunId: string;
  reason: string;
};

export type FinalizePayoutRunInput = {
  payoutRunId: string;
  reason: string;
  overrideBlockers?: boolean;
  overrideReason?: string | null;
};

export type ReopenPayoutRunInput = {
  payoutRunId: string;
  reason: string;
};

export type VoidPayoutRunInput = {
  payoutRunId: string;
  reason: string;
};

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

export type OperatorPayoutContext = {
  profiles: OperatorPayoutProfileContext[];
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

export type OperatorPayoutProfileRecord = {
  id: string;
  account_id: string;
  user_id: string;
  display_name: string;
  worker_type: OperatorWorkerType;
  status: OperatorPayoutProfileStatus;
  payout_policy_id: string | null;
  created_at: string;
  updated_at: string;
};

export type UpsertOperatorPayoutProfileInput = {
  userEmail: string;
  accountId: string;
  displayName: string;
  workerType?: OperatorWorkerType;
  payoutPolicyId?: string | null;
  reason: string;
};

export type SetOperatorMachineAssignmentsInput = {
  operatorProfileId: string;
  machineIds: string[];
  reason: string;
};

export type SetOperatorMachineAssignmentsResult = {
  operatorProfileId: string;
  activeAssignmentCount: number;
  assignments: unknown[];
};

export type SaveOperatorTimeEntryInput = {
  operatorProfileId: string;
  machineId: string;
  workDate: string;
  startTime: string;
  endTime: string;
  notes?: string | null;
  status?: Extract<TimeEntryStatus, 'draft' | 'submitted'>;
};

export type UpdateOperatorTimeEntryInput = SaveOperatorTimeEntryInput & {
  timeEntryId: string;
};

export type GeneratePayoutRevenueSnapshotInput = {
  payoutPeriodId: string;
  machineId: string;
  regenerate?: boolean;
  reason?: string | null;
};

export type GeneratePayoutRevenueSnapshotsForPeriodInput = {
  payoutPeriodId: string;
  regenerate?: boolean;
  reason?: string | null;
};

export type OverridePayoutRevenueSnapshotInput = {
  payoutPeriodId: string;
  machineId: string;
  grossSalesCents: number;
  refundAdjustmentCents: number;
  reason: string;
};

export type GeneratePayoutRevenueSnapshotResult = {
  snapshot: PayoutRevenueSnapshot;
  idempotent?: boolean;
  manualOverride?: boolean;
};

export type GeneratePayoutRevenueSnapshotsForPeriodResult = {
  payoutPeriodId: string;
  snapshotCount: number;
  snapshots: PayoutRevenueSnapshot[];
};

export type UpsertOperatorCompensationRuleInput = {
  ruleId?: string | null;
  accountId: string;
  operatorProfileId?: string | null;
  machineId?: string | null;
  hourlyRateCents?: number | null;
  commissionBasisPoints?: number | null;
  effectiveStartDate: string;
  effectiveEndDate?: string | null;
  status?: OperatorCompensationRuleStatus;
  notes?: string | null;
  reason: string;
};

export type CalculatePayoutRunInput = {
  payoutPeriodId: string;
  regenerate?: boolean;
  reason?: string | null;
};

export type CalculatePayoutRunResult = {
  payoutRun: PayoutRun;
  idempotent?: boolean;
  hasBlockers?: boolean;
};

export type AddPayoutAdjustmentInput = {
  payoutRunId: string;
  operatorProfileId: string;
  amountCents: number;
  adjustmentType?: string;
  description: string;
  visibleToOperator?: boolean;
  reason: string;
};

export type AddPayoutAdjustmentResult = {
  adjustment: Record<string, unknown>;
  payoutRun: PayoutRun;
};

export const roundOperatorPaidMinutes = (
  rawDurationMinutes: number,
  roundingRule: PayoutRoundingRule = 'round_up_60_minutes'
) => {
  const minutes = Math.max(0, Math.trunc(rawDurationMinutes));

  if (roundingRule === 'none' || roundingRule === 'custom') return minutes;
  if (roundingRule === 'round_up_15_minutes') return Math.ceil(minutes / 15) * 15;
  if (roundingRule === 'round_up_30_minutes') return Math.ceil(minutes / 30) * 30;
  if (roundingRule === 'round_up_60_minutes') return Math.ceil(minutes / 60) * 60;
  if (roundingRule === 'round_nearest_15_minutes') return Math.round(minutes / 15) * 15;
  if (roundingRule === 'round_nearest_30_minutes') return Math.round(minutes / 30) * 30;

  return minutes;
};

export const paidMinutesToHours = (minutes: number) => Math.max(0, minutes) / 60;

export const fetchMyOperatorPayoutContext = async (): Promise<OperatorPayoutContext> => {
  const { data, error } = await supabaseClient.rpc('get_my_operator_payout_context');

  if (error) {
    throw new Error(error.message || 'Unable to load operator payouts.');
  }

  return {
    profiles: [],
    ...((data as Partial<OperatorPayoutContext> | null) ?? {}),
  };
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
    throw new Error(error?.message || 'Unable to load pay statement artifact.');
  }

  return data as OperatorPayStatementArtifact;
};

export const fetchMyOperatorTimekeepingContext = async (
  workDate?: string
): Promise<OperatorTimekeepingContext> => {
  const { data, error } = await supabaseClient.rpc('get_my_operator_timekeeping_context', {
    p_work_date: workDate ?? null,
  });

  if (error) {
    throw new Error(error.message || 'Unable to load operator timekeeping.');
  }

  return {
    workDate: new Date().toISOString().slice(0, 10),
    profiles: [],
    ...((data as Partial<OperatorTimekeepingContext> | null) ?? {}),
  };
};

export const submitOperatorTimeEntry = async (
  input: SaveOperatorTimeEntryInput
): Promise<OperatorTimekeepingContext> => {
  const { data, error } = await supabaseClient.rpc('submit_operator_time_entry', {
    p_operator_profile_id: input.operatorProfileId,
    p_reporting_machine_id: input.machineId,
    p_work_date: input.workDate,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_notes: input.notes ?? null,
    p_status: input.status ?? 'submitted',
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to submit time entry.');
  }

  const payload = data as { context?: OperatorTimekeepingContext };
  if (!payload.context) {
    throw new Error('Time entry saved, but the updated context was not returned.');
  }

  return payload.context;
};

export const updateOperatorTimeEntry = async (
  input: UpdateOperatorTimeEntryInput
): Promise<OperatorTimekeepingContext> => {
  const { data, error } = await supabaseClient.rpc('update_operator_time_entry', {
    p_time_entry_id: input.timeEntryId,
    p_reporting_machine_id: input.machineId,
    p_work_date: input.workDate,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_notes: input.notes ?? null,
    p_status: input.status ?? 'submitted',
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to update time entry.');
  }

  const payload = data as { context?: OperatorTimekeepingContext };
  if (!payload.context) {
    throw new Error('Time entry updated, but the updated context was not returned.');
  }

  return payload.context;
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

export const fetchPayoutRevenueSnapshotContext = async (
  payoutPeriodId: string
): Promise<PayoutRevenueSnapshotContext> => {
  const { data, error } = await supabaseClient.rpc('get_payout_revenue_snapshot_context', {
    p_payout_period_id: payoutPeriodId,
  });

  if (error) {
    throw new Error(error.message || 'Unable to load payout revenue snapshots.');
  }

  return {
    payoutPeriodId,
    periodStartDate: '',
    periodEndDate: '',
    snapshots: [],
    totals: {
      grossSalesCents: 0,
      refundAdjustmentCents: 0,
      netRevenueCents: 0,
      eligibleCommissionRevenueCents: 0,
      transactionCount: 0,
      warningCount: 0,
    },
    ...((data as Partial<PayoutRevenueSnapshotContext> | null) ?? {}),
  };
};

export const generatePayoutRevenueSnapshotAdmin = async ({
  payoutPeriodId,
  machineId,
  regenerate = false,
  reason = null,
}: GeneratePayoutRevenueSnapshotInput): Promise<GeneratePayoutRevenueSnapshotResult> => {
  const { data, error } = await supabaseClient.rpc('admin_generate_payout_revenue_snapshot', {
    p_payout_period_id: payoutPeriodId,
    p_reporting_machine_id: machineId,
    p_regenerate: regenerate,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to generate payout revenue snapshot.');
  }

  return data as GeneratePayoutRevenueSnapshotResult;
};

export const generatePayoutRevenueSnapshotsForPeriodAdmin = async ({
  payoutPeriodId,
  regenerate = false,
  reason = null,
}: GeneratePayoutRevenueSnapshotsForPeriodInput): Promise<GeneratePayoutRevenueSnapshotsForPeriodResult> => {
  const { data, error } = await supabaseClient.rpc(
    'admin_generate_payout_revenue_snapshots_for_period',
    {
      p_payout_period_id: payoutPeriodId,
      p_regenerate: regenerate,
      p_reason: reason,
    }
  );

  if (error || !data) {
    throw new Error(error?.message || 'Unable to generate payout revenue snapshots.');
  }

  return data as GeneratePayoutRevenueSnapshotsForPeriodResult;
};

export const overridePayoutRevenueSnapshotAdmin = async ({
  payoutPeriodId,
  machineId,
  grossSalesCents,
  refundAdjustmentCents,
  reason,
}: OverridePayoutRevenueSnapshotInput): Promise<GeneratePayoutRevenueSnapshotResult> => {
  const { data, error } = await supabaseClient.rpc('admin_override_payout_revenue_snapshot', {
    p_payout_period_id: payoutPeriodId,
    p_reporting_machine_id: machineId,
    p_gross_sales_cents: grossSalesCents,
    p_refund_adjustment_cents: refundAdjustmentCents,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to override payout revenue snapshot.');
  }

  return data as GeneratePayoutRevenueSnapshotResult;
};

export const fetchPayoutCalculationContext = async (
  payoutPeriodId: string
): Promise<PayoutCalculationContext> => {
  const { data, error } = await supabaseClient.rpc('get_payout_calculation_context', {
    p_payout_period_id: payoutPeriodId,
  });

  if (error) {
    throw new Error(error.message || 'Unable to load payout calculation.');
  }

  return {
    payoutPeriodId,
    periodStartDate: '',
    periodEndDate: '',
    periodStatus: 'open',
    payoutRun: null,
    ...((data as Partial<PayoutCalculationContext> | null) ?? {}),
  };
};

export const upsertOperatorCompensationRuleAdmin = async ({
  ruleId = null,
  accountId,
  operatorProfileId = null,
  machineId = null,
  hourlyRateCents = null,
  commissionBasisPoints = null,
  effectiveStartDate,
  effectiveEndDate = null,
  status = 'active',
  notes = null,
  reason,
}: UpsertOperatorCompensationRuleInput): Promise<OperatorCompensationRule> => {
  const { data, error } = await supabaseClient.rpc('admin_upsert_operator_compensation_rule', {
    p_rule_id: ruleId,
    p_account_id: accountId,
    p_operator_profile_id: operatorProfileId,
    p_reporting_machine_id: machineId,
    p_hourly_rate_cents: hourlyRateCents,
    p_commission_basis_points: commissionBasisPoints,
    p_effective_start_date: effectiveStartDate,
    p_effective_end_date: effectiveEndDate,
    p_status: status,
    p_notes: notes,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save compensation rule.');
  }

  return data as OperatorCompensationRule;
};

export const calculatePayoutRunAdmin = async ({
  payoutPeriodId,
  regenerate = false,
  reason = null,
}: CalculatePayoutRunInput): Promise<CalculatePayoutRunResult> => {
  const { data, error } = await supabaseClient.rpc('admin_calculate_payout_run', {
    p_payout_period_id: payoutPeriodId,
    p_regenerate: regenerate,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to calculate payout run.');
  }

  return data as CalculatePayoutRunResult;
};

export const addPayoutAdjustmentAdmin = async ({
  payoutRunId,
  operatorProfileId,
  amountCents,
  adjustmentType = 'manual_adjustment',
  description,
  visibleToOperator = true,
  reason,
}: AddPayoutAdjustmentInput): Promise<AddPayoutAdjustmentResult> => {
  const { data, error } = await supabaseClient.rpc('admin_add_payout_adjustment', {
    p_payout_run_id: payoutRunId,
    p_operator_profile_id: operatorProfileId,
    p_amount_cents: amountCents,
    p_adjustment_type: adjustmentType,
    p_description: description,
    p_visible_to_operator: visibleToOperator,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to add payout adjustment.');
  }

  return data as AddPayoutAdjustmentResult;
};

export const fetchPayoutReviewContext = async (): Promise<PayoutReviewContext> => {
  const { data, error } = await supabaseClient.rpc('get_payout_review_context');

  if (error) {
    throw new Error(error.message || 'Unable to load payout review context.');
  }

  return {
    accounts: [],
    periods: [],
    ...((data as Partial<PayoutReviewContext> | null) ?? {}),
  };
};

export const previewPayStatementsAdmin = async (
  payoutRunId: string
): Promise<PayStatementPreviewResult> => {
  const { data, error } = await supabaseClient.rpc('admin_preview_pay_statements', {
    p_payout_run_id: payoutRunId,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to preview pay statements.');
  }

  return data as PayStatementPreviewResult;
};

export const issuePayStatementsAdmin = async ({
  payoutRunId,
  reason,
  revisionReason = null,
}: IssuePayStatementsInput): Promise<IssuePayStatementsResult> => {
  const { data, error } = await supabaseClient.rpc('admin_issue_pay_statements', {
    p_payout_run_id: payoutRunId,
    p_reason: reason,
    p_revision_reason: revisionReason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to issue pay statements.');
  }

  return data as IssuePayStatementsResult;
};

export const markPayoutRunReviewedAdmin = async ({
  payoutRunId,
  reason,
}: MarkPayoutRunReviewedInput): Promise<PayoutReviewWorkflowResult> => {
  const { data, error } = await supabaseClient.rpc('admin_mark_payout_run_reviewed', {
    p_payout_run_id: payoutRunId,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to mark payout run reviewed.');
  }

  return data as PayoutReviewWorkflowResult;
};

export const finalizePayoutRunAdmin = async ({
  payoutRunId,
  reason,
  overrideBlockers = false,
  overrideReason = null,
}: FinalizePayoutRunInput): Promise<PayoutReviewWorkflowResult> => {
  const { data, error } = await supabaseClient.rpc('admin_finalize_payout_run', {
    p_payout_run_id: payoutRunId,
    p_reason: reason,
    p_override_blockers: overrideBlockers,
    p_override_reason: overrideReason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to finalize payout run.');
  }

  return data as PayoutReviewWorkflowResult;
};

export const reopenPayoutRunAdmin = async ({
  payoutRunId,
  reason,
}: ReopenPayoutRunInput): Promise<PayoutReviewWorkflowResult> => {
  const { data, error } = await supabaseClient.rpc('admin_reopen_payout_run', {
    p_payout_run_id: payoutRunId,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to reopen payout run.');
  }

  return data as PayoutReviewWorkflowResult;
};

export const voidPayoutRunAdmin = async ({
  payoutRunId,
  reason,
}: VoidPayoutRunInput): Promise<PayoutReviewWorkflowResult> => {
  const { data, error } = await supabaseClient.rpc('admin_void_payout_run', {
    p_payout_run_id: payoutRunId,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to void payout run.');
  }

  return data as PayoutReviewWorkflowResult;
};

export const upsertOperatorPayoutProfileAdmin = async ({
  userEmail,
  accountId,
  displayName,
  workerType,
  payoutPolicyId,
  reason,
}: UpsertOperatorPayoutProfileInput): Promise<OperatorPayoutProfileRecord> => {
  const { data, error } = await supabaseClient.rpc('admin_upsert_operator_payout_profile', {
    p_user_email: userEmail,
    p_account_id: accountId,
    p_display_name: displayName,
    p_worker_type: workerType ?? null,
    p_payout_policy_id: payoutPolicyId ?? null,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save operator payout profile.');
  }

  return data as OperatorPayoutProfileRecord;
};

export const setOperatorMachineAssignmentsAdmin = async ({
  operatorProfileId,
  machineIds,
  reason,
}: SetOperatorMachineAssignmentsInput): Promise<SetOperatorMachineAssignmentsResult> => {
  const { data, error } = await supabaseClient.rpc('admin_set_operator_machine_assignments', {
    p_operator_profile_id: operatorProfileId,
    p_machine_ids: machineIds,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save operator machine assignments.');
  }

  return data as SetOperatorMachineAssignmentsResult;
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

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
  const machineRows = statement.machines
    .map(
      (machine) => `
        <tr>
          <td>${escapeHtml(machine.machineLabel)}<br /><span>${escapeHtml(machine.locationName)}</span></td>
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
      :root { color-scheme: light; font-family: Inter, Arial, sans-serif; color: #1f2933; }
      body { margin: 0; background: #f7faf9; }
      main { max-width: 920px; margin: 0 auto; padding: 40px 24px; }
      .sheet { background: #ffffff; border: 1px solid #d7dedb; border-radius: 8px; padding: 32px; }
      header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 1px solid #e6ebe9; padding-bottom: 24px; }
      h1, h2, p { margin: 0; }
      h1 { font-size: 28px; line-height: 1.2; }
      h2 { font-size: 16px; margin-top: 28px; margin-bottom: 12px; }
      .muted { color: #60706a; font-size: 13px; line-height: 1.5; }
      .status { display: inline-block; border: 1px solid #7aa391; border-radius: 999px; padding: 5px 10px; color: #2d5f4b; font-size: 12px; font-weight: 700; text-transform: uppercase; }
      .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 24px; }
      .metric { border: 1px solid #e1e7e4; border-radius: 8px; padding: 14px; }
      .label { color: #60706a; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      .value { margin-top: 8px; font-size: 18px; font-weight: 700; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th { text-align: left; color: #60706a; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; border-bottom: 1px solid #e1e7e4; padding: 10px 8px; }
      td { border-bottom: 1px solid #edf1ef; padding: 12px 8px; vertical-align: top; }
      td span { color: #60706a; font-size: 12px; }
      footer { margin-top: 28px; color: #60706a; font-size: 12px; line-height: 1.5; }
      @media print { body { background: #fff; } main { padding: 0; } .sheet { border: 0; } }
    </style>
  </head>
  <body>
    <main>
      <section class="sheet">
        <header>
          <div>
            <p class="status">${escapeHtml(safeStatus)}</p>
            <h1>${escapeHtml(statement.statementLabel)}</h1>
            <p class="muted">${escapeHtml(statement.statementNumber)} / Version ${escapeHtml(statement.version)}</p>
          </div>
          <div class="muted">
            <strong>${escapeHtml(statement.entity.name)}</strong><br />
            ${escapeHtml(addressLine)}<br />
            ${escapeHtml(statement.entity.contactEmail ?? '')}
          </div>
        </header>

        <div class="grid">
          <div class="metric"><p class="label">Operator</p><p class="value">${escapeHtml(statement.operator.displayName)}</p></div>
          <div class="metric"><p class="label">Period</p><p class="value">${escapeHtml(formatStatementDate(statement.period.periodStartDate))} - ${escapeHtml(formatStatementDate(statement.period.periodEndDate))}</p></div>
          <div class="metric"><p class="label">Issued</p><p class="value">${escapeHtml(formatStatementDate(statement.issuedAt))}</p></div>
          <div class="metric"><p class="label">Total payout</p><p class="value">${escapeHtml(formatStatementMoney(statement.totals.totalPayoutCents))}</p></div>
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
          <tbody>${adjustmentRows || '<tr><td colspan="3">No operator-visible adjustments.</td></tr>'}</tbody>
        </table>

        ${
          statement.revisionReason || statement.revision?.revisionReason
            ? `<h2>Revision Note</h2><p class="muted">${escapeHtml(
                statement.revisionReason ?? statement.revision?.revisionReason
              )}</p>`
            : ''
        }

        <footer>${escapeHtml(statement.disclaimer)}</footer>
      </section>
    </main>
  </body>
</html>`;
};

export const downloadOperatorPayStatementHtml = (artifact: OperatorPayStatementArtifact) => {
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
