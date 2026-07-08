import { readFileSync } from 'node:fs';

const files = {
  sharedBuilder: 'supabase/functions/_shared/sales-report-pdf.ts',
  exportFunction: 'supabase/functions/sales-report-export/index.ts',
  reportingClient: 'src/lib/reporting.ts',
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
const reportingClient = read(files.reportingClient);
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
  exportFunction.includes('SALES_REPORT_PDF_GENERATOR_VERSION') &&
    exportFunction.includes('pdfGeneratorVersion: SALES_REPORT_PDF_GENERATOR_VERSION') &&
    exportFunction.includes('buildSalesReportPdf({'),
  'sales-report-export must return the polished generator version from the shared builder.',
);

assert(
  reportingClient.includes("expectedSalesReportPdfGeneratorVersion = 'sales-report-pdf/polished-v1'") &&
    reportingClient.includes('response.pdfGeneratorVersion !== expectedSalesReportPdfGeneratorVersion') &&
    reportingClient.includes('outdated PDF generator'),
  'Portal report exports must block stale sales-report-export responses instead of opening them.',
);

assert(
  smokeChecklist.includes('stale legacy export responses without the polished generator version are blocked'),
  'Reporting smoke tests must cover the stale operator PDF deployment guard.',
);

console.log('Sales report PDF polish validation passed.');
