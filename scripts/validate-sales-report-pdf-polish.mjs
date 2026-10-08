import { readFileSync } from 'node:fs';

const files = {
  sharedBuilder: 'supabase/functions/_shared/sales-report-pdf.ts',
  exportFunction: 'supabase/functions/sales-report-export/index.ts',
  schedulerFunction: 'supabase/functions/sales-report-scheduler/index.ts',
  reportingClient: 'src/lib/reporting.ts',
  reportingUat: 'scripts/validate-reporting-uat.mjs',
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
const exportFunction = read(files.exportFunction);
const schedulerFunction = read(files.schedulerFunction);
const reportingClient = read(files.reportingClient);
const reportingUat = read(files.reportingUat);
const signedExportWindow = read(files.signedExportWindow);
const portalReports = read(files.portalReports);
const adminReporting = read(files.adminReporting);
const smokeChecklist = read(files.smokeChecklist);

assert(
  sharedBuilder.includes('SALES_REPORT_PDF_GENERATOR_VERSION = "sales-report-pdf/company-v5"'),
  'Operator PDF builder must expose the shared-basis generator version.',
);

assert(
  reportingUat.includes("pdfGeneratorVersion: 'sales-report-pdf/polished-v1'") &&
    reportingUat.includes('await exportButton.click()') &&
    reportingUat.includes("waitForRecordedRequest(page, state.operatorExports, 'Operator export request')"),
  'Reporting UAT must exercise the live frontend export flow against the supported rolling-release v1 response.',
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
  sharedBuilder.includes('summary.grossSalesCents == null') &&
    sharedBuilder.includes('formatKnownSalesReportSubtotal(summary.knownGrossSalesCents, summary.knownGrossRowCount)') &&
    sharedBuilder.includes('Known net subtotal') &&
    sharedBuilder.includes('refund components have missing amount or original-date tax details') &&
    sharedBuilder.includes('paid in period') &&
    sharedBuilder.includes('outstanding') &&
    sharedBuilder.includes('usesSharedSalesBasis ? "Sales ex tax" : "Gross sales"'),
  'Operator PDF totals must separate tax, recognized refund impact, paid context, and outstanding context.',
);

assert(
  sharedBuilder.includes('formatRefundImpactCurrency') &&
    sharedBuilder.includes('value > 0 ? "-" : "+"') &&
    !sharedBuilder.includes('formatDeductionCurrency'),
  'Operator PDFs must display negative signed refund impact as a positive reversal.',
);

assert(
  exportFunction.includes('All: Cash, Card, Other, Unknown') &&
    schedulerFunction.includes('All: Cash, Card, Other, Unknown'),
  'Interactive and scheduled PDF exports must identify the complete default payment scope.',
);

assert(
  schedulerFunction.includes('sales_report_scheduler_get_sales_report_complete') &&
    schedulerFunction.includes('p_actor_user_id: schedule.created_by') &&
    !schedulerFunction.includes('.from("machine_sales_facts")') &&
    !schedulerFunction.includes('.from("sales_adjustment_facts")'),
  'Scheduled exports must use the explicit-actor shared report RPC instead of duplicating calculation logic.',
);

assert(
  reportingClient.includes('supportedSalesReportPdfGeneratorVersions = new Set([') &&
    reportingClient.includes("'sales-report-pdf/polished-v1'") &&
    reportingClient.includes("'sales-report-pdf/shared-basis-v2'") &&
    reportingClient.includes('normalizeSalesReportCalculationVersion(row.calculation_version)') &&
    reportingClient.includes("'legacy-sales-basis-v0' | 'shared-sales-basis-v1'") &&
    reportingClient.includes("supportedSalesReportPdfGeneratorVersions.has(response.pdfGeneratorVersion ?? '')") &&
    reportingClient.includes('outdated PDF generator'),
  'Portal report exports must accept both rolling-release generators and block missing or unknown versions.',
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
    portalReports.includes("'reports.taxExclusiveSales'") &&
    portalReports.includes("'reports.periodRefundImpact'") &&
    portalReports.includes("'reports.salesAfterPeriodRefunds'") &&
    !portalReports.includes("? 'reports.taxRemovedWithUnresolved'"),
  'Portal reporting must keep one payment filter and use the shared-basis labels.',
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
