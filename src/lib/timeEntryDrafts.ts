export type TimeEntryDraftFields = {
  workDate: string;
  machineId: string;
  startTime: string;
  endTime: string;
};

export type TimeEntryDraftScope = {
  userId: string;
  accountId: string;
  profileId: string;
  entryId: string | null;
};

export type TimeEntryDraft = {
  version: 1;
  revision: string;
  updatedAt: string;
  originalUpdatedAt: string | null;
  fields: TimeEntryDraftFields;
};

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
export const TIME_DRAFT_PREFIX = 'bloomjoy-time-draft:v1:';
export const TIME_DRAFT_USER_KEY = 'bloomjoy-time-draft-user';
let activeUserId: string | null | undefined;
export const isTimeEntryDraftUserActive = (userId: string) => activeUserId === userId;

export const timeEntryDraftKey = (scope: TimeEntryDraftScope) =>
  TIME_DRAFT_PREFIX + [scope.userId, scope.accountId, scope.profileId, scope.entryId ? `edit:${scope.entryId}` : 'new']
    .map(encodeURIComponent).join(':');

const browserStorage = () => window.localStorage;

/** Called for a verified auth identity transition, never temporary access hydration. */
export const setTimeEntryDraftUser = (userId: string | null, storage?: DraftStorage) => {
  activeUserId = userId;
  let target: DraftStorage;
  try {
    target = storage ?? browserStorage();
  } catch {
    return;
  }
  // Other tabs check this marker before writing, including before their auth event arrives.
  // A full store may reject writes while still allowing private data to be removed.
  let markerWritten = false;
  try { target.setItem(TIME_DRAFT_USER_KEY, userId ?? ''); markerWritten = true; } catch { /* Continue cleanup. */ }
  try {
    const keepPrefix = userId ? `${TIME_DRAFT_PREFIX}${encodeURIComponent(userId)}:` : null;
    const keys = Array.from({ length: target.length }, (_, index) => target.key(index));
    keys.forEach((key) => {
      if (key?.startsWith(TIME_DRAFT_PREFIX) && (!keepPrefix || !key.startsWith(keepPrefix))) {
        try { target.removeItem(key); } catch { /* Continue cleanup of other keys. */ }
      }
    });
  } catch {
    // Storage denial must never prevent authentication or time entry.
  }
  if (!markerWritten) {
    try { target.setItem(TIME_DRAFT_USER_KEY, userId ?? ''); } catch { /* Storage remains unavailable. */ }
  }
};

const validDate = (value: unknown): value is string => {
  if (value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const validTime = (value: unknown): value is string =>
  typeof value === 'string' && (value === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(value));

export const parseTimeEntryDraft = (raw: string | null): TimeEntryDraft | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as TimeEntryDraft;
    if (value.version !== 1 || typeof value.revision !== 'string' || !value.revision ||
        typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)) ||
        !(value.originalUpdatedAt === null || (typeof value.originalUpdatedAt === 'string' && Number.isFinite(Date.parse(value.originalUpdatedAt)))) ||
        !value.fields || !validDate(value.fields.workDate) ||
        typeof value.fields.machineId !== 'string' || value.fields.machineId.length > 200 ||
        !validTime(value.fields.startTime) || !validTime(value.fields.endTime)) return null;
    // Only the explicitly supported form fields are ever returned or persisted.
    return { version: 1, revision: value.revision, updatedAt: value.updatedAt,
      originalUpdatedAt: value.originalUpdatedAt,
      fields: { workDate: value.fields.workDate, machineId: value.fields.machineId,
        startTime: value.fields.startTime, endTime: value.fields.endTime } };
  } catch {
    return null;
  }
};

export type DraftResult = { status: 'ready'; draft: TimeEntryDraft | null } |
  { status: 'unavailable' | 'changed'; draft?: never };

export const readTimeEntryDraft = (scope: TimeEntryDraftScope, storage?: DraftStorage): DraftResult => {
  try {
    const target = storage ?? browserStorage();
    if (activeUserId !== scope.userId || target.getItem(TIME_DRAFT_USER_KEY) !== scope.userId) {
      return { status: 'unavailable' };
    }
    return { status: 'ready', draft: parseTimeEntryDraft(target.getItem(timeEntryDraftKey(scope))) };
  } catch {
    return { status: 'unavailable' };
  }
};

export const writeTimeEntryDraft = (
  scope: TimeEntryDraftScope,
  fields: TimeEntryDraftFields,
  expectedRevision: string | null,
  originalUpdatedAt: string | null,
  storage?: DraftStorage,
): DraftResult => {
  try {
    const target = storage ?? browserStorage();
    const current = readTimeEntryDraft(scope, target);
    if (current.status !== 'ready') return current;
    if ((current.draft?.revision ?? null) !== expectedRevision) return { status: 'changed' };
    const draft: TimeEntryDraft = {
      version: 1, revision: crypto.randomUUID(), updatedAt: new Date().toISOString(),
      originalUpdatedAt,
      fields: { workDate: fields.workDate, machineId: fields.machineId, startTime: fields.startTime, endTime: fields.endTime },
    };
    target.setItem(timeEntryDraftKey(scope), JSON.stringify(draft));
    return { status: 'ready', draft };
  } catch {
    return { status: 'unavailable' };
  }
};

/** A save response or discard may remove only the exact revision it captured. */
export const clearTimeEntryDraft = (
  scope: TimeEntryDraftScope, revision: string, storage?: DraftStorage,
): boolean => {
  try {
    const target = storage ?? browserStorage();
    const current = readTimeEntryDraft(scope, target);
    if (current.status !== 'ready' || current.draft?.revision !== revision) return false;
    target.removeItem(timeEntryDraftKey(scope));
    return true;
  } catch {
    return false;
  }
};

export const getEditDraftConflict = (
  draft: TimeEntryDraft,
  entry: { id: string; operatorProfileId: string; updatedAt: string; technicianEditable: boolean } | null,
  scope: TimeEntryDraftScope,
): 'missing' | 'changed' | 'locked' | null => {
  if (!scope.entryId) return null;
  if (!entry || entry.id !== scope.entryId || entry.operatorProfileId !== scope.profileId) return 'missing';
  if (entry.updatedAt !== draft.originalUpdatedAt) return 'changed';
  if (!entry.technicianEditable) return 'locked';
  return null;
};
