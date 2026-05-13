export const sanitizeDiagnosticMessage = (value) =>
  String(value ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/Task\s*No\.?\s*:?\s*[A-Za-z0-9-]{4,}/gi, 'Task No.:[id]')
    .replace(/\b[A-Za-z0-9][A-Za-z0-9-]{15,}\b/g, '[id]')
    .replace(/\b\d{6,}\b/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800);

export const sanitizeUiSummaryForDiagnostic = (uiSummary) =>
  uiSummary
    ? {
        uiWindowStart: uiSummary.uiWindowStart ?? null,
        uiWindowEnd: uiSummary.uiWindowEnd ?? null,
        uiWindowSource: uiSummary.uiWindowSource ?? null,
        selectedPreset: uiSummary.selectedPreset ?? null,
        uiRecordCount: uiSummary.uiRecordCount ?? null,
        uiRecordCountTrusted: uiSummary.uiRecordCountTrusted === true,
        uiRecordCountSource: uiSummary.uiRecordCountSource ?? null,
        uiRecordCountCandidates: uiSummary.uiRecordCountCandidates ?? [],
        uiRevenueCents: uiSummary.uiRevenueCents ?? null,
        uiRevenueCandidatesCents: uiSummary.uiRevenueCandidatesCents ?? [],
        uiRevenueTrusted: uiSummary.uiRevenueTrusted === true,
        uiRevenueSource: uiSummary.uiRevenueSource ?? null,
      }
    : null;

export const summarizeRowsByDateForLog = (rows, machineCodes = []) => {
  const summaryMachines = machineCodes.map((machineCode, index) => ({
    machineCode,
    label: `summaryMachine${index + 1}`,
  }));
  const summaryLabelsByMachineCode = new Map(
    summaryMachines.map(({ machineCode, label }) => [machineCode, label])
  );
  const byDate = new Map();

  for (const row of rows) {
    if (!byDate.has(row.saleDate)) {
      byDate.set(row.saleDate, {
        date: row.saleDate,
        rowCount: 0,
        machineCounts: Object.fromEntries(summaryMachines.map(({ label }) => [label, 0])),
      });
    }

    const dateSummary = byDate.get(row.saleDate);
    dateSummary.rowCount += 1;
    const summaryLabel = summaryLabelsByMachineCode.get(row.machineCode);
    if (summaryLabel) {
      dateSummary.machineCounts[summaryLabel] += 1;
    }
  }

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
};

const getFailureName = (error) =>
  sanitizeDiagnosticMessage(error instanceof Error ? error.name : 'Error') || 'Error';

const getFailureMessage = (error) =>
  sanitizeDiagnosticMessage(error instanceof Error ? error.message : String(error ?? 'Unknown error')) ||
  'Sunze sync failed. See sanitized diagnostic artifact.';

export const buildSanitizedFailureError = (error) => {
  const safeError = new Error(getFailureMessage(error));
  safeError.name = getFailureName(error);
  return safeError;
};

export const buildFailureDiagnostic = ({ error, diagnostic, generatedAt = new Date().toISOString() }) => ({
  ...(diagnostic ?? {}),
  ok: false,
  generatedAt,
  failure: {
    name: getFailureName(error),
    message: getFailureMessage(error),
  },
});
