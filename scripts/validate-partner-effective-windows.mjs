import { readFileSync } from 'node:fs';

const files = {
  migration: 'supabase/migrations/202605070002_partner_effective_window_reporting.sql',
  exportFunction: 'supabase/functions/partner-report-export/index.ts',
  schedulerMigration: 'supabase/migrations/202605070001_partner_report_scheduler_pdf_export.sql',
  smokeChecklist: 'Docs/QA_SMOKE_TEST_CHECKLIST.md',
  weeklyPreviewSmoke: 'Docs/WEEKLY_PREVIEW_SMOKE_TEST.md',
};

const read = (path) => readFileSync(path, 'utf8');
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const maxDate = (left, right) => (left > right ? left : right);
const minDate = (left, right) => (left < right ? left : right);

const boundPartnershipWindow = ({
  status,
  effectiveStart,
  effectiveEnd,
  periodStart,
  periodEnd,
}) => {
  const overlaps = status === 'active' &&
    effectiveStart <= periodEnd &&
    (effectiveEnd === null || effectiveEnd >= periodStart);

  if (!overlaps) {
    return {
      included: false,
      amountAllowed: false,
      trimmed: false,
      includedStart: null,
      includedEnd: null,
    };
  }

  const includedStart = maxDate(periodStart, effectiveStart);
  const includedEnd = minDate(periodEnd, effectiveEnd ?? periodEnd);

  return {
    included: includedStart <= includedEnd,
    amountAllowed: includedStart <= includedEnd,
    trimmed: includedStart !== periodStart || includedEnd !== periodEnd,
    includedStart,
    includedEnd,
  };
};

const cases = [
  {
    name: 'archived partnership blocks settlement',
    input: {
      status: 'archived',
      effectiveStart: '2026-04-01',
      effectiveEnd: null,
      periodStart: '2026-04-06',
      periodEnd: '2026-04-12',
    },
    expected: { included: false, amountAllowed: false, trimmed: false },
  },
  {
    name: 'period fully before partnership start blocks settlement',
    input: {
      status: 'active',
      effectiveStart: '2026-04-01',
      effectiveEnd: null,
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31',
    },
    expected: { included: false, amountAllowed: false, trimmed: false },
  },
  {
    name: 'period fully after partnership end blocks settlement',
    input: {
      status: 'active',
      effectiveStart: '2026-04-01',
      effectiveEnd: '2026-04-30',
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
    },
    expected: { included: false, amountAllowed: false, trimmed: false },
  },
  {
    name: 'partial weekly start trims included dates',
    input: {
      status: 'active',
      effectiveStart: '2026-04-09',
      effectiveEnd: null,
      periodStart: '2026-04-06',
      periodEnd: '2026-04-12',
    },
    expected: {
      included: true,
      amountAllowed: true,
      trimmed: true,
      includedStart: '2026-04-09',
      includedEnd: '2026-04-12',
    },
  },
  {
    name: 'partial monthly end trims included dates',
    input: {
      status: 'active',
      effectiveStart: '2026-04-01',
      effectiveEnd: '2026-04-20',
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
    },
    expected: {
      included: true,
      amountAllowed: true,
      trimmed: true,
      includedStart: '2026-04-01',
      includedEnd: '2026-04-20',
    },
  },
  {
    name: 'open-ended partnership keeps full selected period',
    input: {
      status: 'active',
      effectiveStart: '2026-04-01',
      effectiveEnd: null,
      periodStart: '2026-04-06',
      periodEnd: '2026-04-12',
    },
    expected: {
      included: true,
      amountAllowed: true,
      trimmed: false,
      includedStart: '2026-04-06',
      includedEnd: '2026-04-12',
    },
  },
  {
    name: 'wider assignment and rule windows remain bounded by partnership',
    input: {
      status: 'active',
      effectiveStart: '2026-04-10',
      effectiveEnd: '2026-04-20',
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
      assignmentStart: '2026-01-01',
      assignmentEnd: null,
      ruleStart: '2026-01-01',
      ruleEnd: null,
    },
    expected: {
      included: true,
      amountAllowed: true,
      trimmed: true,
      includedStart: '2026-04-10',
      includedEnd: '2026-04-20',
    },
  },
];

for (const { name, input, expected } of cases) {
  const result = boundPartnershipWindow(input);
  for (const [key, value] of Object.entries(expected)) {
    assert(
      result[key] === value,
      `${name}: expected ${key}=${value}, received ${result[key]}`,
    );
  }

  if (input.assignmentStart || input.ruleStart) {
    const assignmentCoversPeriod = input.assignmentStart <= input.periodEnd &&
      (input.assignmentEnd === null || input.assignmentEnd >= input.periodStart);
    const ruleCoversPeriod = input.ruleStart <= input.periodEnd &&
      (input.ruleEnd === null || input.ruleEnd >= input.periodStart);

    assert(assignmentCoversPeriod, `${name}: fixture assignment must cover the unbounded period.`);
    assert(ruleCoversPeriod, `${name}: fixture rule must cover the unbounded period.`);
    assert(
      result.includedStart === input.effectiveStart && result.includedEnd === input.effectiveEnd,
      `${name}: partnership dates must be the narrowing window even when assignment/rule dates are wider.`,
    );
  }
}

const migration = read(files.migration);
const exportFunction = read(files.exportFunction);
const schedulerMigration = read(files.schedulerMigration);
const smokeChecklist = read(files.smokeChecklist);
const weeklyPreviewSmoke = read(files.weeklyPreviewSmoke);

assert(
  migration.includes("partnership_row.status = 'active'") &&
    migration.includes('active_period_windows') &&
    migration.includes('active_period_start') &&
    migration.includes('active_period_end'),
  'Partner preview SQL must derive active period windows from active partnerships only.',
);

assert(
  migration.includes('fact.sale_date between period.active_period_start and period.active_period_end') &&
    migration.includes('adjustment.adjustment_date between period.active_period_start and period.active_period_end') &&
    migration.includes('review.refund_date between period.active_period_start and period.active_period_end'),
  'Partner preview SQL must bound sales facts, refund facts, and refund review warnings to the active partnership window.',
);

assert(
  migration.includes("'warning_type', 'inactive_partnership'") &&
    migration.includes("'warning_type', 'partnership_effective_window_excluded'") &&
    migration.includes("'warning_type', 'partnership_effective_window_trimmed'") &&
    migration.includes("'severity', 'non_blocking'"),
  'Partner preview SQL must surface inactive, fully excluded, and partial trimming states.',
);

assert(
  !exportFunction.includes('"admin_preview_partner_weekly_report"') &&
    exportFunction.includes('periodPreviewRpcName') &&
    exportFunction.includes('mapPeriodPreviewToPartnerReportPreview'),
  'Manual partner exports must load previews through the shared period preview RPC path.',
);

assert(
  exportFunction.includes('partner_report_scheduler_preview_partner_period_report') &&
    schedulerMigration.includes('return public.admin_preview_partner_period_report_internal'),
  'Scheduled partner PDF exports must use the service-role period preview wrapper backed by the hardened internal RPC.',
);

assert(
  smokeChecklist.includes('partnership effective window') &&
    weeklyPreviewSmoke.includes('effective_end_date = null') &&
    weeklyPreviewSmoke.includes('partial weeks/months'),
  'Reporting QA docs must document the active-window boundary rule.',
);

console.log('Partner effective-window validation passed.');
