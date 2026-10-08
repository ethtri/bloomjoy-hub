/** Estimates contain only components excluded from authoritative known amounts. */
export type TaxPolicyEvidence = {
  status: 'provisional';
  estimatedSalesExTaxCents: number | null;
  estimatedRefundExTaxCents: number | null;
  estimatedNetExTaxCents: number | null;
  provisionalSalesComponents: number;
  provisionalRefundComponents: number;
  provisionalNetComponents: number;
};

export const parseTaxPolicyEvidence = (value: unknown, unknownCounts?: { gross_sales_unknown_count?: unknown; refund_amount_unknown_count?: unknown; net_sales_unknown_count?: unknown }): TaxPolicyEvidence | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Unsupported tax estimate evidence.');
  const row = value as Record<string, unknown>;
  const monetary = (value: unknown): number | null => {
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Unsupported tax estimate amount.');
    return value;
  };
  const count = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Unsupported tax estimate count.');
    return value;
  };
  if (row.status !== 'provisional') throw new Error('Unsupported tax estimate status.');
  const evidence: TaxPolicyEvidence = { status: 'provisional', estimatedSalesExTaxCents: monetary(row.estimatedSalesExTaxCents), estimatedRefundExTaxCents: monetary(row.estimatedRefundExTaxCents), estimatedNetExTaxCents: monetary(row.estimatedNetExTaxCents), provisionalSalesComponents: count(row.provisionalSalesComponents), provisionalRefundComponents: count(row.provisionalRefundComponents), provisionalNetComponents: count(row.provisionalNetComponents) };
  for (const [amount, contributors, unknown] of [[evidence.estimatedSalesExTaxCents, evidence.provisionalSalesComponents, unknownCounts?.gross_sales_unknown_count], [evidence.estimatedRefundExTaxCents, evidence.provisionalRefundComponents, unknownCounts?.refund_amount_unknown_count], [evidence.estimatedNetExTaxCents, evidence.provisionalNetComponents, unknownCounts?.net_sales_unknown_count]] as const) {
    if ((amount === null) !== (contributors === 0) || (unknownCounts && contributors > count(unknown))) throw new Error('Tax estimates do not match the authoritative missing component counts.');
  }
  return evidence;
};

export function taxPolicyEstimate(rows: { taxPolicyEvidence?: TaxPolicyEvidence }[], field: 'grossSalesCents' | 'netSalesCents' | 'refundAmountCents' | 'taxCents' | 'customerReceiptsCents') {
  const key = field === 'grossSalesCents' ? 'estimatedSalesExTaxCents' : field === 'netSalesCents' ? 'estimatedNetExTaxCents' : field === 'refundAmountCents' ? 'estimatedRefundExTaxCents' : null;
  const amounts = key ? rows.flatMap(row => row.taxPolicyEvidence?.[key] == null ? [] : [row.taxPolicyEvidence[key]!]) : [];
  const value = amounts.length ? amounts.reduce((sum, amount) => sum + amount, 0) : null;
  if (value !== null && !Number.isSafeInteger(value)) throw new Error('The estimated report amount is too large to display accurately.');
  return { value, contributors: amounts.length };
}
