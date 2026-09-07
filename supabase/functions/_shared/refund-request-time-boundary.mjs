const exactInstant = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};
const requestSources = new Set([
  "hosted_refund_intake",
  "gmail_contact_ingested",
]);

const ONLINE_PURCHASE_OCCURRENCE_SEMANTICS = "online_purchase_occurrence";

const boundedInstant = (value) => {
  const parsed = exactInstant(value);
  return parsed ? parsed.getTime() : null;
};

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
  transactionOccurrenceSemantics,
  transactionOccurrenceTimestampSource,
  transactionOccurrenceTimezoneBasis,
  transactionOccurrenceLowerBoundAt,
  transactionOccurrenceUpperBoundAt,
  requestReceiptLowerBoundAt,
  requestReceiptUpperBoundAt,
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
  const occurrenceLowerBound = boundedInstant(transactionOccurrenceLowerBoundAt);
  const occurrenceUpperBound = boundedInstant(transactionOccurrenceUpperBoundAt);
  const requestLowerBound = boundedInstant(requestReceiptLowerBoundAt);
  const requestUpperBound = boundedInstant(requestReceiptUpperBoundAt);
  const intervalsValid = Boolean(
    transactionOccurred &&
      transactionTimeResolution === "exact" &&
      occurrenceSource &&
      transactionOccurrenceTimestampSource === occurrenceSource &&
      ["utc", "embedded_offset", "verified_machine_timezone"].includes(transactionOccurrenceTimezoneBasis) &&
      transactionOccurrenceSemantics === ONLINE_PURCHASE_OCCURRENCE_SEMANTICS &&
      occurrenceLowerBound !== null &&
      occurrenceUpperBound !== null &&
      requestLowerBound !== null &&
      requestUpperBound !== null &&
      occurrenceLowerBound <= transactionOccurred.getTime() &&
      transactionOccurred.getTime() <= occurrenceUpperBound &&
      requestLowerBound <= requestReceived?.getTime() &&
      requestReceived?.getTime() <= requestUpperBound &&
      occurrenceLowerBound <= occurrenceUpperBound &&
      requestLowerBound <= requestUpperBound
  );

  if (!requestKnown) {
    return {
      state: "request_time_unknown",
      requestKnown: false,
      occurrenceComparable: false,
      transactionAfterRequest: false,
    };
  }
  if (!intervalsValid) {
    return {
      state: "occurrence_time_uncertain",
      requestKnown: true,
      occurrenceComparable: false,
      transactionAfterRequest: false,
    };
  }
  const transactionAfterRequest = occurrenceLowerBound > requestUpperBound;
  const transactionBeforeOrAtRequest = occurrenceUpperBound <= requestLowerBound;
  if (!transactionAfterRequest && !transactionBeforeOrAtRequest) {
    return {
      state: "occurrence_time_uncertain",
      requestKnown: true,
      occurrenceComparable: true,
      transactionAfterRequest: false,
    };
  }
  return {
    state: transactionAfterRequest ? "after_request" : "before_or_at_request",
    requestKnown: true,
    occurrenceComparable: true,
    transactionAfterRequest,
  };
};
