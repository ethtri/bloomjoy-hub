import { normalizeMachineType } from './machineTypes.ts';

type RefundSetup = {
  id: string;
  nayaxMachineId: string | null;
  nayaxAccountKey: string | null;
  customerIntakeAccepting: boolean;
  transactionMatchingEnabled: boolean;
  transactionLookupReady: boolean;
  managerRoutingReady: boolean;
  nayaxRefundsEnabled: boolean;
  readinessState: 'ready_to_refund' | 'ready_to_activate' | 'setup_needed';
  readinessBlockReason: string | null;
  paymentDisabledReason: string | null;
};

type RefundReader = {
  id: string;
  reportingMachineId: string | null;
  nayaxMachineId: string;
  accountKey: string;
  state: 'published' | 'needs_setup' | 'excluded';
  providerActive: boolean;
  missingSuccessfulSnapshots: number;
  exclusionReason: string | null;
};

export const isExactMachineRefundReader = (setup: RefundSetup | null | undefined, reader: RefundReader | null | undefined) =>
  !!setup && !!reader && reader.reportingMachineId === setup.id &&
  reader.nayaxMachineId.trim() === setup.nayaxMachineId?.trim() &&
  reader.accountKey.trim().toUpperCase() === (setup.nayaxAccountKey?.trim().toUpperCase() || 'TGPACI_USA_DB');

/** Presentation never treats a missing refund capability as a missing source/reader mapping. */
export const machineRefundAvailability = (
  setup: RefundSetup | null | undefined,
  global: { available: boolean; paused: boolean },
  reader?: RefundReader | null,
) => {
  if (!setup) return { label: 'Refund status unavailable', reason: 'Refund settings could not be loaded.' };
  if (!setup.customerIntakeAccepting) {
    if (isExactMachineRefundReader(setup, reader) && reader?.state === 'excluded') {
      return { label: 'Customer refunds off', reason: 'This connected reader is excluded from customer refund requests.' };
    }
    return { label: 'Customer refunds off', reason: 'This machine is unavailable in the customer refund form.' };
  }
  if (!setup.transactionMatchingEnabled) return { label: 'Card refunds off', reason: 'Transaction matching is off.' };
  if (!setup.transactionLookupReady) return { label: 'Card refunds off', reason: 'The connected reader is not published for refund transaction lookup.' };
  if (!setup.managerRoutingReady) return { label: 'Card refunds off', reason: 'Assign and save one to four Machine Managers.' };
  if (!setup.nayaxRefundsEnabled) {
    const pauseReasons: Record<string, string> = {
      owner_pause: 'Card-refund processing is paused by the owner.',
      provider_support: 'Card-refund processing is paused for provider support.',
      machine_maintenance: 'Card-refund processing is paused for machine maintenance.',
      commercial_exception: 'Card-refund processing is off for an approved commercial exception.',
    };
    return { label: 'Card refunds off', reason: pauseReasons[setup.paymentDisabledReason ?? ''] ?? 'Customer requests are enabled. Card-refund processing awaits activation.' };
  }
  if (global.paused) return { label: 'Card refunds paused', reason: 'Card-refund processing is paused for all machines.' };
  if (!global.available) return { label: 'Card refunds unavailable', reason: 'The direct Nayax refund API is unavailable.' };
  return { label: 'Ready to refund', reason: 'Customer requests, transaction lookup and card-refund processing are available.' };
};

/** Build the existing publishing action only for the exact saved connection.
 * Server authorization, freshness and live-machine checks remain authoritative.
 * This action never enables card-refund processing or changes reader ownership.
 */
export const customerRefundPublication = ({
  setup, reader, machineType, machineStatus, catalogueInactive = false,
}: {
  setup: RefundSetup | null | undefined;
  reader: RefundReader | null | undefined;
  machineType: string | null | undefined;
  machineStatus: string;
  catalogueInactive?: boolean;
}) => {
  const type = normalizeMachineType(machineType);
  if (!setup || !reader || !isExactMachineRefundReader(setup, reader) ||
    !type || machineStatus !== 'active' || catalogueInactive ||
    !reader.providerActive || reader.missingSuccessfulSnapshots >= 2 ||
    !setup.managerRoutingReady || reader.state === 'published') return null;
  return {
    inventoryId: reader.id,
    state: 'published' as const,
    category: type === 'snapcase' ? 'snapcase' as const : 'cotton_candy' as const,
    reportingMachineId: setup.id,
    exclusionReason: null,
    reason: 'Explicitly enabled customer refund requests for the saved exact machine reader',
  };
};
