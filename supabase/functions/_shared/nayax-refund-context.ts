import { parseNayaxMachineAuthorizationTime } from './nayax-machine-authorization-time.mjs';

export type NayaxRefundExecutionContext = {
  contextHash: string; caseId: string; caseVersion: number; attemptGeneration: number;
  transactionId: string; siteId: number; machineAuthorizationTime: string;
  originalAmountCents: number; currencyCode: 'USD'; accountScope: string; providerMachineId: string;
};

export function parseNayaxRefundExecutionContext(value: unknown, expected: {
  caseId: string; caseVersion: number; attemptGeneration: number;
  transactionId: string | null; siteId: number | null; amountCents: number | null;
  accountScope: string | null; providerMachineId: string | null;
}): NayaxRefundExecutionContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.contextHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.contextHash) ||
    v.caseId !== expected.caseId || v.caseVersion !== expected.caseVersion ||
    v.attemptGeneration !== expected.attemptGeneration || v.transactionId !== expected.transactionId ||
    v.siteId !== expected.siteId || !Number.isSafeInteger(v.siteId) || Number(v.siteId) <= 0 ||
    v.originalAmountCents !== expected.amountCents || !Number.isSafeInteger(v.originalAmountCents) || Number(v.originalAmountCents) <= 0 ||
    v.currencyCode !== 'USD' || v.accountScope !== expected.accountScope || v.providerMachineId !== expected.providerMachineId ||
    v.machineAuthorizationTimeSource !== 'MachineAuthorizationTime') return null;
  try { parseNayaxMachineAuthorizationTime(v.machineAuthorizationTime); } catch { return null; }
  return Object.freeze(v as NayaxRefundExecutionContext);
}
