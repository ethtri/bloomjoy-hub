import { supabaseClient } from '@/lib/supabaseClient';

export type ScopedMachineTaxMachine = {
  id: string;
  machineLabel: string;
  machineType: string;
  sunzeMachineId: string | null;
  status: string;
  accountName: string;
  locationName: string;
  latestSaleDate: string | null;
  activePartnerships: Array<{
    partnershipId: string;
    partnershipName: string;
  }>;
};

export type ScopedMachineTaxRate = {
  id: string;
  machineId: string;
  machineLabel: string;
  taxRatePercent: number;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  status: string;
  notes: string | null;
};

export type ScopedMachineTaxWarning = {
  warningType: string;
  machineId?: string;
  machineLabel?: string;
  message: string;
};

export type ScopedMachineTaxSetup = {
  machines: ScopedMachineTaxMachine[];
  taxRates: ScopedMachineTaxRate[];
  warnings: ScopedMachineTaxWarning[];
};

const emptySetup: ScopedMachineTaxSetup = {
  machines: [],
  taxRates: [],
  warnings: [],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const asNullableString = (value: unknown) => (typeof value === 'string' ? value : null);
const asNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const asArray = <T>(value: unknown, mapper: (item: unknown) => T): T[] =>
  Array.isArray(value) ? value.map(mapper) : [];

const mapPartnership = (item: unknown) => {
  const record = isRecord(item) ? item : {};
  return {
    partnershipId: asString(record.partnershipId),
    partnershipName: asString(record.partnershipName, 'Partnership'),
  };
};

const mapMachine = (item: unknown): ScopedMachineTaxMachine => {
  const record = isRecord(item) ? item : {};
  return {
    id: asString(record.id),
    machineLabel: asString(record.machineLabel, 'Unnamed machine'),
    machineType: asString(record.machineType, 'unknown'),
    sunzeMachineId: asNullableString(record.sunzeMachineId),
    status: asString(record.status, 'active'),
    accountName: asString(record.accountName, 'Bloomjoy account'),
    locationName: asString(record.locationName, 'Location'),
    latestSaleDate: asNullableString(record.latestSaleDate),
    activePartnerships: asArray(record.activePartnerships, mapPartnership).filter(
      (partnership) => partnership.partnershipId
    ),
  };
};

const mapTaxRate = (item: unknown): ScopedMachineTaxRate => {
  const record = isRecord(item) ? item : {};
  return {
    id: asString(record.id),
    machineId: asString(record.machineId ?? record.machine_id),
    machineLabel: asString(record.machineLabel ?? record.machine_label, 'Unnamed machine'),
    taxRatePercent: asNumber(record.taxRatePercent ?? record.tax_rate_percent),
    effectiveStartDate: asString(record.effectiveStartDate ?? record.effective_start_date),
    effectiveEndDate: asNullableString(record.effectiveEndDate ?? record.effective_end_date),
    status: asString(record.status, 'active'),
    notes: asNullableString(record.notes),
  };
};

const mapWarning = (item: unknown): ScopedMachineTaxWarning => {
  const record = isRecord(item) ? item : {};
  return {
    warningType: asString(record.warningType, 'unknown'),
    machineId: asNullableString(record.machineId) ?? undefined,
    machineLabel: asNullableString(record.machineLabel) ?? undefined,
    message: asString(record.message, 'Review this machine tax setup issue.'),
  };
};

export const fetchScopedMachineTaxSetup = async (): Promise<ScopedMachineTaxSetup> => {
  const { data, error } = await supabaseClient.rpc('admin_get_scoped_machine_tax_setup');

  if (error) {
    throw new Error(error.message || 'Unable to load scoped machine tax setup.');
  }

  const record = isRecord(data) ? data : {};
  return {
    machines: asArray(record.machines, mapMachine).filter((machine) => machine.id),
    taxRates: asArray(record.taxRates, mapTaxRate).filter((taxRate) => taxRate.id),
    warnings: asArray(record.warnings, mapWarning),
  };
};

export const saveScopedMachineTaxRate = async (input: {
  machineId: string;
  taxRatePercent: number;
  effectiveStartDate: string;
  reason: string;
}): Promise<ScopedMachineTaxRate> => {
  const { data, error } = await supabaseClient.rpc('admin_set_reporting_machine_tax_rate', {
    p_machine_id: input.machineId,
    p_tax_rate_percent: input.taxRatePercent,
    p_effective_start_date: input.effectiveStartDate,
    p_reason: input.reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save machine tax rate.');
  }

  return mapTaxRate(data);
};

export const emptyScopedMachineTaxSetup = emptySetup;
