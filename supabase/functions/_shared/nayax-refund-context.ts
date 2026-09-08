import {
  buildNayaxMachineAuthorizationTimeWireValue,
  parseNayaxMachineAuthorizationTime,
} from './nayax-machine-authorization-time.mjs';

export type NayaxRefundExecutionContext = {
  contextHash: string; caseId: string; caseVersion: number; attemptGeneration: number;
  transactionId: string; siteId: number; machineAuthorizationTime: string;
  machineAuthorizationTimeInstant: string;
  machineAuthorizationTimeWire: string;
  refundEmailListMode: 'omit' | 'empty_string';
  machineAuthorizationTimeSerializationMode:
    | 'exact_source'
    | 'source_with_bound_offset';
  machineAuthorizationTimeSerializationSource:
    | 'exact_source'
    | 'selected_normalized_instant';
  originalAmountCents: number; currencyCode: 'USD'; accountScope: string; providerMachineId: string;
};

export function parseNayaxRefundExecutionContext(value: unknown, expected: {
  caseId: string; caseVersion: number; attemptGeneration: number;
  transactionId: string | null; siteId: number | null; amountCents: number | null;
  accountScope: string | null; providerMachineId: string | null;
  machineAuthorizationInstant: string | null;
}): NayaxRefundExecutionContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const refundEmailListMode = v.refundEmailListMode ?? 'omit';
  if (refundEmailListMode !== 'omit' && refundEmailListMode !== 'empty_string') return null;
  if (typeof v.contextHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.contextHash) ||
    v.caseId !== expected.caseId || v.caseVersion !== expected.caseVersion ||
    v.attemptGeneration !== expected.attemptGeneration || v.transactionId !== expected.transactionId ||
    v.siteId !== expected.siteId || !Number.isSafeInteger(v.siteId) || Number(v.siteId) <= 0 ||
    v.originalAmountCents !== expected.amountCents || !Number.isSafeInteger(v.originalAmountCents) || Number(v.originalAmountCents) <= 0 ||
    v.currencyCode !== 'USD' || v.accountScope !== expected.accountScope || v.providerMachineId !== expected.providerMachineId ||
    v.machineAuthorizationTimeSource !== 'MachineAuthorizationTime') return null;
  const boundInstant = Date.parse(String(v.machineAuthorizationTimeInstant));
  const expectedInstant = Date.parse(String(expected.machineAuthorizationInstant));
  if (
    !Number.isFinite(boundInstant) ||
    !Number.isFinite(expectedInstant) ||
    boundInstant !== expectedInstant ||
    !new Set(['exact_source', 'source_with_bound_offset']).has(
      String(v.machineAuthorizationTimeSerializationMode),
    )
  ) return null;
  const mode = v.machineAuthorizationTimeSerializationMode as
    | 'exact_source'
    | 'source_with_bound_offset';
  const expectedSource = mode === 'exact_source'
    ? 'exact_source'
    : 'selected_normalized_instant';
  if (v.machineAuthorizationTimeSerializationSource !== expectedSource) return null;
  try {
    parseNayaxMachineAuthorizationTime(v.machineAuthorizationTime);
    const wire = buildNayaxMachineAuthorizationTimeWireValue({
      rawValue: v.machineAuthorizationTime,
      normalizedInstant: v.machineAuthorizationTimeInstant,
      mode,
    });
    if (v.machineAuthorizationTimeWire !== wire) return null;
  } catch {
    return null;
  }
  return Object.freeze({ ...v, refundEmailListMode } as NayaxRefundExecutionContext);
}
