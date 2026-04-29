import { supabaseClient } from '@/lib/supabaseClient';

export type AdminAccessReviewSeverity = 'urgent' | 'soon' | 'review';

export type AdminAccessReviewItem = {
  id: string;
  kind: string;
  severity: AdminAccessReviewSeverity;
  personEmail: string | null;
  userId: string | null;
  sourceLabel: string;
  scopeLabel: string;
  reason: string | null;
  expiresAt: string | null;
  reviewBy: string | null;
  actionLabel: string;
  workspaceSearch: string | null;
  daysUntilDue: number | null;
};

export type AdminAccessReviewQueue = {
  generatedAt: string | null;
  windowDays: number;
  items: AdminAccessReviewItem[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const asNullableString = (value: unknown) => (typeof value === 'string' ? value : null);
const asNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeSeverity = (value: unknown): AdminAccessReviewSeverity => {
  if (value === 'urgent' || value === 'soon' || value === 'review') return value;
  return 'review';
};

const mapReviewItem = (item: unknown): AdminAccessReviewItem => {
  const record = isRecord(item) ? item : {};

  return {
    id: asString(record.id),
    kind: asString(record.kind, 'access_review'),
    severity: normalizeSeverity(record.severity),
    personEmail: asNullableString(record.personEmail),
    userId: asNullableString(record.userId),
    sourceLabel: asString(record.sourceLabel, 'Access source'),
    scopeLabel: asString(record.scopeLabel, 'Scope not recorded'),
    reason: asNullableString(record.reason),
    expiresAt: asNullableString(record.expiresAt),
    reviewBy: asNullableString(record.reviewBy),
    actionLabel: asString(record.actionLabel, 'Review access'),
    workspaceSearch: asNullableString(record.workspaceSearch),
    daysUntilDue:
      record.daysUntilDue === null || record.daysUntilDue === undefined
        ? null
        : asNumber(record.daysUntilDue, 0),
  };
};

export const fetchAdminAccessReviewQueue = async ({
  windowDays = 30,
  limit = 100,
}: {
  windowDays?: number;
  limit?: number;
} = {}): Promise<AdminAccessReviewQueue> => {
  const { data, error } = await supabaseClient.rpc('admin_get_access_review_queue', {
    p_window_days: windowDays,
    p_limit: limit,
  });

  if (error) {
    throw new Error(error.message || 'Unable to load access review queue.');
  }

  const record = isRecord(data) ? data : {};
  const items = Array.isArray(record.items) ? record.items.map(mapReviewItem).filter((item) => item.id) : [];

  return {
    generatedAt: asNullableString(record.generatedAt),
    windowDays: asNumber(record.windowDays, windowDays),
    items,
  };
};
