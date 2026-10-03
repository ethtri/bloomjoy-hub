import type { RefundCandidateTimeEvidence } from './refundTimePresentation.ts';

export type RefundReviewFactor = { key: string; outcome: string; label: string };
export type RefundReviewCandidateEvidence = {
  matchFactors?: RefundReviewFactor[];
  amountCents?: number | null;
  currencyCode?: string | null;
  amountDeltaCents?: number | null;
  timeDeltaMinutes?: number | null;
  timeEvidence?: RefundCandidateTimeEvidence | null;
  cardLast4?: string | null;
  cardNetwork?: string | null;
  cardLast4Comparison?: string;
  machineStatus?: { state: string; label: string; checkedAt: string } | null;
  nearbyMachineAlerts?: Array<{ category: string; occurredAt: string }>;
};
export type RefundReviewSelectedEvidence = Omit<RefundReviewCandidateEvidence, 'amountCents'> & {
  saleAmountCents?: number | null;
  evidenceSource?: string;
};
export type RefundReviewCustomerEvidence = {
  paymentAmountCents?: number | null;
  cardLast4?: string | null;
  cardNetwork?: string | null;
  cardLast4Source?: string | null;
  cardLast4Provenance?: string | null;
  incidentTimeConfidence?: string | null;
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const validDate = (value: string | null | undefined) => Boolean(value && Number.isFinite(Date.parse(value)));
const knownNetwork = (value: string | null | undefined) => Boolean(value && value !== 'other_unknown');
const amountDifferenceLabel = (minorUnits: number, currencyCode: string | null | undefined) => {
  if (currencyCode) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(Math.abs(minorUnits) / 100);
    } catch { /* Unrecognized provider currency remains unverified. */ }
  }
  return `${Math.abs(minorUnits)} minor currency units (currency unavailable)`;
};

export const getRefundCardNetworkLabel = (value: string | null | undefined) => ({
  visa: 'Visa', mastercard: 'Mastercard', discover: 'Discover', american_express: 'American Express',
  other_unknown: 'Other / customer unsure',
}[value ?? ''] ?? 'Not provided');

/** Display evidence only. This does not rank candidates or determine payment eligibility. */
export const getRefundReviewEvidence = ({ candidate, selected, customer }: {
  candidate?: RefundReviewCandidateEvidence | null;
  selected?: RefundReviewSelectedEvidence | null;
  customer?: RefundReviewCustomerEvidence | null;
}) => {
  const evidence = candidate ?? selected;
  const groups: { supporting: RefundReviewFactor[]; conflicts: RefundReviewFactor[]; uncertainties: RefundReviewFactor[] } = {
    supporting: [], conflicts: [], uncertainties: [],
  };
  if (!evidence) return groups;
  const amount = candidate ? candidate.amountCents : selected?.saleAmountCents;
  const amountDelta = finite(amount) && finite(customer?.paymentAmountCents)
    ? Math.abs(amount - customer.paymentAmountCents)
    : candidate?.amountDeltaCents;
  const comparableTime = evidence.timeEvidence?.occurrenceComparable === true;
  const approximateTime = customer?.incidentTimeConfidence !== 'exact';
  const factors = [...(evidence.matchFactors ?? [])];
  // Older saved evidence can omit card-network and digit factors entirely.
  if (!factors.some((factor) => factor.key === 'card_network')) {
    factors.push({ key: 'card_network', outcome: 'missing', label: 'Card network comparison is unavailable' });
  }
  if (customer?.cardLast4 && evidence.cardLast4 && !factors.some((factor) => factor.key === 'card')) {
    factors.push({ key: 'card', outcome: 'manual', label: 'Card digit comparison needs source context' });
  }
  for (const factor of factors) {
    let group: keyof typeof groups = ['mismatch', 'blocked'].includes(factor.outcome)
      ? 'conflicts' : factor.outcome === 'match' ? 'supporting' : 'uncertainties';
    let label = factor.label;
    if (factor.key === 'customer_time_confidence') group = 'uncertainties';
    if (['provider_time', 'machine_time'].includes(factor.key)) group = 'uncertainties';
    if (factor.key === 'request_time') {
      group = 'uncertainties';
      // A request boundary is context, not evidence identifying this customer's purchase.
      // Preserve the supplied reason: an unknown receipt time differs from provider clock uncertainty.
    }
    if (['time', 'incident_time'].includes(factor.key) && (!comparableTime || approximateTime)) {
      // Preserve explicit conflicts, but never promote a processing-time delta into occurrence proof.
      if (group !== 'conflicts') group = 'uncertainties';
      if (factor.outcome === 'match') {
        label = comparableTime
          ? finite(evidence.timeDeltaMinutes)
            ? `Purchase time is ${Math.abs(evidence.timeDeltaMinutes)} minutes from the customer estimate.`
            : `${factor.label} (customer estimate).`
          : 'Nayax record time may reflect processing; purchase timing remains uncertain.';
      }
    }
    if (factor.key === 'amount' && finite(amountDelta) && amountDelta !== 0) {
      group = factor.outcome === 'mismatch' ? 'conflicts' : 'uncertainties';
      label = `Amount differs by ${amountDifferenceLabel(amountDelta, evidence.currencyCode)}; tax or an estimate may explain it.`;
    }
    if (factor.key === 'card_network') {
      if (!knownNetwork(customer?.cardNetwork)) {
        group = 'uncertainties';
        label = customer?.cardNetwork === 'other_unknown'
          ? 'Customer card network unknown (Other / unsure).'
          : 'Customer card network not provided.';
      } else if (!knownNetwork(evidence.cardNetwork)) {
        group = 'uncertainties';
        label = 'Nayax card network is unavailable.';
      } else if (customer?.cardNetwork !== evidence.cardNetwork) {
        group = 'conflicts';
        label = `Card networks differ: customer ${getRefundCardNetworkLabel(customer?.cardNetwork)}, Nayax ${getRefundCardNetworkLabel(evidence.cardNetwork)}.`;
      } else {
        group = 'supporting';
        label = `Card network matches (${getRefundCardNetworkLabel(evidence.cardNetwork)}).`;
      }
    }
    if (factor.key === 'card' && customer?.cardLast4 && evidence.cardLast4) {
      if (customer.cardLast4 !== evidence.cardLast4) {
        group = evidence.cardLast4Comparison === 'mismatch_negative_unproven_equivalence' || factor.outcome === 'mismatch'
          ? 'conflicts' : 'uncertainties';
        label = group === 'conflicts'
          ? 'Card digits differ and weigh against this sale.'
          : customer.cardLast4Provenance === 'wallet_device_token' || customer.cardLast4Source === 'wallet_device'
            ? 'Reported wallet/device digits differ from Nayax; equivalence is unverified.'
            : 'Card digits differ; their sources may not be comparable.';
      } else if (factor.outcome === 'match') {
        label = 'Card digits match.';
      }
    }
    groups[group].push({ ...factor, label });
  }
  return groups;
};

