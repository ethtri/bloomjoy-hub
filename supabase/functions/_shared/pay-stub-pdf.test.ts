import { assertEquals, assertGreater } from "jsr:@std/assert@1";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { buildPayStubPdf, type PayStubPayload } from "./pay-stub-pdf.ts";

export const samplePayStubPayload: PayStubPayload = {
  schemaVersion: "operator-pay-stub-v2",
  statementNumber: "BJ-STUB-202608-TEST-V1",
  statementLabel: "Pay Stub",
  version: 1,
  statementDate: "2026-09-05",
  entity: { name: "Bloomjoy" },
  contractor: { displayName: "Pilot Technician", positionTitle: "Technician" },
  period: { periodStartDate: "2026-08-01", periodEndDate: "2026-08-31" },
  current: {
    actualMinutes: 61,
    paidShifts: 2,
    shiftEarningsCents: 4000,
    commissionableSalesCents: 8175,
    commissionEarningsCents: 818,
    bonusCents: 0,
    supplyCreditCents: 0,
    expenseReimbursementCents: 0,
    totalEarningsCents: 4818,
  },
  yearToDate: {
    paidShifts: 12,
    shiftEarningsCents: 24000,
    commissionableSalesCents: 58175,
    commissionEarningsCents: 5818,
    bonusCents: 0,
    supplyCreditCents: 0,
    expenseReimbursementCents: 0,
    totalEarningsCents: 29818,
  },
  machines: [{
    machineId: "machine-1",
    machineLabel: "Pilot Machine",
    locationName: "Pilot Location",
    grossSalesCents: 10000,
    refundAdjustmentCents: 1000,
    taxCents: 825,
    commissionableSalesCents: 8175,
    commissionEarningsCents: 818,
    commissionSegments: [{
      segmentStartDate: "2026-08-01",
      segmentEndDate: "2026-08-31",
      taxRatePercent: 8.25,
      commissionBasisPoints: 1000,
      grossSalesCents: 10000,
      refundAdjustmentCents: 1000,
      taxCents: 825,
      commissionableSalesCents: 8175,
      commissionEarningsCents: 818,
    }],
  }],
  classificationNotice: "Independent contractor statement. No payroll withholding or payment execution is represented.",
};

Deno.test("Pay Stub PDF includes a summary and commission appendix", async () => {
  const bytes = await buildPayStubPdf(samplePayStubPayload);
  assertGreater(bytes.length, 1_000);
  const pdf = await PDFDocument.load(bytes);
  assertEquals(pdf.getPageCount(), 2);
  assertEquals(pdf.getSubject(), "bloomjoy-pay-stub-pdf-v1");
});
