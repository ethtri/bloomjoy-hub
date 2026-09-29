import type { SalesReportPdfRow } from "./sales-report-pdf.ts";

export type SalesReportMachine = {
  id: string;
  machine_label: string;
};

export type SalesReportFact = {
  reporting_machine_id: string;
  reporting_location_id: string;
  sale_date: string;
  payment_method: string;
  net_sales_cents: number;
  transaction_count: number;
};

export type SalesReportAdjustment = {
  id: string;
  reporting_machine_id: string;
  reporting_location_id: string;
  adjustment_date: string;
  adjustment_type: string;
  amount_cents: number;
  source: string;
  refund_case_id: string | null;
  raw_payload: Record<string, unknown> | null;
};

export type SalesReportRefundCaseTender = {
  id: string;
  reporting_adjustment_id: string | null;
  payment_method: string;
};

export const SALES_REPORT_QUERY_CHUNK_SIZE = 100;
export const SALES_REPORT_QUERY_PAGE_SIZE = 1_000;

export const chunkSalesReportQueryValues = <T>(
  values: T[],
  size = SALES_REPORT_QUERY_CHUNK_SIZE,
): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

export const fetchAllSalesReportRows = async <T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = SALES_REPORT_QUERY_PAGE_SIZE,
): Promise<T[]> => {
  const rows: T[] = [];
  for (let from = 0;; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
};

export const startOfSalesReportPeriod = (dateValue: string, grain: string) => {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (grain === "month") {
    return `${year}-${String(month).padStart(2, "0")}-01`;
  }

  if (grain === "day") return dateValue;

  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
};

export const normalizeSalesReportAdjustmentPaymentMethod = (
  adjustment: SalesReportAdjustment,
  refundCase: SalesReportRefundCaseTender | undefined,
): "cash" | "credit" | "other" | "unknown" => {
  if (adjustment.source === "nayax_provider_refund") return "credit";
  if (refundCase?.payment_method === "card") return "credit";
  if (refundCase?.payment_method === "cash") return "cash";

  const rawPaymentMethod = String(adjustment.raw_payload?.payment_method ?? "")
    .trim()
    .toLowerCase();
  if (rawPaymentMethod === "card" || rawPaymentMethod === "credit") {
    return "credit";
  }
  if (rawPaymentMethod === "cash") return "cash";
  if (rawPaymentMethod === "other") return "other";
  return "unknown";
};

export const calculateScheduledSalesReportRows = ({
  salesFacts,
  adjustments,
  machinesById,
  locationNamesById,
  refundCasesById,
  refundCasesByAdjustmentId,
  grain,
  paymentMethods,
}: {
  salesFacts: SalesReportFact[];
  adjustments: SalesReportAdjustment[];
  machinesById: Map<string, SalesReportMachine>;
  locationNamesById: Map<string, string>;
  refundCasesById: Map<string, SalesReportRefundCaseTender>;
  refundCasesByAdjustmentId: Map<string, SalesReportRefundCaseTender>;
  grain: string;
  paymentMethods: string[];
}): SalesReportPdfRow[] => {
  const grouped = new Map<string, SalesReportPdfRow>();

  const rowFor = ({
    periodStart,
    machineId,
    locationId,
    paymentMethod,
  }: {
    periodStart: string;
    machineId: string;
    locationId: string;
    paymentMethod: string;
  }) => {
    const rowKey = `${periodStart}:${machineId}:${locationId}:${paymentMethod}`;
    const current = grouped.get(rowKey) ?? ({
      period_start: periodStart,
      machine_label: machinesById.get(machineId)?.machine_label ?? "Machine",
      location_name: locationNamesById.get(locationId) ?? "Location",
      payment_method: paymentMethod,
      net_sales_cents: 0,
      refund_amount_cents: 0,
      gross_sales_cents: 0,
      transaction_count: 0,
    } satisfies SalesReportPdfRow);
    grouped.set(rowKey, current);
    return current;
  };

  salesFacts.forEach((fact) => {
    if (
      paymentMethods.length > 0 && !paymentMethods.includes(fact.payment_method)
    ) return;
    const current = rowFor({
      periodStart: startOfSalesReportPeriod(fact.sale_date, grain),
      machineId: fact.reporting_machine_id,
      locationId: fact.reporting_location_id,
      paymentMethod: fact.payment_method,
    });
    current.gross_sales_cents = Number(current.gross_sales_cents ?? 0) +
      Number(fact.net_sales_cents ?? 0);
    current.transaction_count = Number(current.transaction_count ?? 0) +
      Number(fact.transaction_count ?? 0);
  });

  adjustments.forEach((adjustment) => {
    if (!["refund", "complaint_refund"].includes(adjustment.adjustment_type)) {
      return;
    }
    const refundCase = adjustment.refund_case_id
      ? refundCasesById.get(adjustment.refund_case_id)
      : refundCasesByAdjustmentId.get(adjustment.id);
    const paymentMethod = normalizeSalesReportAdjustmentPaymentMethod(
      adjustment,
      refundCase,
    );
    if (paymentMethods.length > 0 && !paymentMethods.includes(paymentMethod)) {
      return;
    }
    const current = rowFor({
      periodStart: startOfSalesReportPeriod(adjustment.adjustment_date, grain),
      machineId: adjustment.reporting_machine_id,
      locationId: adjustment.reporting_location_id,
      paymentMethod,
    });
    current.refund_amount_cents = Number(current.refund_amount_cents ?? 0) +
      Number(adjustment.amount_cents ?? 0);
  });

  return [...grouped.values()]
    .map((row) => ({
      ...row,
      net_sales_cents: Number(row.gross_sales_cents ?? 0) -
        Number(row.refund_amount_cents ?? 0),
    }))
    .sort((left, right) =>
      [
        left.period_start,
        left.location_name,
        left.machine_label,
        left.payment_method,
      ]
        .join(":")
        .localeCompare(
          [
            right.period_start,
            right.location_name,
            right.machine_label,
            right.payment_method,
          ].join(":"),
        )
    );
};
