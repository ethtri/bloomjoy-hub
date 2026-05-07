import { readFileSync } from 'node:fs';

const files = {
  exportFunction: 'supabase/functions/partner-report-export/index.ts',
  migration: 'supabase/migrations/202605070001_partner_report_scheduler_pdf_export.sql',
};

const read = (path) => readFileSync(path, 'utf8');
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const exportFunction = read(files.exportFunction);
const migration = read(files.migration);

assert(
  exportFunction.includes('buildPartnerReportArtifact') &&
    exportFunction.includes('buildPartnerReportPdf(context)') &&
    exportFunction.includes('buildPartnerReportCsv(context)') &&
    exportFunction.includes('buildPartnerReportXlsx(context)'),
  'Partner export function must keep one shared artifact builder for PDF/CSV/XLSX.',
);

assert(
  exportFunction.includes('REPORT_SCHEDULER_SECRET') &&
    exportFunction.includes('handleScheduledPdfExport') &&
    exportFunction.includes('Authorization") !== `Bearer ${schedulerSecret}`'),
  'Scheduled partner PDF endpoint path must enforce the scheduler secret.',
);

assert(
  exportFunction.includes('partner_report_scheduler_preview_partner_period_report') &&
    exportFunction.includes('actorUserId: null') &&
    exportFunction.includes('createSignedUrl: false'),
  'Scheduled partner PDF generation must use the service-role preview path without a browser user token or signed URL creation.',
);

assert(
  exportFunction.includes('String(warning.severity ?? "blocking").toLowerCase() !== "non_blocking"'),
  'Blocking warning semantics must treat anything other than non_blocking as blocking.',
);

assert(
  exportFunction.includes('status: "blocked"') &&
    exportFunction.includes('warning_gate_status: "blocked"') &&
    exportFunction.includes('snapshot_id: null') &&
    exportFunction.includes('artifact_storage_path: null') &&
    exportFunction.includes('artifact_generated_at: null'),
  'Scheduled blocking runs must record warnings and clear snapshot/artifact fields.',
);

assert(
  exportFunction.includes('snapshot_id: artifact.snapshotId') &&
    exportFunction.includes('artifact_storage_path: artifact.storagePath') &&
    exportFunction.includes('artifact_format: "pdf"') &&
    exportFunction.includes('artifact_generated_at: artifact.generatedAt'),
  'Passing scheduled PDF runs must write snapshot and artifact linkage to the run record.',
);

assert(
  migration.includes('partner_report_scheduler_preview_partner_period_report') &&
    migration.includes("auth.role() is distinct from 'service_role'") &&
    migration.includes('revoke execute on function public.partner_report_scheduler_preview_partner_period_report') &&
    migration.includes('from public, anon, authenticated') &&
    migration.includes('to service_role'),
  'Scheduler preview RPC must be service-role-only and keep public/anon/authenticated closed.',
);

console.log('Partner scheduled PDF export validation passed.');