export const getRefundSelectionPresentation = (input: {
  evidenceSource?: string | null;
  recommendationState?: string | null;
  locallySelected?: boolean;
  events?: Array<{ id: string; eventType: string; message: string | null; createdAt: string }>;
}) => {
  const event = (input.events ?? []).filter((item) =>
    ['nayax_match_selected', 'nayax_match_preselected'].includes(item.eventType) && validDate(item.createdAt)
  ).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const sourceLabel = input.locallySelected ? 'Chosen in this review; not yet saved'
    : input.evidenceSource === 'manual_nayax_portal' ? 'Saved Nayax portal evidence'
    : input.evidenceSource === 'nayax_last_sales' ? 'Saved Nayax Last Sales evidence'
    : input.evidenceSource === 'selected_case_record' ? 'Saved case evidence'
    : 'Saved selection; source unavailable';
  return {
    title: 'Selected for review',
    sourceLabel,
    rationale: null,
    rationaleHint: 'Selection reason unavailable.',
    // The event projection has no transaction ID or actor identity. It cannot attest to the current selection.
    history: event ? {
      eventId: event.id,
      recordedAt: event.createdAt,
      label: event.eventType === 'nayax_match_preselected'
        ? 'History records a System selection (purchase link unavailable).'
        : event.message?.includes('alternate Nayax transaction')
          ? 'History records an alternate purchase selected after review (purchase link unavailable).'
          : 'History records a purchase selected after review (purchase link unavailable).',
    } : null,
  };
};

export const getRefundMachineContextPresentation = (candidate: RefundReviewCandidateEvidence | null | undefined) => {
  const status = candidate?.machineStatus && candidate.machineStatus.state !== 'unknown'
    ? { ...candidate.machineStatus, checkedAt: validDate(candidate.machineStatus.checkedAt) ? candidate.machineStatus.checkedAt : null }
    : null;
  const alerts = candidate?.nearbyMachineAlerts ?? [];
  if (!status && !alerts.length) return null;
  return {
    status,
    alerts,
    statusNote: 'Nayax status was observed at lookup time; status at purchase remains unverified.',
    alertsNote: 'Nayax alerts near the transaction time do not prove this purchase failed.',
  };
};

export type RefundSearchCoverageEvidence = {
  candidateCount?: number | null;
  providerWindowRecordCount?: number | null;
  providerRecordCount?: number | null;
  windowHours?: number | null;
  incidentAt?: string | null;
  lastCheckedAt?: string | null;
  historicalCoverage?: 'unknown' | 'complete';
};
const count = (value: number | null | undefined) => Number.isSafeInteger(value) && value! >= 0 ? value! : null;

export const getRefundSearchCoveragePresentation = (summary: RefundSearchCoverageEvidence | null | undefined) => {
  const candidates = count(summary?.candidateCount);
  const windowRecords = count(summary?.providerWindowRecordCount);
  const records = count(summary?.providerRecordCount);
  return {
    resultCountLabel: candidates === null ? 'Returned candidate count unavailable'
      : `${candidates} candidate${candidates === 1 ? '' : 's'} returned for review`,
    providerRecordCountLabel: windowRecords !== null
      ? `${windowRecords} provider record${windowRecords === 1 ? '' : 's'} in the reported search window`
      : records !== null ? `${records} provider record${records === 1 ? '' : 's'} returned; count in the search window unavailable`
      : 'Provider record count unavailable',
    windowLabel: finite(summary?.windowHours) && summary.windowHours > 0
      ? `Reported search window: ±${summary.windowHours} hours around the purchase time`
      : 'Search window unavailable',
    incidentAt: validDate(summary?.incidentAt) ? summary!.incidentAt! : null,
    freshnessAt: validDate(summary?.lastCheckedAt) ? summary!.lastCheckedAt! : null,
    coverageLabel: summary?.historicalCoverage === 'complete'
      ? 'Nayax reports complete historical coverage for this search.'
      : 'Historical coverage unknown; other plausible purchases may be missing.',
  };
};
