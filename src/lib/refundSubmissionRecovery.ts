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

const submissionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const receiptIsUsable = (value: unknown): value is StoredRefundSubmissionReceipt => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  const statusToken = receipt.statusToken;
  const expiresAt = receipt.statusExpiresAt;

  return typeof receipt.publicReference === 'string'
    && receipt.publicReference.trim().length > 0
    && (statusToken === null || (
      typeof statusToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(statusToken)
    ))
    && (expiresAt === null || (
      typeof expiresAt === 'string' && !Number.isNaN(Date.parse(expiresAt))
    ))
    && (
      receipt.paymentMethod === undefined
      || receipt.paymentMethod === 'card'
      || receipt.paymentMethod === 'cash'
    );
};

export const getRefundSubmissionAttempt = (
  current: RefundSubmissionAttempt | null,
  input: Record<string, unknown>,
  createId: () => string = () => crypto.randomUUID(),
): RefundSubmissionAttempt => {
  const payloadFingerprint = JSON.stringify(input);
  if (current?.payloadFingerprint === payloadFingerprint) return current;

  const submissionId = createId().trim().toLowerCase();
  if (!submissionIdPattern.test(submissionId)) {
    throw new Error('Unable to prepare a safe refund submission. Reload the page and try again.');
  }
  return { payloadFingerprint, submissionId };
};

export const storeRefundSubmissionReceipt = (
  storage: Pick<Storage, 'setItem'>,
  receipt: StoredRefundSubmissionReceipt,
) => {
  storage.setItem(REFUND_SUBMISSION_RECEIPT_KEY, JSON.stringify(receipt));
};

export const readRefundSubmissionReceipt = (
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
): StoredRefundSubmissionReceipt | null => {
  const raw = storage.getItem(REFUND_SUBMISSION_RECEIPT_KEY);
  if (!raw) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (!receiptIsUsable(value)) throw new Error('Invalid refund receipt');
    if (value.statusExpiresAt && Date.parse(value.statusExpiresAt) <= Date.now()) {
      storage.removeItem(REFUND_SUBMISSION_RECEIPT_KEY);
      return { ...value, statusToken: null, statusExpiresAt: null };
    }
    return value;
  } catch {
    storage.removeItem(REFUND_SUBMISSION_RECEIPT_KEY);
    return null;
  }
};
