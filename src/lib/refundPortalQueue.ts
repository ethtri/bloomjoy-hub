export type RefundPortalQueueItem = {
  caseId: string;
  publicReference: string;
  amountCents: number | null;
  currencyCode: string | null;
  machineLabel: string;
  locationName: string;
  createdAt: string;
  view: 'all_open' | 'decisions' | 'waiting_on_customer' | 'completed' | 'internal_test';
  isOpen: boolean;
  decisionReady: boolean;
  nextWorkActor: 'agent' | 'customer' | 'manager' | 'system';
  nextWorkActionCode: string;
  nextWorkActionLabel: string;
  payloadRedacted: true;
};

export type RefundPortalQueueProjection = {
  schemaVersion: 'refund_portal_queue_v1';
  observedAt: string;
  counts: {
    allOpen: number;
    decisions: number;
    waitingOnCustomer: number;
    completed: number;
    internalTest: number;
  };
  items: RefundPortalQueueItem[];
  refundOperationsAccess: boolean;
  payloadRedacted: true;
};

const refundPortalQueueViews = new Set([
  'all_open', 'decisions', 'waiting_on_customer', 'completed', 'internal_test',
]);
const refundPortalQueueActors = new Set(['agent', 'customer', 'manager', 'system']);

const refundPortalQueueCount = (value: unknown) => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('Unsupported refund queue summary.');
  }
  return value as number;
};

export const parseRefundPortalQueueProjection = (
  value: unknown,
): RefundPortalQueueProjection => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Unsupported refund queue summary.');
  }
  const root = value as Record<string, unknown>;
  const counts = root.counts && typeof root.counts === 'object' && !Array.isArray(root.counts)
    ? root.counts as Record<string, unknown>
    : null;
  if (
    root.schemaVersion !== 'refund_portal_queue_v1' ||
    root.payloadRedacted !== true ||
    typeof root.observedAt !== 'string' || Number.isNaN(Date.parse(root.observedAt)) ||
    typeof root.refundOperationsAccess !== 'boolean' ||
    !counts || !Array.isArray(root.items)
  ) {
    throw new Error('Unsupported refund queue summary.');
  }

  const items = root.items.map((raw): RefundPortalQueueItem => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Unsupported refund queue summary.');
    }
    const item = raw as Record<string, unknown>;
    if (
      typeof item.caseId !== 'string' || !item.caseId.trim() ||
      typeof item.publicReference !== 'string' || !item.publicReference.trim() ||
      (item.amountCents !== null && (!Number.isSafeInteger(item.amountCents) || Number(item.amountCents) < 0)) ||
      (item.currencyCode !== null && typeof item.currencyCode !== 'string') ||
      typeof item.machineLabel !== 'string' || typeof item.locationName !== 'string' ||
      typeof item.createdAt !== 'string' || Number.isNaN(Date.parse(item.createdAt)) ||
      !refundPortalQueueViews.has(String(item.view)) || typeof item.isOpen !== 'boolean' ||
      typeof item.decisionReady !== 'boolean' ||
      !refundPortalQueueActors.has(String(item.nextWorkActor)) ||
      typeof item.nextWorkActionCode !== 'string' ||
      typeof item.nextWorkActionLabel !== 'string' || !item.nextWorkActionLabel.trim() ||
      item.payloadRedacted !== true
    ) {
      throw new Error('Unsupported refund queue summary.');
    }
    return item as RefundPortalQueueItem;
  });
  if (new Set(items.map((item) => item.caseId)).size !== items.length) {
    throw new Error('Unsupported refund queue summary.');
  }

  const parsedCounts = {
    allOpen: refundPortalQueueCount(counts.allOpen),
    decisions: refundPortalQueueCount(counts.decisions),
    waitingOnCustomer: refundPortalQueueCount(counts.waitingOnCustomer),
    completed: refundPortalQueueCount(counts.completed),
    internalTest: refundPortalQueueCount(counts.internalTest),
  };
  const itemCounts = {
    allOpen: items.filter((item) => item.isOpen && item.view !== 'internal_test').length,
    decisions: items.filter((item) => item.view === 'decisions').length,
    waitingOnCustomer: items.filter((item) => item.view === 'waiting_on_customer').length,
    completed: items.filter((item) => item.view === 'completed').length,
    internalTest: items.filter((item) => item.view === 'internal_test').length,
  };
  if (Object.keys(parsedCounts).some((key) =>
    parsedCounts[key as keyof typeof parsedCounts] !== itemCounts[key as keyof typeof itemCounts]) ||
    items.some((item) =>
      item.isOpen !== ['all_open', 'decisions', 'waiting_on_customer'].includes(item.view) ||
      item.decisionReady !== (item.view === 'decisions')) ||
    (root.refundOperationsAccess === false && parsedCounts.internalTest > 0)) {
    throw new Error('Unsupported refund queue summary.');
  }

  return {
    schemaVersion: 'refund_portal_queue_v1',
    observedAt: root.observedAt,
    counts: parsedCounts,
    items,
    refundOperationsAccess: root.refundOperationsAccess,
    payloadRedacted: true,
  };
};

/** Search spans customer views; internal archives remain a separate scope. */
export const filterRefundPortalQueue = (
  items: RefundPortalQueueItem[], view: string, search: string,
): RefundPortalQueueItem[] => {
  const query = search.trim().toLocaleLowerCase();
  return items.filter((item) => {
    if ((item.view === 'internal_test') !== (view === 'internal_test')) return false;
    if (query) return [item.publicReference, item.machineLabel, item.locationName]
      .some((value) => value.toLocaleLowerCase().includes(query));
    return view === 'all_open' ? item.isOpen : item.view === view;
  }).sort((left, right) => {
    if (view === 'all_open') {
      const priority = (item: RefundPortalQueueItem) => Number(item.decisionReady ||
        item.nextWorkActionCode === 'send_cash_refund_and_confirm');
      const difference = priority(right) - priority(left);
      if (difference) return difference;
    }
    return Date.parse(left.createdAt) - Date.parse(right.createdAt);
  });
};

