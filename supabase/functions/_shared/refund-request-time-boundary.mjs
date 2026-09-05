const exactInstant = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};
const requestSources = new Set([
  "hosted_refund_intake",
  "gmail_contact_ingested",
]);

const comparableOccurrenceSources = new Set([
  "authorization_gmt",
  "machine_authorization_offset",
  "verified_machine_clock",
]);

export const REFUND_INCIDENT_FUTURE_TOLERANCE_MS = 60_000;

export const incidentTimeIsMateriallyFuture = ({
  incidentAt,
  customerRequestReceivedAt,
  toleranceMs = REFUND_INCIDENT_FUTURE_TOLERANCE_MS,
}) => {
  const incident = exactInstant(incidentAt);
  const received = exactInstant(customerRequestReceivedAt);
  if (!incident || !received) return false;
  return incident.getTime() > received.getTime() + Math.max(0, Number(toleranceMs) || 0);
};

export const classifyRefundRequestTimeBoundary = ({
  customerRequestReceivedAt,
  customerRequestReceivedSource,
  transactionOccurredAt,
  transactionOccurrenceSource,
  transactionTimeResolution,
}) => {
  const requestReceived = exactInstant(customerRequestReceivedAt);
  const requestSource = typeof customerRequestReceivedSource === "string"
    ? customerRequestReceivedSource.trim()
    : "";
  const transactionOccurred = exactInstant(transactionOccurredAt);
  const occurrenceSource = typeof transactionOccurrenceSource === "string"
    ? transactionOccurrenceSource.trim()
    : "";
  const requestKnown = Boolean(requestReceived && requestSources.has(requestSource));
  const occurrenceComparable = Boolean(
    transactionOccurred &&
      transactionTimeResolution === "exact" &&
      comparableOccurrenceSources.has(occurrenceSource)
  );

  if (!requestKnown) {
    return {
      state: "request_time_unknown",
      requestKnown: false,
      occurrenceComparable,
      transactionAfterRequest: false,
    };
  }
  if (!occurrenceComparable) {
    return {
      state: "occurrence_time_uncertain",
      requestKnown: true,
      occurrenceComparable: false,
      transactionAfterRequest: false,
    };
  }
  const transactionAfterRequest = transactionOccurred.getTime() > requestReceived.getTime();
  return {
    state: transactionAfterRequest ? "after_request" : "before_or_at_request",
    requestKnown: true,
    occurrenceComparable: true,
    transactionAfterRequest,
  };
};

