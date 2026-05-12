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

export const buildFailureDiagnostic = ({ error, diagnostic, generatedAt = new Date().toISOString() }) => ({
  ...(diagnostic ?? {}),
  ok: false,
  generatedAt,
  failure: {
    name: error instanceof Error ? error.name : 'Error',
    message: sanitizeDiagnosticMessage(error instanceof Error ? error.message : String(error ?? 'Unknown error')),
  },
});
