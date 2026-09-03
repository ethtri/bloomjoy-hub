import { parseNayaxMachineAuthorizationTime } from './nayax-machine-authorization-time.mjs';

export type NayaxRefundVerification = {
  id: string; caseId: string; caseVersion: number; attemptGeneration: number;
  transactionId: string; siteId: number; machineAuthorizationTime: string;
  remainingRefundableAmountCents: number; currencyCode: 'USD'; observedAt: string; expiresAt: string;
};

export function parseNayaxRefundVerification(value: unknown, expected: {
  caseId: string; caseVersion: number; attemptGeneration: number;
  transactionId: string | null; siteId: number | null; amountCents: number | null;
}, now = Date.now()): NayaxRefundVerification | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v.id) ||
    v.caseId !== expected.caseId || v.caseVersion !== expected.caseVersion ||
    v.attemptGeneration !== expected.attemptGeneration || v.transactionId !== expected.transactionId ||
    v.siteId !== expected.siteId || !Number.isSafeInteger(v.siteId) || Number(v.siteId) <= 0 ||
    v.remainingRefundableAmountCents !== expected.amountCents ||
    !Number.isSafeInteger(v.remainingRefundableAmountCents) || Number(v.remainingRefundableAmountCents) <= 0 ||
    v.currencyCode !== 'USD' || typeof v.expiresAt !== 'string' || typeof v.observedAt !== 'string' ||
    Date.parse(v.expiresAt) - Date.parse(v.observedAt) !== 300_000 ||
    !(Date.parse(v.expiresAt) > now && Date.parse(v.observedAt) <= now + 60_000)) return null;
  try { parseNayaxMachineAuthorizationTime(v.machineAuthorizationTime); } catch { return null; }
  return Object.freeze(v as NayaxRefundVerification);
}
