import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream,
} from "https://esm.sh/pdf-lib@1.17.1";
import { representativeRows } from "../../../scripts/profile-sales-report-pdf.ts";
import {
  buildMachineRollups, buildSalesReportPdf, SALES_REPORT_PDF_GENERATOR_VERSION,
  summarizeSalesReportPdfRows,
} from "./sales-report-pdf.ts";

for (const size of [225, 9509, 15680]) {
  Deno.test(`PDF preserves every appendix cell and bounded font resources for ${size} mixed rows`, async () => {
    const rows = representativeRows(size);
    const before = JSON.stringify(rows);
    const summary = summarizeSalesReportPdfRows(rows);
    const knownRows = rows.filter(row => row.net_sales_cents != null);
    assertEquals(summary.netSalesCents, null);
    assertEquals(summary.knownNetRowCount, knownRows.length);
    assertEquals(summary.knownNetSalesCents, knownRows.reduce((sum, row) => sum + row.net_sales_cents!, 0));
    assertEquals(summary.transactionCount, rows.reduce((sum, row) => sum + row.transaction_count!, 0));
    assertEquals(summary.unresolvedSalesCount, rows.reduce((sum, row) => sum + row.unresolved_sales_count!, 0));
    assertEquals(summary.unresolvedRefundCount, rows.reduce((sum, row) => sum + row.unresolved_refund_count!, 0));
    const rollups = buildMachineRollups(rows);
    assertEquals(rollups.reduce((sum, row) => sum + row.rowCount, 0), size);
    assertEquals(rollups.reduce((sum, row) => sum + row.netSalesCents, 0), summary.knownNetSalesCents);
    assertEquals(summary.knownNetSalesCents, knownRows.length * 5231);
    assertEquals(size - summary.knownNetRowCount, Math.floor(size * .42));
    const bytes = await buildSalesReportPdf({ rows, summary, dateFrom: "2026-01-01", dateTo: "2026-10-07",
      grain: "day", snapshotId: "large-row-regression", generatedAt: "2026-10-08T06:00:00Z" });
    assertEquals(JSON.stringify(rows), before, "Rendering must not mutate canonical input rows");
    const pdf = await PDFDocument.load(bytes);
    assertEquals(pdf.getSubject(), SALES_REPORT_PDF_GENERATOR_VERSION);
    assertEquals(pdf.getPageCount(), 1 + Math.ceil(size / 26));
    let renderedRows = 0;
    for (const [index, page] of pdf.getPages().slice(1).entries()) {
      const contents = page.node.Contents()!;
      const streams = contents instanceof PDFArray
        ? contents.asArray().map(ref => pdf.context.lookup(ref)) : [contents];
      const operators = streams.map(stream => new TextDecoder().decode(
        decodePDFRawStream(stream as PDFRawStream).decode(),
      )).join("");
      const pageRows = Math.min(26, size - index * 26);
      // Eleven header/footer labels and seven cells per row, including unavailable amounts.
      assertEquals((operators.match(/ Tj/g) ?? []).length, 11 + pageRows * 7);
      const fonts = page.node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
      assert(fonts.keys().length <= 6, "Font resources must be reused rather than allocated per cell");
      renderedRows += pageRows;
    }
    assertEquals(renderedRows, size, "No annual rows may be truncated");
  });
}

Deno.test("annual provisional sections retain all confirmed rows and paginate every estimated component", async () => {
  const rows = representativeRows(9509);
  const confirmed = summarizeSalesReportPdfRows(rows);
  for (const row of rows.slice(0,19)) {
    row.gross_sales_unknown_count=0;
    row.refund_amount_unknown_count=2;
    row.net_sales_unknown_count=3;
    row.tax_policy_evidence = {status:"provisional",estimatedSalesExTaxCents:null,
      estimatedRefundExTaxCents:100,estimatedNetExTaxCents:-100,
      provisionalSalesComponents:0,provisionalRefundComponents:1,provisionalNetComponents:1};
  }
  const before = JSON.stringify(rows);
  const summary = summarizeSalesReportPdfRows(rows);
  assertEquals(summary.knownNetSalesCents,confirmed.knownNetSalesCents);
  assertEquals(summary.netSalesCents,confirmed.netSalesCents);
  assertEquals(summary.unresolvedRefundCount,confirmed.unresolvedRefundCount);
  assertEquals(summary.estimatedRefundExTaxCents,1900);
  assertEquals(summary.estimatedNetExTaxCents,-1900);
  const pdf = await PDFDocument.load(await buildSalesReportPdf({rows,summary}));
  assertEquals(pdf.getPageCount(),1+4+Math.ceil(9509/26));
  assertEquals(JSON.stringify(rows),before);
  const estimatePages = pdf.getPages().slice(1,5);
  let rendered=0;
  for (const page of estimatePages) {
    const contents=page.node.Contents()!;
    const streams=contents instanceof PDFArray ? contents.asArray().map(ref=>pdf.context.lookup(ref)) : [contents];
    const operators=streams.map(stream=>new TextDecoder().decode(decodePDFRawStream(stream as PDFRawStream).decode())).join("");
    const label=[...new TextEncoder().encode("Net: Confirmed")].map(value=>value.toString(16).padStart(2,"0")).join("").toUpperCase();
    rendered+=(operators.toUpperCase().match(new RegExp(label,"g"))??[]).length;
  }
  assertEquals(rendered,19);
});
