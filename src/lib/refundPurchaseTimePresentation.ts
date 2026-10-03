import type { RefundCandidateTimeEvidence } from './refundTimePresentation.ts';
import { isRefundTimeZone, refundProviderTimeLabel } from './refundTimePresentation.ts';

type Candidate = {
  providerTimestampAt?: string | null;
  authorizedAt?: string | null;
  machineAuthorizationTime?: string | null;
  timeEvidence?: RefundCandidateTimeEvidence | null;
};
type Selected = {
  providerTimestampAt?: string | null;
  providerAuthorizedAt?: string | null;
  machineTimezone?: string | null;
  timeEvidence?: RefundCandidateTimeEvidence | null;
};

export const getRefundPurchaseTimePresentation = ({ candidate, selected, venueTimezone }: {
  candidate?: Candidate | null;
  selected?: Selected | null;
  venueTimezone?: string | null;
}) => {
  const evidence = candidate?.timeEvidence ?? selected?.timeEvidence;
  const providerAt = candidate?.providerTimestampAt ?? candidate?.authorizedAt ?? selected?.providerTimestampAt;
  // The saved field named providerAuthorizedAt contains the machine clock value,
  // not Nayax's separate GMT authorization timestamp.
  const machineAt = candidate?.machineAuthorizationTime ?? selected?.providerAuthorizedAt;
  const machineTimezone = isRefundTimeZone(evidence?.machineClockTimezone)
    ? evidence.machineClockTimezone
    : isRefundTimeZone(selected?.machineTimezone) ? selected.machineTimezone : null;
  const usingSavedMachineTime = !providerAt && Boolean(machineAt);
  return {
    evidence,
    displayAt: providerAt ?? machineAt,
    displayTimezone: usingSavedMachineTime ? machineTimezone : venueTimezone,
    label: usingSavedMachineTime ? 'Saved machine time; supporting context' : refundProviderTimeLabel(evidence),
    usingSavedMachineTime,
    machineAt,
    machineTimezone,
    machineTimezoneVerified: evidence?.machineClockSource === 'native_machine_configuration' &&
      isRefundTimeZone(evidence.machineClockTimezone),
  };
};
