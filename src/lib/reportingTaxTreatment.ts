export type ReportingTaxAmountBasis = 'source_default' | 'tax_inclusive' | 'tax_exclusive';
export type ReportingTaxTender = 'card' | 'cash';
export type ReportingTaxTreatmentValues = {
  amountBasis: ReportingTaxAmountBasis;
  taxablePortionPercent: number;
};
export type ReportingTaxTreatment = ReportingTaxTreatmentValues & {
  id: string;
  machineId: string;
  tender: ReportingTaxTender;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  createdAt: string;
  createdBy: string | null;
};

const isDate = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const mapTreatment = (value: unknown): ReportingTaxTreatment => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Reporting tax treatment returned an invalid rule.');
  }
  const row = value as Record<string, unknown>;
  const portion = Number(row.taxable_portion_percent);
  if (typeof row.id !== 'string' || !row.id || typeof row.machine_id !== 'string' || !row.machine_id
    || !['card', 'cash'].includes(String(row.tender))
    || !['source_default', 'tax_inclusive', 'tax_exclusive'].includes(String(row.amount_basis))
    || !['string', 'number'].includes(typeof row.taxable_portion_percent)
    || (typeof row.taxable_portion_percent === 'string' && row.taxable_portion_percent.trim() === '')
    || !Number.isFinite(portion) || portion < 0 || portion > 100
    || !isDate(row.effective_start_date)
    || (row.effective_end_date !== null && !isDate(row.effective_end_date))
    || (typeof row.effective_end_date === 'string' && row.effective_end_date < row.effective_start_date)
    || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))
    || (row.created_by !== null && typeof row.created_by !== 'string')) {
    throw new Error('Reporting tax treatment returned an invalid rule.');
  }
  return {
    id: row.id, machineId: row.machine_id, tender: row.tender as ReportingTaxTender,
    amountBasis: row.amount_basis as ReportingTaxAmountBasis, taxablePortionPercent: portion,
    effectiveStartDate: row.effective_start_date, effectiveEndDate: row.effective_end_date as string | null,
    createdAt: row.created_at, createdBy: row.created_by as string | null,
  };
};

export const parseReportingTaxTreatments = (data: unknown): ReportingTaxTreatment[] => {
  if (!Array.isArray(data)) throw new Error('Reporting tax treatment returned an unsupported response.');
  return data.map(mapTreatment);
};

export const fetchReportingTaxTreatments = async (): Promise<ReportingTaxTreatment[]> => {
  const { supabaseClient } = await import('@/lib/supabaseClient');
  const { data, error } = await supabaseClient.rpc('admin_get_reporting_machine_tax_treatments');
  if (error) throw new Error(error.message || 'Unable to load reporting tax treatment.');
  return parseReportingTaxTreatments(data);
};

/** No matching rule preserves the existing provider-field basis and full taxable portion. */
export const getEffectiveReportingTaxTreatment = (
  treatments: ReportingTaxTreatment[], machineId: string, tender: ReportingTaxTender, date: string,
): ReportingTaxTreatmentValues => {
  const effective = treatments.filter((treatment) => treatment.machineId === machineId
    && treatment.tender === tender && treatment.effectiveStartDate <= date
    && (treatment.effectiveEndDate === null || treatment.effectiveEndDate >= date))
    .sort((a, b) => b.effectiveStartDate.localeCompare(a.effectiveStartDate))[0];
  return effective
    ? { amountBasis: effective.amountBasis, taxablePortionPercent: effective.taxablePortionPercent }
    : { amountBasis: 'source_default', taxablePortionPercent: 100 };
};

export const saveReportingTaxTreatment = async (input: ReportingTaxTreatmentValues & {
  machineId: string;
  tender: ReportingTaxTender;
  effectiveStartDate: string;
  reason: string;
}): Promise<ReportingTaxTreatment> => {
  const { supabaseClient } = await import('@/lib/supabaseClient');
  const { data, error } = await supabaseClient.rpc('admin_set_reporting_machine_tax_treatment', {
    p_machine_id: input.machineId,
    p_tender: input.tender,
    p_amount_basis: input.amountBasis,
    p_taxable_portion_percent: input.taxablePortionPercent,
    p_effective_start_date: input.effectiveStartDate,
    p_reason: input.reason,
  });
  if (error || !data) throw new Error(error?.message || 'Unable to save reporting tax treatment.');
  return mapTreatment(data);
};

/** Rate and both tender rules either commit together or all roll back. */
export const saveReportingTaxConfiguration = async (input: {
  machineId: string;
  taxRatePercent: number;
  effectiveStartDate: string;
  reason: string;
  card: ReportingTaxTreatmentValues;
  cash: ReportingTaxTreatmentValues;
}): Promise<void> => {
  const { supabaseClient } = await import('@/lib/supabaseClient');
  const { data, error } = await supabaseClient.rpc('admin_set_reporting_machine_tax_configuration', {
    p_machine_id: input.machineId,
    p_tax_rate_percent: input.taxRatePercent,
    p_effective_start_date: input.effectiveStartDate,
    p_reason: input.reason,
    p_card_amount_basis: input.card.amountBasis,
    p_card_taxable_portion_percent: input.card.taxablePortionPercent,
    p_cash_amount_basis: input.cash.amountBasis,
    p_cash_taxable_portion_percent: input.cash.taxablePortionPercent,
  });
  if (error) throw new Error(error.message || 'Unable to save reporting tax configuration.');
  if (!data || typeof data !== 'object' || !('treatments' in data)) {
    throw new Error('Unable to verify the saved reporting tax configuration. Refresh before retrying.');
  }
  parseReportingTaxTreatments(data.treatments);
};
