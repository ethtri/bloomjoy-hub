import type {
  PartnershipReportingSetup,
  ReportingMachineTaxRate,
} from '@/lib/partnershipReporting';

export const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const partnerTypes = [
  'venue',
  'event_operator',
  'platform_partner',
  'revenue_share_partner',
  'internal',
  'other',
];

export const partnershipTypes = ['venue', 'event', 'platform', 'revenue_share', 'internal', 'other'];
export const statuses = ['active', 'archived'];
export const partnershipStatuses = ['draft', 'active', 'archived'];
export const reportingFrequencies = ['weekly', 'monthly', 'weekly_and_monthly'];
export const machineOwnershipModels = ['supplier_owned', 'partner_owned', 'mixed', 'unknown'];
export const consumerPricingAuthorities = [
  'supplier_controls',
  'partner_controls',
  'sow_supplier_with_partner_approval',
  'shared',
  'unknown',
];

export const participantRoles = [
  'venue_partner',
  'event_partner',
  'platform_partner',
  'revenue_share_recipient',
  'operator',
  'internal',
  'other',
];

export const assignmentRoles = ['primary_reporting', 'venue', 'event', 'platform', 'internal'];
export const machineTypes = ['commercial', 'mini', 'micro', 'unknown'] as const;

export const calculationModels = [
  'gross_split',
  'net_split',
  'contribution_split',
  'fixed_fee_plus_split',
  'internal_only',
];

export const splitBases = ['gross_sales', 'net_sales', 'contribution_after_costs'];
export const feeBases = ['none', 'per_order', 'per_stick', 'per_transaction'];
export const costBases = ['none', 'per_stick', 'per_order', 'percentage_of_sales'];
export const deductionTimings = ['before_split', 'after_split', 'reporting_only'];
export const grossToNetMethods = [
  'machine_tax_plus_configured_fees',
  'imported_tax_plus_configured_fees',
  'configured_fees_only',
];

export type TaxStatus = 'missing' | 'no_tax' | 'configured';

export const toDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const today = () => toDateInputValue(new Date());

export const getLastCompletedWeekEndingDate = (weekEndDay: number) => {
  const date = new Date();
  const currentDay = date.getDay();
  let daysBack = (currentDay - weekEndDay + 7) % 7;
  if (daysBack === 0) daysBack = 7;
  date.setDate(date.getDate() - daysBack);
  return toDateInputValue(date);
};

export const centsFromDollars = (value: string) => Math.round((Number(value) || 0) * 100);
export const dollarsFromCents = (value: number) => (Number(value ?? 0) / 100).toFixed(2);
export const basisPointsFromPercent = (value: string) => Math.round((Number(value) || 0) * 100);
export const percentFromBasisPoints = (value: number) => (Number(value ?? 0) / 100).toFixed(2);

export const formatMoney = (cents: number | undefined) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(Number(cents ?? 0) / 100);

export const formatDate = (value: string | null | undefined) => value || 'open-ended';
export const formatLabel = (value: string) => value.replaceAll('_', ' ');

export const getCurrentTaxRate = (
  taxRates: ReportingMachineTaxRate[],
  machineId: string,
  currentDate = today()
) =>
  taxRates
    .filter(
      (candidate) =>
        candidate.machine_id === machineId &&
        candidate.status === 'active' &&
        candidate.effective_start_date <= currentDate &&
        (!candidate.effective_end_date || candidate.effective_end_date >= currentDate)
    )
    .sort((left, right) => right.effective_start_date.localeCompare(left.effective_start_date))[0];

export const getTaxStatus = (taxRate: ReportingMachineTaxRate | undefined): TaxStatus => {
  if (!taxRate) return 'missing';
  return Number(taxRate.tax_rate_percent) === 0 ? 'no_tax' : 'configured';
};

export const getTaxStatusLabel = (status: TaxStatus) => {
  if (status === 'missing') return 'Missing';
  if (status === 'no_tax') return 'No tax';
  return 'Configured';
};

export const getActiveMachineAssignments = (
  setup: PartnershipReportingSetup,
  machineId: string,
  currentDate = today()
) =>
  setup.assignments.filter(
    (assignment) =>
      assignment.machine_id === machineId &&
      assignment.status === 'active' &&
      assignment.effective_start_date <= currentDate &&
      (!assignment.effective_end_date || assignment.effective_end_date >= currentDate)
  );
