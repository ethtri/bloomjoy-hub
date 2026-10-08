type ReportingFailure = { message?: string; code?: string; details?: string; hint?: string };

export class ReportingRequestError extends Error {
  readonly code?: string;
  readonly details?: string;
  readonly hint?: string;

  constructor(error: ReportingFailure, fallback: string) {
    super(error.message || fallback);
    this.name = 'ReportingRequestError';
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

// Repeating a deterministic timeout immediately repeats the same expensive work.
// A manual refresh remains available; transient failures receive one retry.
export function reportingQueryRetry(failureCount: number, error: unknown): boolean {
  const failure = error && typeof error === 'object' ? error as ReportingFailure : {};
  if (failure.code === '57014' || failure.code === '42501' || failure.code?.startsWith('22')) return false;
  if (/statement timeout|canceling statement|permission denied|authentication required|access required|invalid.*(?:date|range|grain)|unsupported calculation version/i.test(failure.message ?? '')) return false;
  return failureCount < 1;
}
