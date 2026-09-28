import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  calculateScheduledSalesReportRows,
  chunkSalesReportQueryValues,
  fetchAllSalesReportRows,
  type SalesReportAdjustment,
} from "./sales-report-calculation.ts";

const machineId = "15703000-0000-4000-8000-000000000001";
const currentLocationId = "15702000-0000-4000-8000-000000000001";
const reportedLocationId = "15702000-0000-4000-8000-000000000002";

const adjustment = (
  overrides: Partial<SalesReportAdjustment>,
): SalesReportAdjustment => ({
  id: "15706000-0000-4000-8000-000000000001",
  reporting_machine_id: machineId,
  reporting_location_id: reportedLocationId,
  adjustment_date: "2026-09-01",
  adjustment_type: "refund",
  amount_cents: 2_700,
  source: "manual",
  refund_case_id: "15705000-0000-4000-8000-000000000001",
  raw_payload: {},
  ...overrides,
});

Deno.test("scheduled sales report keeps proven tender, refund-only rows, and recorded locations", () => {
  const rows = calculateScheduledSalesReportRows({
    salesFacts: [
      {
        reporting_machine_id: machineId,
        reporting_location_id: reportedLocationId,
        sale_date: "2026-09-01",
        payment_method: "credit",
        net_sales_cents: 40_500,
        transaction_count: 40,
      },
      {
        reporting_machine_id: machineId,
        reporting_location_id: reportedLocationId,
        sale_date: "2026-09-01",
        payment_method: "cash",
        net_sales_cents: 10_000,
        transaction_count: 10,
      },
    ],
    adjustments: [
      adjustment({}),
      adjustment({
        id: "15706000-0000-4000-8000-000000000002",
        adjustment_date: "2026-09-02",
        amount_cents: 500,
        refund_case_id: null,
      }),
      adjustment({
        id: "15706000-0000-4000-8000-000000000003",
        adjustment_type: "manual_adjustment",
        amount_cents: 900,
        refund_case_id: null,
      }),
    ],
    machinesById: new Map([[machineId, {
      id: machineId,
      machine_label: "Machine A",
    }]]),
    locationNamesById: new Map([
      [currentLocationId, "Current location"],
      [reportedLocationId, "Recorded location"],
    ]),
    refundCasesById: new Map([[
      "15705000-0000-4000-8000-000000000001",
      {
        id: "15705000-0000-4000-8000-000000000001",
        reporting_adjustment_id: null,
        payment_method: "card",
      },
    ]]),
    refundCasesByAdjustmentId: new Map(),
    grain: "day",
    paymentMethods: [],
  });

  assertEquals(rows, [
    {
      period_start: "2026-09-01",
      machine_label: "Machine A",
      location_name: "Recorded location",
      payment_method: "cash",
      net_sales_cents: 10_000,
      refund_amount_cents: 0,
      gross_sales_cents: 10_000,
      transaction_count: 10,
    },
    {
      period_start: "2026-09-01",
      machine_label: "Machine A",
      location_name: "Recorded location",
      payment_method: "credit",
      net_sales_cents: 37_800,
      refund_amount_cents: 2_700,
      gross_sales_cents: 40_500,
      transaction_count: 40,
    },
    {
      period_start: "2026-09-02",
      machine_label: "Machine A",
      location_name: "Recorded location",
      payment_method: "unknown",
      net_sales_cents: -500,
      refund_amount_cents: 500,
      gross_sales_cents: 0,
      transaction_count: 0,
    },
  ]);
});

Deno.test("scheduled card filter does not spread an unknown refund", () => {
  const rows = calculateScheduledSalesReportRows({
    salesFacts: [],
    adjustments: [adjustment({ refund_case_id: null, amount_cents: 500 })],
    machinesById: new Map([[machineId, {
      id: machineId,
      machine_label: "Machine A",
    }]]),
    locationNamesById: new Map([[reportedLocationId, "Recorded location"]]),
    refundCasesById: new Map(),
    refundCasesByAdjustmentId: new Map(),
    grain: "month",
    paymentMethods: ["credit"],
  });

  assertEquals(rows, []);
});

Deno.test("scheduler query ids are split into bounded chunks", () => {
  const values = Array.from({ length: 205 }, (_, index) => String(index));
  assertEquals(
    chunkSalesReportQueryValues(values).map((chunk) => chunk.length),
    [100, 100, 5],
  );
});

Deno.test("scheduler reads every stable page beyond the PostgREST row cap", async () => {
  const source = Array.from({ length: 2_205 }, (_, index) => ({
    id: String(index).padStart(4, "0"),
  }));
  const ranges: Array<[number, number]> = [];

  const rows = await fetchAllSalesReportRows(async (from, to) => {
    ranges.push([from, to]);
    return source.slice(from, to + 1);
  });

  assertEquals(ranges, [[0, 999], [1_000, 1_999], [2_000, 2_999]]);
  assertEquals(rows.length, 2_205);
  assertEquals(rows.at(-1)?.id, "2204");
});
