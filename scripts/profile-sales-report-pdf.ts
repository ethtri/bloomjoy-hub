import process from 'node:process';
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1';
import { buildSalesReportPdf, summarizeSalesReportPdfRows, type SalesReportPdfRow } from '../supabase/functions/_shared/sales-report-pdf.ts';

export function representativeRows(count: number): SalesReportPdfRow[] {
  const unknown = count === 9509 ? 4038 : Math.floor(count * .42);
  const known = count - unknown; const target = count === 9509 ? 28672029 : known * 5231;
  let knownSum = 0;
  return Array.from({ length: count }, (_, i) => {
    const date = new Date('2026-01-01T00:00:00Z'); date.setUTCDate(1 + i % 280);
    const net = i >= known ? null : i === known - 1 ? target - knownSum : Math.floor(target / known) + (i * 7919 % 9000) - 4500;
    knownSum += net ?? 0;
    const refund = i % 19 === 0 ? 700 : i % 31 === 0 ? -700 : 0;
    return { calculation_version: 'shared-sales-basis-v1', period_start: date.toISOString().slice(0,10),
      machine_label: `Representative long machine ${String(i % 40).padStart(2, '0')} label and site`,
      location_name: `Representative location ${i % 7}`, payment_method: i % 3 === 0 ? 'cash' : 'credit',
      net_sales_cents: net, gross_sales_cents: net == null ? null : net + refund,
      refund_amount_cents: i >= known && i % 11 === 0 ? null : refund,
      tax_cents: net == null ? null : 0, transaction_count: i === 0 && count === 9509 ? 1 : 6,
      unresolved_sales_count: net == null ? 6 : 0, unresolved_refund_count: i >= known && i % 11 === 0 ? 1 : 0 };
  });
}

if (import.meta.main) {
  await Deno.mkdir("output/pdf", { recursive: true });
  const values = Deno.args.filter(value => !value.startsWith("--"));
  const sizes = values.length ? values.map(Number) : [225, 9509, 15680];
  const baseline = Deno.args.includes("--baseline");
  const build = baseline ? (await import(new URL("../output/pdf-baseline.ts", import.meta.url).href)).buildSalesReportPdf : buildSalesReportPdf;
  for (const size of sizes) {
    const rows = representativeRows(size); const start = performance.now(); const cpu = process.cpuUsage();
    const parsedRows = JSON.parse(JSON.stringify(rows)).sort((left: SalesReportPdfRow, right: SalesReportPdfRow) => String(left.period_start).localeCompare(String(right.period_start)));
    const summary = summarizeSalesReportPdfRows(parsedRows);
    const bytes = await build({ rows: parsedRows, summary, dateFrom: '2026-01-01', dateTo: '2026-10-07', grain: 'day', snapshotId: 'synthetic-cpu-profile', generatedAt: '2026-10-08T06:00:00Z' });
    const elapsed = process.cpuUsage(cpu);
    const cpuMs = (elapsed.user + elapsed.system) / 1000; const wallMs = performance.now() - start;
    const totalCpu = process.cpuUsage();
    const coldProcessCpuMs = (totalCpu.user + totalCpu.system) / 1000;
    const memory = process.memoryUsage(); // Capture before QA reparses the finished PDF.
    const pdf = await PDFDocument.load(bytes);
    await Deno.writeFile(`output/pdf/${baseline ? "baseline-" : ""}sales-${size}.pdf`, bytes);
    console.log(JSON.stringify({ size, pages: pdf.getPageCount(), bytes: bytes.length, cpuMs, wallMs, coldProcessCpuMs,
      rssMb: memory.rss / 1048576, heapUsedMb: memory.heapUsed / 1048576,
      knownNet: summary.knownNetSalesCents, knownRows: summary.knownNetRowCount }));
  }
}
