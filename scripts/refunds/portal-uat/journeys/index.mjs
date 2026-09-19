import { ambiguousSelectionJourney } from './ambiguous-selection.mjs';
import { authorizationJourney } from './authorization.mjs';
import { duplicateIdempotencyJourney } from './duplicate-idempotency.mjs';
import { ordinarySuccessJourney } from './ordinary-success.mjs';
import { unknownProviderOutcomeJourney } from './unknown-provider-outcome.mjs';

export const refundPortalJourneys = [
  ordinarySuccessJourney,
  ambiguousSelectionJourney,
  duplicateIdempotencyJourney,
  authorizationJourney,
  unknownProviderOutcomeJourney,
];

export const refundPortalJourneyNames = refundPortalJourneys.map(({ name }) => name);

export const runRefundPortalJourneys = async ({
  checks,
  journeyNames = refundPortalJourneyNames,
}) => {
  const selectedJourneys = refundPortalJourneys.filter(({ name }) => journeyNames.includes(name));
  if (selectedJourneys.length !== journeyNames.length) {
    const unknown = journeyNames.filter(
      (name) => !refundPortalJourneyNames.includes(name),
    );
    throw new Error(`Unknown Refund portal journey: ${unknown.join(', ')}`);
  }

  for (const journey of selectedJourneys) {
    for (const checkName of journey.checks) {
      const check = checks[checkName];
      if (typeof check !== 'function') {
        throw new Error(`Refund portal journey ${journey.name} is missing check ${checkName}.`);
      }
      await check();
    }
  }
};
