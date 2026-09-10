export const REFUND_SUBMISSION_ATTEMPT_KEY = 'bloomjoy-refund-submission-attempt';
export const REFUND_SUBMISSION_RECEIPT_KEY = 'bloomjoy-refund-submission-receipt';

export type RefundSubmissionAttempt = {
  payloadFingerprint: string;
  submissionId: string;
};

export type StoredRefundSubmissionReceipt = {
  publicReference: string;
  statusToken: string | null;
  statusExpiresAt: string | null;
  paymentMethod?: 'card' | 'cash';
};

type RefundStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

export type RefundThankYouNavigationState = {
  reference?: string;
  statusToken?: string | null;
  statusExpiresAt?: string | null;
  paymentMethod?: 'card' | 'cash';
};

const submissionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fingerprintPattern = /^[0-9a-f]{64}$/;

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
};

export const fingerprintRefundSubmission = async (input: Record<string, unknown>) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(canonicalize(input))),
  );
  return bytesToHex(new Uint8Array(digest));
};

const parseAttempt = (value: unknown): RefundSubmissionAttempt | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const attempt = value as Record<string, unknown>;
  return typeof attempt.submissionId === 'string'
    && submissionIdPattern.test(attempt.submissionId)
    && typeof attempt.payloadFingerprint === 'string'
    && fingerprintPattern.test(attempt.payloadFingerprint)
    ? {
        submissionId: attempt.submissionId,
        payloadFingerprint: attempt.payloadFingerprint,
      }
    : null;
};

const readJson = (storage: RefundStorage, key: string): unknown => {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const removeBestEffort = (storage: RefundStorage, key: string) => {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

const writeBestEffort = (storage: RefundStorage, key: string, value: unknown) => {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const readRefundSubmissionAttempt = (
  storage: RefundStorage,
): RefundSubmissionAttempt | null => parseAttempt(readJson(storage, REFUND_SUBMISSION_ATTEMPT_KEY));

export const prepareRefundSubmissionAttempt = async ({
  current,
  input,
  storage,
  createId = () => crypto.randomUUID(),
}: {
  current: RefundSubmissionAttempt | null;
  input: Record<string, unknown>;
  storage: RefundStorage | null;
  createId?: () => string;
}): Promise<{ attempt: RefundSubmissionAttempt; persisted: boolean }> => {
  const payloadFingerprint = await fingerprintRefundSubmission(input);
  const stored = storage ? readRefundSubmissionAttempt(storage) : null;
  const reusable = [current, stored].find(
    (attempt) => attempt?.payloadFingerprint === payloadFingerprint,
  );
  const submissionId = reusable?.submissionId ?? createId().trim().toLowerCase();
  if (!submissionIdPattern.test(submissionId)) {
    throw new Error('Unable to prepare a safe refund submission. Reload the page and try again.');
  }
  const attempt = { payloadFingerprint, submissionId };
  return {
    attempt,
    persisted: storage ? writeBestEffort(storage, REFUND_SUBMISSION_ATTEMPT_KEY, attempt) : false,
  };
};

export const clearRefundSubmissionAttempt = (storage: RefundStorage | null) =>
  storage ? removeBestEffort(storage, REFUND_SUBMISSION_ATTEMPT_KEY) : false;

const receiptIsUsable = (value: unknown): value is StoredRefundSubmissionReceipt => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  return typeof receipt.publicReference === 'string'
    && receipt.publicReference.trim().length > 0
    && (receipt.statusToken === null || (
      typeof receipt.statusToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(receipt.statusToken)
    ))
    && (receipt.statusExpiresAt === null || (
      typeof receipt.statusExpiresAt === 'string' && !Number.isNaN(Date.parse(receipt.statusExpiresAt))
    ))
    && (
      receipt.paymentMethod === undefined
      || receipt.paymentMethod === 'card'
      || receipt.paymentMethod === 'cash'
    );
};

export const storeRefundSubmissionReceipt = (
  storage: RefundStorage | null,
  receipt: StoredRefundSubmissionReceipt,
) => storage ? writeBestEffort(storage, REFUND_SUBMISSION_RECEIPT_KEY, receipt) : false;

export const readRefundSubmissionReceipt = (
  storage: RefundStorage | null,
): StoredRefundSubmissionReceipt | null => {
  if (!storage) return null;
  const value = readJson(storage, REFUND_SUBMISSION_RECEIPT_KEY);
  if (!receiptIsUsable(value)) {
    if (value !== null) removeBestEffort(storage, REFUND_SUBMISSION_RECEIPT_KEY);
    return null;
  }
  if (value.statusExpiresAt && Date.parse(value.statusExpiresAt) <= Date.now()) {
    removeBestEffort(storage, REFUND_SUBMISSION_RECEIPT_KEY);
    return { ...value, statusToken: null, statusExpiresAt: null };
  }
  return value;
};

export const getRefundSessionStorage = (): RefundStorage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export const resolveRefundThankYouContext = ({
  navigationState,
  hasQueryReference,
  queryReference,
  savedReceipt,
}: {
  navigationState: RefundThankYouNavigationState | null;
  hasQueryReference: boolean;
  queryReference: string | null;
  savedReceipt: StoredRefundSubmissionReceipt | null;
}) => {
  const navigationReference = navigationState?.reference?.trim() ?? '';
  const hasNavigationContext = Boolean(navigationState);
  const canUseSavedReceipt = !hasNavigationContext && !hasQueryReference;
  const reference = navigationReference
    || (hasQueryReference ? queryReference?.trim() ?? '' : '')
    || (canUseSavedReceipt ? savedReceipt?.publicReference ?? '' : '');
  const hasExplicitNavigationToken = Boolean(
    navigationState && Object.prototype.hasOwnProperty.call(navigationState, 'statusToken'),
  );
  const statusToken = hasExplicitNavigationToken
    ? navigationState?.statusToken ?? null
    : canUseSavedReceipt
      ? savedReceipt?.statusToken ?? null
      : null;
  const paymentMethod = navigationState?.paymentMethod
    ?? (canUseSavedReceipt ? savedReceipt?.paymentMethod : undefined);

  return { reference, statusToken, paymentMethod };
};
