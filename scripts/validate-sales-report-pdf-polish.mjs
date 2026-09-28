import { readFileSync } from 'node:fs';

const files = {
  sharedBuilder: 'supabase/functions/_shared/sales-report-pdf.ts',
  calculation: 'supabase/functions/_shared/sales-report-calculation.ts',
  exportFunction: 'supabase/functions/sales-report-export/index.ts',
  schedulerFunction: 'supabase/functions/sales-report-scheduler/index.ts',
  reportingClient: 'src/lib/reporting.ts',
  signedExportWindow: 'src/lib/signedExportWindow.ts',
  portalReports: 'src/pages/portal/Reports.tsx',
  adminReporting: 'src/pages/admin/Reporting.tsx',
  smokeChecklist: 'Docs/QA_SMOKE_TEST_CHECKLIST.md',
};

const read = (path) => readFileSync(path, 'utf8');
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const sharedBuilder = read(files.sharedBuilder);
const calculation = read(files.calculation);
const exportFunction = read(files.exportFunction);
const schedulerFunction = read(files.schedulerFunction);
const reportingClient = read(files.reportingClient);
const signedExportWindow = read(files.signedExportWindow);
const portalReports = read(files.portalReports);
const adminReporting = read(files.adminReporting);
const smokeChecklist = read(files.smokeChecklist);

assert(
  sharedBuilder.includes('SALES_REPORT_PDF_GENERATOR_VERSION = "sales-report-pdf/polished-v1"'),
  'Operator PDF builder must expose the polished generator version.',
);

assert(
  sharedBuilder.includes('PDFDocument.create()') &&
    sharedBuilder.includes('StandardFonts.Helvetica') &&
    sharedBuilder.includes('drawDashboardPage') &&
    sharedBuilder.includes('drawReportRowsPage') &&
    sharedBuilder.includes('Machine rollup') &&
    sharedBuilder.includes('Report row appendix'),
  'Operator PDF builder must keep the branded dashboard plus row appendix layout.',
);

assert(
  !sharedBuilder.includes('StandardFonts.Courier') &&
    !sharedBuilder.includes('StandardFonts.CourierBold'),
  'Operator PDF builder must not regress to a monospaced legacy text dump.',
);

assert(
  sharedBuilder.includes('const rollupCardHeight = 210') &&
    sharedBuilder.includes('y -= rollupCardHeight + 42') &&
    sharedBuilder.includes('if (additionalRollups > 0)'),
  'Operator PDF machine rollup summary must reserve space for continuation notes.',
);

assert(
  exportFunction.includes('SALES_REPORT_PDF_GENERATOR_VERSION') &&
    exportFunction.includes('pdfGeneratorVersion: SALES_REPORT_PDF_GENERATOR_VERSION') &&
    exportFunction.includes('buildSalesReportPdf({'),
  'sales-report-export must return the polished generator version from the shared builder.',
);

assert(
  sharedBuilder.includes('label: "Recorded sales"') &&
    sharedBuilder.includes('label: "Reported refunds"') &&
    sharedBuilder.includes('label: "Sales after refunds"') &&
    !sharedBuilder.includes('label: "Gross sales"') &&
    !sharedBuilder.includes('label: "Net sales"'),
  'Operator PDF totals must describe recorded sales, reported refunds, and sales after refunds.',
);

assert(
  exportFunction.includes('All: Cash, Card, Other, Unknown') &&
    schedulerFunction.includes('All: Cash, Card, Other, Unknown'),
  'Interactive and scheduled PDF exports must identify the complete default payment scope.',
);

assert(
  calculation.includes('adjustment.source === "nayax_provider_refund"') &&
    calculation.includes('refundCase?.payment_method === "card"') &&
    calculation.includes('return "unknown"') &&
    calculation.includes('net_sales_cents: Number(row.gross_sales_cents ?? 0) -') &&
    schedulerFunction.includes('calculateScheduledSalesReportRows({') &&
    !schedulerFunction.includes('allocatedRefunds'),
  'Scheduled exports must use evidence-based refund tender and subtract refunds exactly once.',
);

assert(
  reportingClient.includes("expectedSalesReportPdfGeneratorVersion = 'sales-report-pdf/polished-v1'") &&
    reportingClient.includes('response.pdfGeneratorVersion !== expectedSalesReportPdfGeneratorVersion') &&
    reportingClient.includes('outdated PDF generator'),
  'Portal report exports must block stale sales-report-export responses instead of opening them.',
);

assert(
  signedExportWindow.includes("window.open('about:blank', '_blank')") &&
    signedExportWindow.includes('target.location.href = signedUrl') &&
    signedExportWindow.includes('window.location.assign(signedUrl)'),
  'Report exports must reserve a browser window before async signed URL work.',
);

assert(
  portalReports.includes('reserveSignedExportWindow()') &&
    portalReports.includes('openSignedExportUrl(exportResult.signedUrl, exportWindow)') &&
    portalReports.includes('closeReservedSignedExportWindow(exportWindow)'),
  'Portal report exports must use the reserved signed export window helper.',
);

assert(
  portalReports.includes("t('reports.paymentScopeHelp')") &&
    portalReports.includes("t('reports.recordedSales')") &&
    portalReports.includes("t('reports.reportedRefunds')") &&
    portalReports.includes("t('reports.salesAfterRefunds')"),
  'Portal reporting must keep one payment filter and use the corrected sales labels.',
);

assert(
  adminReporting.includes('reserveSignedExportWindow()') &&
    adminReporting.includes('openSignedExportUrl(signedUrl, exportWindow)') &&
    adminReporting.includes('closeReservedSignedExportWindow(exportWindow)'),
  'Admin report artifact exports must use the reserved signed export window helper.',
);

assert(
  smokeChecklist.includes('stale legacy export responses without the polished generator version are blocked'),
  'Reporting smoke tests must cover the stale operator PDF deployment guard.',
);

console.log('Sales report PDF polish validation passed.');
