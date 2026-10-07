/// <reference lib="deno.ns" />
import { customerRefundPublication, isExactMachineRefundReader, machineRefundAvailability } from './machineRefundReadiness.ts';

const setup = {
  id: 'machine-1', nayaxMachineId: 'reader-1', nayaxAccountKey: 'ACCOUNT',
  customerIntakeAccepting: false, transactionMatchingEnabled: true,
  transactionLookupReady: false, managerRoutingReady: true,
  nayaxRefundsEnabled: false, readinessState: 'setup_needed' as const,
  readinessBlockReason: 'customer_intake_unavailable', paymentDisabledReason: null,
};
const reader = {
  id: 'inventory-1', reportingMachineId: 'machine-1', nayaxMachineId: 'reader-1',
  accountKey: 'ACCOUNT', state: 'excluded' as const, providerActive: true,
  missingSuccessfulSnapshots: 0, exclusionReason: 'Legacy pilot exclusion',
};
const global = { available: true, paused: false };
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };

Deno.test('an exactly connected excluded reader explains customer refunds without claiming mapping is missing', () => {
  assert(isExactMachineRefundReader(setup, reader), 'Reader should be connected');
  const status = machineRefundAvailability(setup, global, reader);
  assert(status.label === 'Customer refunds off', status.label);
  assert(status.reason.includes('connected reader is excluded'), status.reason);
});

Deno.test('one explicit publication action uses saved reader and known product without activating payments', () => {
  const input = { setup, reader, machineType: 'commercial', machineStatus: 'active' };
  const publication = customerRefundPublication(input);
  assert(publication?.inventoryId === reader.id && publication.reportingMachineId === setup.id, 'Exact IDs retained');
  assert(publication?.state === 'published' && publication.category === 'cotton_candy', 'Known cotton-candy category');
  assert(!('nayaxRefundsEnabled' in (publication ?? {})), 'Publication must not activate processing');
  assert(customerRefundPublication({ ...input, machineType: 'snapcase' })?.category === 'snapcase', 'Known Snapcase category');
});

Deno.test('publication rejects inactive, stale, unknown, missing-manager and mismatched reader states', () => {
  const input = { setup, reader, machineType: 'commercial', machineStatus: 'active' };
  const invalid = [
    { ...input, machineStatus: 'inactive' }, { ...input, catalogueInactive: true },
    { ...input, machineType: 'unknown' }, { ...input, setup: null },
    { ...input, reader: null }, { ...input, setup: { ...setup, managerRoutingReady: false } },
    { ...input, reader: { ...reader, providerActive: false } },
    { ...input, reader: { ...reader, missingSuccessfulSnapshots: 2 } },
    { ...input, reader: { ...reader, accountKey: 'OTHER_ACCOUNT' } },
    { ...input, reader: { ...reader, reportingMachineId: 'other-machine' } },
    { ...input, reader: { ...reader, nayaxMachineId: 'other-reader' } },
    { ...input, reader: { ...reader, state: 'published' as const } },
  ];
  for (const state of invalid) assert(customerRefundPublication(state) === null, 'Unsafe publication must be unavailable');
});

Deno.test('payment capability and provider availability remain independent after customer publication', () => {
  const published = { ...setup, customerIntakeAccepting: true, transactionLookupReady: true, readinessState: 'ready_to_activate' as const };
  assert(machineRefundAvailability(published, global).label === 'Card refunds off', 'Publishing is not payment activation');
  const activated = { ...published, nayaxRefundsEnabled: true, readinessState: 'ready_to_refund' as const };
  assert(machineRefundAvailability(activated, { available: false, paused: true }).label === 'Card refunds paused', 'Global pause retained');
  assert(machineRefundAvailability(activated, { available: false, paused: false }).label === 'Card refunds unavailable', 'Global availability retained');
  assert(machineRefundAvailability(activated, global).label === 'Ready to refund', 'All gates ready');
});

Deno.test('an unrelated excluded inventory row cannot explain another machine as excluded', () => {
  const status = machineRefundAvailability(setup, global, { ...reader, accountKey: 'OTHER_ACCOUNT' });
  assert(!status.reason.includes('excluded'), 'Cross-account exclusion must not be attributed');
});
