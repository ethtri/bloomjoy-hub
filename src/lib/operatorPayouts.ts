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
