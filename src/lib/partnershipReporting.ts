import { supabaseClient } from '@/lib/supabaseClient';
import type { ReportingMachineType } from '@/lib/reporting';

export type ReportingPartner = {
  id: string;
  name: string;
  partner_type: string;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  status: 'active' | 'archived';
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ReportingPartnership = {
  id: string;
  name: string;
  partnership_type: string;
  reporting_week_end_day: number;
  timezone: string;
  effective_start_date: string;
  effective_end_date: string | null;
  status: 'draft' | 'active' | 'archived';
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PartnershipSetupMachine = {
  id: string;
  machine_label: string;
  machine_type: ReportingMachineType;
  sunze_machine_id: string | null;
  status: string;
  account_name: string;
  location_name: string;
  latest_sale_date: string | null;
};

export type ReportingMachinePartnershipAssignment = {
  id: string;
  machine_id: string;
  machine_label: string;
  partnership_id: string;
  partnership_name: string;
  assignment_role: string;
  effective_start_date: string;
  effective_end_date: string | null;
  status: 'active' | 'archived';
  notes: string | null;
};

export type ReportingPartnershipParty = {
  id: string;
  partnership_id: string;
  partnership_name: string;
  partner_id: string;
  partner_name: string;
  party_role: string;
  share_basis_points: number | null;
  is_report_recipient: boolean;
  created_at: string;
  updated_at: string;
};

export type ReportingMachineTaxRate = {
  id: string;
  machine_id: string;
  machine_label: string;
  tax_rate_percent: number;
  effective_start_date: string;
  effective_end_date: string | null;
  status: 'active' | 'archived';
  notes: string | null;
};

export type ReportingPartnershipFinancialRule = {
  id: string;
  partnership_id: string;
  partnership_name: string;
  calculation_model: string;
  split_base: string;
  fee_amount_cents: number;
  fee_basis: string;
  cost_amount_cents: number;
  cost_basis: string;
  deduction_timing: string;
  gross_to_net_method: string;
  fever_share_basis_points: number;
  partner_share_basis_points: number;
  bloomjoy_share_basis_points: number;
  effective_start_date: string;
  effective_end_date: string | null;
  status: 'draft' | 'active' | 'archived';
  notes: string | null;
};

export type PartnershipSetupWarning = {
  warningType: string;
  machineId?: string;
  machineLabel?: string;
  partnershipId?: string;
  partnershipName?: string;
  message: string;
};

export type PartnershipReportingSetup = {
  partners: ReportingPartner[];
  partnerships: ReportingPartnership[];
  machines: PartnershipSetupMachine[];
  assignments: ReportingMachinePartnershipAssignment[];
  parties: ReportingPartnershipParty[];
  taxRates: ReportingMachineTaxRate[];
  financialRules: ReportingPartnershipFinancialRule[];
  warnings: PartnershipSetupWarning[];
};

export type PartnerWeeklyReportPreview = {
  partnershipId: string;
  partnershipName?: string;
  reportingWeekEndDay?: number;
  weekEndingDate: string;
  weekStartDate: string;
  summary: {
    order_count?: number;
    item_quantity?: number;
    gross_sales_cents?: number;
    tax_cents?: number;
    fee_cents?: number;
    cost_cents?: number;
    net_sales_cents?: number;
    split_base_cents?: number;
    fever_profit_cents?: number;
    partner_profit_cents?: number;
    bloomjoy_profit_cents?: number;
  };
  machines: Array<{
    reporting_machine_id: string;
    machine_label: string;
    order_count: number;
    item_quantity: number;
    gross_sales_cents: number;
    tax_cents: number;
    fee_cents: number;
    cost_cents: number;
    net_sales_cents: number;
    split_base_cents: number;
  }>;
  warnings: PartnershipSetupWarning[];
};

export type UpsertPartnerInput = {
  partnerId?: string | null;
  name: string;
  partnerType: string;
  primaryContactName?: string | null;
  primaryContactEmail?: string | null;
  status: string;
  notes?: string | null;
  reason: string;
};

export type UpsertPartnershipInput = {
  partnershipId?: string | null;
  name: string;
  partnershipType: string;
  reportingWeekEndDay: number;
  timezone: string;
  effectiveStartDate: string;
  effectiveEndDate?: string | null;
  status: string;
  notes?: string | null;
  reason: string;
};

export type UpsertMachineAssignmentInput = {
  assignmentId?: string | null;
  machineId: string;
  partnershipId: string;
  assignmentRole: string;
  effectiveStartDate: string;
  effectiveEndDate?: string | null;
  status: string;
  notes?: string | null;
  reason: string;
};

export type UpsertPartnershipPartyInput = {
  partyId?: string | null;
  partnershipId: string;
  partnerId: string;
  partyRole: string;
  shareBasisPoints?: number | null;
  isReportRecipient: boolean;
  reason: string;
};

export type UpsertMachineTaxRateInput = {
  taxRateId?: string | null;
  machineId: string;
  taxRatePercent: number;
  effectiveStartDate: string;
  effectiveEndDate?: string | null;
  status: string;
  notes?: string | null;
  reason: string;
};

export type UpsertFinancialRuleInput = {
  ruleId?: string | null;
  partnershipId: string;
  calculationModel: string;
  splitBase: string;
  feeAmountCents: number;
  feeBasis: string;
  costAmountCents: number;
  costBasis: string;
  deductionTiming: string;
  grossToNetMethod: string;
  feverShareBasisPoints: number;
  partnerShareBasisPoints: number;
  bloomjoyShareBasisPoints: number;
  effectiveStartDate: string;
  effectiveEndDate?: string | null;
  status: string;
  notes?: string | null;
  reason: string;
};

const emptySetup: PartnershipReportingSetup = {
  partners: [],
  partnerships: [],
  machines: [],
  assignments: [],
  parties: [],
  taxRates: [],
  financialRules: [],
  warnings: [],
};

export const fetchPartnershipReportingSetup = async (): Promise<PartnershipReportingSetup> => {
  const { data, error } = await supabaseClient.rpc('admin_get_partnership_reporting_setup');

  if (error) {
    throw new Error(error.message || 'Unable to load partnership reporting setup.');
  }

  return {
    ...emptySetup,
    ...((data as Partial<PartnershipReportingSetup> | null) ?? {}),
  };
};

export const upsertReportingPartnerAdmin = async (input: UpsertPartnerInput) => {
  const { data, error } = await supabaseClient.rpc('admin_upsert_reporting_partner', {
    p_partner_id: input.partnerId ?? null,
    p_name: input.name,
    p_partner_type: input.partnerType,
    p_primary_contact_name: input.primaryContactName ?? null,
    p_primary_contact_email: input.primaryContactEmail ?? null,
    p_status: input.status,
    p_notes: input.notes ?? null,
    p_reason: input.reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save partner.');
  }

  return data as ReportingPartner;
};

export const upsertReportingPartnershipAdmin = async (input: UpsertPartnershipInput) => {
  const { data, error } = await supabaseClient.rpc('admin_upsert_reporting_partnership', {
    p_partnership_id: input.partnershipId ?? null,
    p_name: input.name,
    p_partnership_type: input.partnershipType,
    p_reporting_week_end_day: input.reportingWeekEndDay,
    p_timezone: input.timezone,
    p_effective_start_date: input.effectiveStartDate,
    p_effective_end_date: input.effectiveEndDate || null,
    p_status: input.status,
    p_notes: input.notes ?? null,
    p_reason: input.reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save partnership.');
  }

  return data as ReportingPartnership;
};

export const upsertReportingMachineAssignmentAdmin = async (
  input: UpsertMachineAssignmentInput
) => {
  const { data, error } = await supabaseClient.rpc(
    'admin_upsert_reporting_machine_assignment',
    {
      p_assignment_id: input.assignmentId ?? null,
      p_machine_id: input.machineId,
      p_partnership_id: input.partnershipId,
      p_assignment_role: input.assignmentRole,
      p_effective_start_date: input.effectiveStartDate,
      p_effective_end_date: input.effectiveEndDate || null,
      p_status: input.status,
      p_notes: input.notes ?? null,
      p_reason: input.reason,
    }
  );

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save machine assignment.');
  }

  return data as ReportingMachinePartnershipAssignment;
};

export const upsertReportingPartnershipPartyAdmin = async (
  input: UpsertPartnershipPartyInput
) => {
  const { data, error } = await supabaseClient.rpc('admin_upsert_reporting_partnership_party', {
    p_party_id: input.partyId ?? null,
    p_partnership_id: input.partnershipId,
    p_partner_id: input.partnerId,
    p_party_role: input.partyRole,
    p_share_basis_points: input.shareBasisPoints ?? null,
    p_is_report_recipient: input.isReportRecipient,
    p_reason: input.reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save partnership party.');
  }

  return data as ReportingPartnershipParty;
};

export const upsertReportingMachineTaxRateAdmin = async (input: UpsertMachineTaxRateInput) => {
  const { data, error } = await supabaseClient.rpc('admin_upsert_reporting_machine_tax_rate', {
    p_tax_rate_id: input.taxRateId ?? null,
    p_machine_id: input.machineId,
    p_tax_rate_percent: input.taxRatePercent,
    p_effective_start_date: input.effectiveStartDate,
    p_effective_end_date: input.effectiveEndDate || null,
    p_status: input.status,
    p_notes: input.notes ?? null,
    p_reason: input.reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save machine tax rate.');
  }

  return data as ReportingMachineTaxRate;
};

export const upsertReportingFinancialRuleAdmin = async (input: UpsertFinancialRuleInput) => {
  const { data, error } = await supabaseClient.rpc('admin_upsert_reporting_financial_rule', {
    p_rule_id: input.ruleId ?? null,
    p_partnership_id: input.partnershipId,
    p_calculation_model: input.calculationModel,
    p_split_base: input.splitBase,
    p_fee_amount_cents: input.feeAmountCents,
    p_fee_basis: input.feeBasis,
    p_cost_amount_cents: input.costAmountCents,
    p_cost_basis: input.costBasis,
    p_deduction_timing: input.deductionTiming,
    p_gross_to_net_method: input.grossToNetMethod,
    p_fever_share_basis_points: input.feverShareBasisPoints,
    p_partner_share_basis_points: input.partnerShareBasisPoints,
    p_bloomjoy_share_basis_points: input.bloomjoyShareBasisPoints,
    p_effective_start_date: input.effectiveStartDate,
    p_effective_end_date: input.effectiveEndDate || null,
    p_status: input.status,
    p_notes: input.notes ?? null,
    p_reason: input.reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save financial rule.');
  }

  return data as ReportingPartnershipFinancialRule;
};

export const previewPartnerWeeklyReportAdmin = async (
  partnershipId: string,
  weekEndingDate: string
): Promise<PartnerWeeklyReportPreview> => {
  const { data, error } = await supabaseClient.rpc('admin_preview_partner_weekly_report', {
    p_partnership_id: partnershipId,
    p_week_ending_date: weekEndingDate,
  });

  if (error) {
    throw new Error(error.message || 'Unable to preview partner report.');
  }

  return data as PartnerWeeklyReportPreview;
};
