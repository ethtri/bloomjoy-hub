export type RefundDueWorkHealth = {
  status: 'healthy' | 'degraded' | 'instrumentation_unavailable';
  sourceCoverage: string[];
  observationsComplete: boolean;
  observedAt: string | null;
  dueCount: number | null;
  overdueCount: number | null;
  awaitingDecisionCount: number | null;
  oldestDecisionAt: string | null;
  oldestOverdueAt: string | null;
  customerWaitCount: number | null;
  unknownHoldCount: number | null;
  technicalOwner: { route: string; availability: 'unverified'; activity: null; required: boolean };
};

export function parseRefundDueWorkHealth(value: unknown): RefundDueWorkHealth {
  const unavailable: RefundDueWorkHealth = {
    status: 'instrumentation_unavailable', sourceCoverage: [], observationsComplete: false, observedAt: null,
    dueCount: null, overdueCount: null, awaitingDecisionCount: null, oldestDecisionAt: null,
    oldestOverdueAt: null, customerWaitCount: null, unknownHoldCount: null,
    technicalOwner: { route: 'bloomjoy-technical-incident-repair', availability: 'unverified', activity: null, required: false },
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable;
  const data = value as Record<string, unknown>;
  const counts = ['dueCount', 'overdueCount', 'awaitingDecisionCount', 'customerWaitCount', 'unknownHoldCount'] as const;
  if (data.schemaVersion !== 'refund_due_work_health_v1' || data.payloadRedacted !== true ||
    !['healthy', 'degraded', 'instrumentation_unavailable'].includes(String(data.status)) ||
    counts.some((key) => !Number.isSafeInteger(data[key]) || Number(data[key]) < 0)) return unavailable;
  const owner = data.technicalOwner && typeof data.technicalOwner === 'object'
    ? data.technicalOwner as Record<string, unknown> : {};
  return {
    ...unavailable, status: data.status as RefundDueWorkHealth['status'],
    sourceCoverage: Array.isArray(data.sourceCoverage) ? data.sourceCoverage.filter((entry): entry is string => typeof entry === 'string') : [],
    observationsComplete: data.observationsComplete === true,
    observedAt: typeof data.observedAt === 'string' ? data.observedAt : null,
    dueCount: Number(data.dueCount), overdueCount: Number(data.overdueCount),
    awaitingDecisionCount: Number(data.awaitingDecisionCount), customerWaitCount: Number(data.customerWaitCount),
    unknownHoldCount: Number(data.unknownHoldCount),
    oldestDecisionAt: typeof data.oldestDecisionAt === 'string' ? data.oldestDecisionAt : null,
    oldestOverdueAt: typeof data.oldestOverdueAt === 'string' ? data.oldestOverdueAt : null,
    technicalOwner: { ...unavailable.technicalOwner, required: owner.required === true },
  };
}
