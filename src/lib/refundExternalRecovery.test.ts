/// <reference lib="deno.ns" />
import { buildExternalRecoveryEvidence, parseExternalRecoveryOptions, type ExternalRecoveryForm } from './refundExternalRecovery.ts';
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const v = { schemaVersion: 'refund_external_recovery_v1', available: true, recorded: false,
  caseId: 'bf400000-0000-4000-8000-000000000001', caseReference: 'RF-RECOVERY-1', expectedCaseVersion: 3,
  oldMachineId: 'bf300000-0000-4000-8000-000000000001', customerEmail: 'customer@example.invalid', cardLast4: '4242',
  reportedAmountCents: 3200, reviewBinding: 'a'.repeat(64), targets: [{ machineId: 'bf300000-0000-4000-8000-000000000002',
    machineLabel: 'Verified fixture', inventoryId: 'bf600000-0000-4000-8000-000000000002', inventoryDigest: 'b'.repeat(64),
    accountScope: 'FIXTURE', providerMachineId: '12345', machineNumber: '12345AutoFwp$r' }] };
const form: ExternalRecoveryForm = { targetMachineId: v.targets[0].machineId, transactionId: '12345678', siteId: '4',
  machineTime: '2026-09-01T16:35:00', amount: '32.10', providerMessageId: 'a100000000000001', providerThreadId: 'a200000000000001',
  rfcMessageId: '<synthetic@example.invalid>', sentAt: '2026-09-03T16:00:00Z', ccEmails: 'manager@example.invalid', subject: 'Refund confirmed',
  plainBody: 'Your $32.10 refund for RF-RECOVERY-1 is confirmed. Allow a few business days.' };
const fail = (fn: () => unknown) => { let rejected = false; try { fn(); } catch { rejected = true; } assert(rejected, 'invalid proof must be rejected'); };
Deno.test('external recovery binds current machine and full provider amount without rewriting reported total', () => {
  const options = parseExternalRecoveryOptions(v);
  const e = buildExternalRecoveryEvidence(options, form, true);
  assert(e.originalAmountCents === 3210 && e.refundedAmountCents === 3210 && options.reportedAmountCents === 3200, 'amounts stay distinct');
  assert(e.machineNumber === '12345AutoFwp$r' && e.cardLast4 === '4242' && e.expectedCaseVersion === 3, 'identity is source-bound');
  assert(!('status' in e) && !('decision' in e) && !('paymentAmountCents' in e), 'no caller approval or customer fact changes');
});
Deno.test('review and current exact target are required; unsafe IDs, ambiguous times and different notices fail', () => {
  const options = parseExternalRecoveryOptions(v);
  fail(() => buildExternalRecoveryEvidence(options, form, false));
  for (const patch of [{ targetMachineId: 'other' }, { amount: '0' }, { amount: '32.1001' }, { transactionId: 'unsafe/path' },
    { sentAt: '2026-09-03T16:00:00' }, { rfcMessageId: 'missing brackets' }, { ccEmails: '' },
    { plainBody: 'Your $32.00 refund for RF-RECOVERY-1 is complete.' }, { plainBody: 'Your $32.10 refund for another case is complete.' }])
    fail(() => buildExternalRecoveryEvidence(options, { ...form, ...patch }, true));
  fail(() => buildExternalRecoveryEvidence({ ...options, recorded: true }, form, true));
});
Deno.test('unrecognized or incomplete recovery authority is rejected', () => {
  fail(() => parseExternalRecoveryOptions({ ...v, reviewBinding: null }));
  fail(() => parseExternalRecoveryOptions({ ...v, targets: [{ ...v.targets[0], inventoryDigest: 'bad' }] }));
  fail(() => parseExternalRecoveryOptions({ ...v, schemaVersion: 'unknown' }));
});
