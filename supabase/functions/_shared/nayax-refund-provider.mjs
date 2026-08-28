export const NAYAX_REFUND_PRODUCTION_BASE_URL =
  "https://lynx.nayax.com/operational/v1";

const ALLOWED_NAYAX_REFUND_HOSTS = new Set([
  "lynx.nayax.com",
  "qa-lynx.nayax.com",
]);

const REQUEST_OUTCOMES = new Set([
  "accepted",
  "rejected",
  "duplicate",
  "already_refunded",
]);

const APPROVE_OUTCOMES = new Set([
  "succeeded",
  "rejected",
  "duplicate",
  "already_refunded",
  "pending",
]);

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_LENGTH = 16_384;
const INT32_MAX = 2_147_483_647;
const RESPONSE_MEDIA_TYPE_CLASSES = new Set([
  "application_json",
  "json_suffix",
  "html",
  "text",
  "other",
  "missing",
  "unavailable",
]);
const RESPONSE_BODY_KINDS = new Set([
  "empty",
  "json_object",
  "json_non_object",
  "html",
  "text",
  "malformed_json",
  "oversize",
  "read_error",
  "unavailable",
]);
const RESPONSE_LENGTH_BUCKETS = new Set([
  "empty",
  "1_256",
  "257_2048",
  "2049_16384",
  "over_16384",
  "unavailable",
]);
const RESPONSE_VALUE_TYPES = new Set([
  "string",
  "null",
  "number",
  "boolean",
  "object",
  "array",
  "missing",
  "unavailable",
]);
const SAFE_IDEMPOTENCY_KEY = /^nayax-refund-[a-f0-9]{64}$/;
const SAFE_CONTRACT_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,79}$/;
const SAFE_CASE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const text = (value, maxLength = 200) =>
  value === null || value === undefined
    ? ""
    : String(value).trim().slice(0, maxLength);

const assertPlainObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
};

const assertExactKeys = (value, allowedKeys, label) => {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${label} contains an unsupported field.`);
    }
  }
};

const parseBaseUrl = (value) => {
  let url;
  try {
    url = new URL(text(value, 500));
  } catch {
    throw new Error("Nayax refund contract baseUrl must be a valid URL.");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !ALLOWED_NAYAX_REFUND_HOSTS.has(url.hostname.toLowerCase())
  ) {
    throw new Error("Nayax refund contract baseUrl is not an approved HTTPS host.");
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname !== "/operational/v1") {
    throw new Error("Nayax refund contract baseUrl must end at /operational/v1.");
  }

  return `${url.origin}${pathname}`;
};

const parsePattern = (pattern, stage, index) => {
  const label = `${stage} response pattern ${index + 1}`;
  const record = assertPlainObject(pattern, label);
  assertExactKeys(record, new Set(["result", "status", "outcome"]), label);

  const outcome = text(record.outcome, 40).toLowerCase();
  const allowedOutcomes = stage === "request"
    ? REQUEST_OUTCOMES
    : APPROVE_OUTCOMES;
  if (!allowedOutcomes.has(outcome)) {
    throw new Error(`${label} has an unsupported outcome.`);
  }

  const result = typeof record.result === "string" ? record.result : "";
  const status = typeof record.status === "string" ? record.status : "";
  if (
    !result ||
    !status ||
    result !== result.trim() ||
    status !== status.trim() ||
    result.length > 80 ||
    status.length > 80 ||
    /[\u0000-\u001f\u007f]/.test(result) ||
    /[\u0000-\u001f\u007f]/.test(status)
  ) {
    throw new Error(`${label} must match an exact Result and Status pair.`);
  }

  return Object.freeze({ result, status, outcome });
};

const parsePatterns = (patterns, stage) => {
  if (!Array.isArray(patterns) || patterns.length === 0 || patterns.length > 30) {
    throw new Error(
      `Nayax refund contract ${stage}Responses must contain 1 to 30 patterns.`,
    );
  }

  const parsed = patterns.map((pattern, index) =>
    parsePattern(pattern, stage, index)
  );
  const signatures = new Set();
  for (const pattern of parsed) {
    const signature = `${pattern.result}|${pattern.status}`;
    if (signatures.has(signature)) {
      throw new Error(
        `Nayax refund contract ${stage}Responses contains a duplicate match.`,
      );
    }
    signatures.add(signature);
  }
  return Object.freeze(parsed);
};

export function parseNayaxRefundProviderContract(rawValue) {
  let parsed;
  try {
    parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
  } catch {
    throw new Error("Nayax refund provider contract is not valid JSON.");
  }

  const contract = assertPlainObject(parsed, "Nayax refund provider contract");
  assertExactKeys(
    contract,
    new Set([
      "schemaVersion",
      "contractVersion",
      "baseUrl",
      "authorizationMode",
      "amountUnit",
      "amountRoundingMode",
      "refundEmailListMode",
      "writeCredentialMode",
      "sameWriteTokenContractConfirmed",
      "reconciliationMode",
      "requestResponses",
      "approveResponses",
    ]),
    "Nayax refund provider contract",
  );

  if (contract.schemaVersion !== 2) {
    throw new Error("Nayax refund provider contract schemaVersion must be 2.");
  }

  const contractVersion = text(contract.contractVersion, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{5,79}$/.test(contractVersion)) {
    throw new Error("Nayax refund provider contractVersion is invalid.");
  }

  const amountUnit = text(contract.amountUnit, 40).toLowerCase();
  if (!new Set(["major", "minor"]).has(amountUnit)) {
    throw new Error("Nayax refund provider amountUnit must be major or minor.");
  }

  const amountRoundingMode = text(
    contract.amountRoundingMode,
    40,
  ).toLowerCase();
  if (amountRoundingMode !== "exact_cent") {
    throw new Error(
      "Nayax refund provider amountRoundingMode must be exact_cent.",
    );
  }

  const authorizationMode = text(contract.authorizationMode, 40).toLowerCase();
  if (authorizationMode !== "bearer") {
    throw new Error(
      "Nayax refund provider authorizationMode must be bearer.",
    );
  }

  const refundEmailListMode = text(
    contract.refundEmailListMode,
    40,
  ).toLowerCase();
  if (!new Set(["omit", "empty_string"]).has(refundEmailListMode)) {
    throw new Error(
      "Nayax refund provider refundEmailListMode must be omit or empty_string.",
    );
  }

  const writeCredentialMode = text(
    contract.writeCredentialMode,
    40,
  ).toLowerCase();
  if (!new Set(["separate", "same_token_explicit"]).has(writeCredentialMode)) {
    throw new Error(
      "Nayax refund provider writeCredentialMode is invalid.",
    );
  }
  const sameWriteTokenContractConfirmed =
    contract.sameWriteTokenContractConfirmed === true;
  if (
    (writeCredentialMode === "same_token_explicit") !==
      sameWriteTokenContractConfirmed
  ) {
    throw new Error(
      "Nayax same-token write credentials require an explicit contract confirmation.",
    );
  }

  const reconciliationMode = text(
    contract.reconciliationMode,
    80,
  ).toLowerCase();
  if (reconciliationMode !== "dtm_then_structured_resolution") {
    throw new Error(
      "Nayax refund reconciliationMode must be dtm_then_structured_resolution.",
    );
  }

  const requestResponses = parsePatterns(contract.requestResponses, "request");
  const approveResponses = parsePatterns(contract.approveResponses, "approve");
  if (!requestResponses.some((pattern) => pattern.outcome === "accepted")) {
    throw new Error(
      "Nayax refund provider contract needs an accepted request response.",
    );
  }
  if (!approveResponses.some((pattern) => pattern.outcome === "succeeded")) {
    throw new Error(
      "Nayax refund provider contract needs a succeeded approval response.",
    );
  }
  for (const [stage, patterns] of [
    ["request", requestResponses],
    ["approve", approveResponses],
  ]) {
    if (!patterns.some((pattern) => pattern.outcome === "duplicate")) {
      throw new Error(
        `Nayax refund provider contract needs an exact duplicate ${stage} response.`,
      );
    }
    if (!patterns.some((pattern) => pattern.outcome === "already_refunded")) {
      throw new Error(
        `Nayax refund provider contract needs an exact already-refunded ${stage} response.`,
      );
    }
  }

  return Object.freeze({
    schemaVersion: 2,
    contractVersion,
    baseUrl: parseBaseUrl(contract.baseUrl),
    authorizationMode,
    amountUnit,
    amountRoundingMode,
    refundEmailListMode,
    writeCredentialMode,
    sameWriteTokenContractConfirmed,
    reconciliationMode,
    requestResponses,
    approveResponses,
  });
}

const parseProviderInteger = (value, label, maximum) => {
  const normalized = text(value, 40);
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be a positive integer.`);
  }
  const numeric = Number(normalized);
  if (
    !Number.isSafeInteger(numeric) ||
    numeric <= 0 ||
    (Number.isInteger(maximum) && numeric > maximum)
  ) {
    throw new Error(`${label} is outside the supported safe integer range.`);
  }
  return numeric;
};

const parseMachineAuthorizationTime = (value) => {
  const normalized = text(value, 80);
  if (
    !normalized ||
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ||
    !Number.isFinite(Date.parse(normalized))
  ) {
    throw new Error("Nayax MachineAuTime must be a timezone-qualified date-time.");
  }
  return normalized;
};

const providerAmount = (amountCents, amountUnit) => {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error("Refund amount must be a positive integer number of cents.");
  }
  return amountUnit === "major"
    ? Number((amountCents / 100).toFixed(2))
    : amountCents;
};

const parseToken = (value) => {
  const token = typeof value === "string" ? value.trim() : "";
  if (
    token.length < 8 ||
    token.length > 4_096 ||
    /[\u0000-\u001f\u007f]/.test(token)
  ) {
    throw new Error("Nayax refund token is missing or invalid.");
  }
  return token;
};

const parseWriteCredentials = ({ contract, requestToken, approveToken }) => {
  const parsedRequestToken = parseToken(requestToken);
  const parsedApproveToken = parseToken(approveToken);
  if (
    contract.writeCredentialMode === "separate" &&
    parsedRequestToken === parsedApproveToken
  ) {
    throw new Error(
      "Nayax refund contract requires separate request and approval write credentials.",
    );
  }
  if (
    contract.writeCredentialMode === "same_token_explicit" &&
    parsedRequestToken !== parsedApproveToken
  ) {
    throw new Error(
      "Nayax refund same-token contract does not match the supplied credentials.",
    );
  }
  return Object.freeze({
    requestToken: parsedRequestToken,
    approveToken: parsedApproveToken,
  });
};

export function areNayaxRefundWriteCredentialsReady({
  contract: rawContract,
  requestToken,
  approveToken,
}) {
  try {
    const contract = parseNayaxRefundProviderContract(rawContract);
    parseWriteCredentials({ contract, requestToken, approveToken });
    return true;
  } catch {
    return false;
  }
}

export function freezeNayaxRefundEvidence(value) {
  const record = assertPlainObject(value, "Nayax refund execution evidence");
  assertExactKeys(
    record,
    new Set([
      "caseId",
      "amountCents",
      "currencyCode",
      "transactionId",
      "siteId",
      "machineAuthorizationTime",
    ]),
    "Nayax refund execution evidence",
  );

  const caseId = text(record.caseId, 80);
  if (!SAFE_CASE_ID.test(caseId)) {
    throw new Error("Nayax refund evidence requires an exact case ID.");
  }
  if (text(record.currencyCode, 10).toUpperCase() !== "USD") {
    throw new Error("Nayax refund evidence must use USD.");
  }

  return Object.freeze({
    caseId,
    amountCents: providerAmount(record.amountCents, "minor"),
    currencyCode: "USD",
    transactionId: parseProviderInteger(
      record.transactionId,
      "Nayax TransactionId",
    ),
    siteId: parseProviderInteger(record.siteId, "Nayax SiteId", INT32_MAX),
    machineAuthorizationTime: parseMachineAuthorizationTime(
      record.machineAuthorizationTime,
    ),
  });
}

export function buildNayaxRefundRequestBody({
  contract,
  amountCents,
  transactionId,
  siteId,
  machineAuthorizationTime,
}) {
  const body = {
    RefundAmount: providerAmount(amountCents, contract.amountUnit),
    RefundReason: "Bloomjoy manager-approved customer refund",
    TransactionId: parseProviderInteger(transactionId, "Nayax TransactionId"),
    SiteId: parseProviderInteger(siteId, "Nayax SiteId", INT32_MAX),
    MachineAuTime: parseMachineAuthorizationTime(machineAuthorizationTime),
  };

  if (contract.refundEmailListMode === "empty_string") {
    body.RefundEmailList = "";
  }
  return body;
}

export function buildNayaxRefundApprovalBody({
  transactionId,
  siteId,
  machineAuthorizationTime,
}) {
  return {
    IsRefundedExternally: false,
    TransactionId: parseProviderInteger(transactionId, "Nayax TransactionId"),
    SiteId: parseProviderInteger(siteId, "Nayax SiteId", INT32_MAX),
    MachineAuTime: parseMachineAuthorizationTime(machineAuthorizationTime),
  };
}

export function classifyNayaxRefundResponse({
  stage,
  httpStatus,
  payload,
  patterns,
  mediaTypeClass = "application_json",
  bodyKind = "json_object",
  bodyLengthBucket = "1_256",
  jsonParsed = true,
  payloadUnavailable = false,
  failureType,
}) {
  if (!new Set(["request", "approve"]).has(stage)) {
    throw new Error("Nayax refund stage must be request or approve.");
  }

  const safeHttpStatus = Number.isInteger(httpStatus) &&
      httpStatus >= 100 && httpStatus <= 599
    ? httpStatus
    : null;
  const httpAccepted = safeHttpStatus === 200;
  const safeMediaTypeClass = RESPONSE_MEDIA_TYPE_CLASSES.has(mediaTypeClass)
    ? mediaTypeClass
    : "unavailable";
  const safeBodyKind = RESPONSE_BODY_KINDS.has(bodyKind)
    ? bodyKind
    : "unavailable";
  const safeBodyLengthBucket = RESPONSE_LENGTH_BUCKETS.has(bodyLengthBucket)
    ? bodyLengthBucket
    : "unavailable";
  const safeFailureType = new Set(["timeout", "network", "response_read"])
      .has(failureType)
    ? failureType
    : null;
  const wasJsonParsed = jsonParsed === true;
  const jsonObject = wasJsonParsed && payload !== null &&
    typeof payload === "object" && !Array.isArray(payload);
  const record = jsonObject ? payload : {};
  const resultKeyPresent = jsonObject &&
    Object.prototype.hasOwnProperty.call(record, "Result");
  const statusKeyPresent = jsonObject &&
    Object.prototype.hasOwnProperty.call(record, "Status");
  const valueType = (value, keyPresent) => {
    if (payloadUnavailable === true || !wasJsonParsed) return "unavailable";
    if (!keyPresent) return "missing";
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value === "object" ? "object" : typeof value;
  };
  const candidateResultValueType = valueType(
    record.Result,
    resultKeyPresent,
  );
  const candidateStatusValueType = valueType(
    record.Status,
    statusKeyPresent,
  );
  const resultValueType = RESPONSE_VALUE_TYPES.has(candidateResultValueType)
    ? candidateResultValueType
    : "unavailable";
  const statusValueType = RESPONSE_VALUE_TYPES.has(candidateStatusValueType)
    ? candidateStatusValueType
    : "unavailable";
  const schemaMatched = jsonObject && resultKeyPresent && statusKeyPresent &&
    resultValueType === "string" && statusValueType === "string";
  const pattern = schemaMatched && Array.isArray(patterns)
    ? patterns.find((candidate) =>
      candidate.result === record.Result && candidate.status === record.Status
    )
    : undefined;
  const semanticPairMatched = Boolean(pattern);
  const contractMatched = safeFailureType === null &&
    httpAccepted &&
    safeMediaTypeClass === "application_json" &&
    safeBodyKind === "json_object" &&
    wasJsonParsed &&
    jsonObject &&
    schemaMatched &&
    semanticPairMatched;

  return Object.freeze({
    stage,
    outcome: contractMatched ? pattern.outcome : "unknown",
    httpStatus: safeHttpStatus,
    httpAccepted,
    mediaTypeClass: safeMediaTypeClass,
    bodyKind: safeBodyKind,
    bodyLengthBucket: safeBodyLengthBucket,
    jsonParsed: wasJsonParsed,
    jsonObject,
    resultKeyPresent,
    statusKeyPresent,
    resultValueType,
    statusValueType,
    schemaMatched,
    semanticPairMatched,
    contractMatched,
    ...(safeFailureType ? { failureType: safeFailureType } : {}),
    payloadRedacted: true,
  });
}

const classifyResponseMediaType = (response) => {
  let rawContentType = "";
  try {
    rawContentType = typeof response?.headers?.get === "function"
      ? text(response.headers.get("content-type"), 200).toLowerCase()
      : "";
  } catch {
    rawContentType = "";
  }
  const mediaType = rawContentType.split(";", 1)[0].trim();
  if (!mediaType) return "missing";
  if (mediaType === "application/json") return "application_json";
  if (/^application\/[a-z0-9!#$&^_.+-]+\+json$/u.test(mediaType)) {
    return "json_suffix";
  }
  if (mediaType === "text/html" || mediaType === "application/xhtml+xml") {
    return "html";
  }
  if (mediaType.startsWith("text/")) return "text";
  return "other";
};

const responseLengthBucket = (byteLength) => {
  if (byteLength === 0) return "empty";
  if (byteLength <= 256) return "1_256";
  if (byteLength <= 2_048) return "257_2048";
  if (byteLength <= MAX_RESPONSE_LENGTH) return "2049_16384";
  return "over_16384";
};

const classifyNayaxHttpResponse = async ({
  stage,
  response,
  patterns,
}) => {
  const httpStatus = Number.isInteger(response?.status) ? response.status : null;
  const mediaTypeClass = classifyResponseMediaType(response);
  let responseText;
  try {
    responseText = await response.text();
  } catch {
    return classifyNayaxRefundResponse({
      stage,
      httpStatus,
      payload: undefined,
      patterns,
      mediaTypeClass,
      bodyKind: "read_error",
      bodyLengthBucket: "unavailable",
      jsonParsed: false,
      payloadUnavailable: true,
      failureType: "response_read",
    });
  }

  const byteLength = new TextEncoder().encode(responseText).byteLength;
  const bodyLengthBucket = responseLengthBucket(byteLength);
  if (byteLength === 0) {
    return classifyNayaxRefundResponse({
      stage,
      httpStatus,
      payload: undefined,
      patterns,
      mediaTypeClass,
      bodyKind: "empty",
      bodyLengthBucket,
      jsonParsed: false,
      payloadUnavailable: true,
    });
  }
  if (byteLength > MAX_RESPONSE_LENGTH) {
    return classifyNayaxRefundResponse({
      stage,
      httpStatus,
      payload: undefined,
      patterns,
      mediaTypeClass,
      bodyKind: "oversize",
      bodyLengthBucket,
      jsonParsed: false,
      payloadUnavailable: true,
    });
  }

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    const htmlLike = mediaTypeClass === "html" ||
      /^\s*(?:<!doctype\s+html|<html)(?:\s|>)/iu.test(responseText);
    return classifyNayaxRefundResponse({
      stage,
      httpStatus,
      payload: undefined,
      patterns,
      mediaTypeClass,
      bodyKind: htmlLike
        ? "html"
        : mediaTypeClass === "application_json" ||
            mediaTypeClass === "json_suffix"
        ? "malformed_json"
        : "text",
      bodyLengthBucket,
      jsonParsed: false,
      payloadUnavailable: true,
    });
  }

  return classifyNayaxRefundResponse({
    stage,
    httpStatus,
    payload,
    patterns,
    mediaTypeClass,
    bodyKind: payload !== null && typeof payload === "object" &&
        !Array.isArray(payload)
      ? "json_object"
      : "json_non_object",
    bodyLengthBucket,
    jsonParsed: true,
  });
};

const safeTimeoutMs = (value) => {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 1_000 && numeric <= 20_000
    ? numeric
    : DEFAULT_TIMEOUT_MS;
};

export async function postNayaxRefundStep({
  stage,
  contract,
  token,
  body,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!new Set(["request", "approve"]).has(stage)) {
    throw new Error("Nayax refund stage must be request or approve.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Nayax refund transport is unavailable.");
  }
  if (contract?.schemaVersion !== 2 || contract?.authorizationMode !== "bearer") {
    throw new Error(
      "Nayax refund transport requires a schemaVersion 2 Bearer contract.",
    );
  }
  const safeToken = parseToken(token);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), safeTimeoutMs(timeoutMs));
  const path = stage === "request" ? "refund-request" : "refund-approve";
  const patterns = stage === "request"
    ? contract.requestResponses
    : contract.approveResponses;

  try {
    const response = await fetchImpl(`${contract.baseUrl}/payment/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${safeToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "error",
    });
    return await classifyNayaxHttpResponse({
      stage,
      response,
      patterns,
    });
  } catch (error) {
    return classifyNayaxRefundResponse({
      stage,
      httpStatus: null,
      payload: undefined,
      patterns,
      mediaTypeClass: "unavailable",
      bodyKind: "unavailable",
      bodyLengthBucket: "unavailable",
      jsonParsed: false,
      payloadUnavailable: true,
      failureType: error?.name === "AbortError" ? "timeout" : "network",
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function executeNayaxRefundProvider({
  contract,
  requestToken,
  approveToken,
  amountCents,
  transactionId,
  siteId,
  machineAuthorizationTime,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onStageEvent = async (_stageEvent) => {},
}) {
  const requestBody = buildNayaxRefundRequestBody({
    contract,
    amountCents,
    transactionId,
    siteId,
    machineAuthorizationTime,
  });
  await onStageEvent(Object.freeze({ stage: "request", event: "started" }));
  const request = await postNayaxRefundStep({
    stage: "request",
    contract,
    token: requestToken,
    body: requestBody,
    fetchImpl,
    timeoutMs,
  });
  const requestDecision = await onStageEvent(Object.freeze({
    stage: "request",
    event: "result",
    result: request,
  }));
  // The database journal owns this transition. Provider response parsing in
  // JavaScript supplies evidence only; it can never independently authorize
  // the financially distinct approval call.
  if (requestDecision?.approvalAuthorized !== true) {
    return Object.freeze({ request, approve: null, executed: false });
  }

  const approveBody = buildNayaxRefundApprovalBody({
    transactionId,
    siteId,
    machineAuthorizationTime,
  });
  await onStageEvent(Object.freeze({ stage: "approve", event: "started" }));
  const approve = await postNayaxRefundStep({
    stage: "approve",
    contract,
    token: approveToken,
    body: approveBody,
    fetchImpl,
    timeoutMs,
  });
  await onStageEvent(Object.freeze({
    stage: "approve",
    event: "result",
    result: approve,
  }));

  return Object.freeze({
    request,
    approve,
    executed: approve.outcome === "succeeded",
  });
}

export function parseNayaxRefundApprovalContract(rawValue) {
  let parsed;
  try {
    parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
  } catch {
    throw new Error("Nayax refund approval contract is not valid JSON.");
  }

  const contract = assertPlainObject(parsed, "Nayax refund approval contract");
  assertExactKeys(
    contract,
    new Set([
      "schemaVersion",
      "contractVersion",
      "baseUrl",
      "authorizationMode",
      "reconciliationMode",
      "approveResponses",
    ]),
    "Nayax refund approval contract",
  );
  if (contract.schemaVersion !== 2) {
    throw new Error("Nayax refund approval contract schemaVersion must be 2.");
  }
  const contractVersion = text(contract.contractVersion, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{5,79}$/.test(contractVersion)) {
    throw new Error("Nayax refund approval contractVersion is invalid.");
  }
  const authorizationMode = text(contract.authorizationMode, 40).toLowerCase();
  if (authorizationMode !== "bearer") {
    throw new Error(
      "Nayax refund approval authorizationMode must be bearer.",
    );
  }
  if (
    text(contract.reconciliationMode, 80).toLowerCase() !==
      "dtm_then_structured_resolution"
  ) {
    throw new Error(
      "Nayax refund approval reconciliationMode must be dtm_then_structured_resolution.",
    );
  }
  const approveResponses = parsePatterns(contract.approveResponses, "approve");
  for (const requiredOutcome of ["succeeded", "duplicate", "already_refunded"]) {
    if (!approveResponses.some((pattern) => pattern.outcome === requiredOutcome)) {
      throw new Error(
        `Nayax refund approval contract needs an exact ${requiredOutcome} response.`,
      );
    }
  }
  return Object.freeze({
    schemaVersion: 2,
    contractVersion,
    baseUrl: parseBaseUrl(contract.baseUrl),
    authorizationMode,
    reconciliationMode: "dtm_then_structured_resolution",
    approveResponses,
  });
}

export async function executeNayaxRefundApprovalOnly({
  contract,
  approveToken,
  transactionId,
  siteId,
  machineAuthorizationTime,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onStageEvent = async (_stageEvent) => {},
}) {
  const approveBody = buildNayaxRefundApprovalBody({
    transactionId,
    siteId,
    machineAuthorizationTime,
  });
  await onStageEvent(Object.freeze({ stage: "approve", event: "started" }));
  const approve = await postNayaxRefundStep({
    stage: "approve",
    contract,
    token: approveToken,
    body: approveBody,
    fetchImpl,
    timeoutMs,
  });
  await onStageEvent(Object.freeze({
    stage: "approve",
    event: "result",
    result: approve,
  }));

  return Object.freeze({
    request: null,
    approve,
    executed: approve.outcome === "succeeded",
  });
}

const providerStatus = (stageResult) => {
  const stage = new Set(["request", "approve"]).has(stageResult.stage)
    ? stageResult.stage
    : "provider";
  const outcome = new Set([
    "accepted", "succeeded", "rejected", "duplicate",
    "already_refunded", "pending", "unknown",
  ]).has(stageResult.outcome)
    ? stageResult.outcome
    : "unknown";
  return `${stage}_${outcome}_${
    stageResult.contractMatched === true ? "contract_match" : "contract_mismatch"
  }`;
};

const sha256Hex = async (value) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const hmacSha256Hex = async (secret, value) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const buildRedactedNayaxStageDigest = async ({
  journalSecret,
  attemptId,
  contractVersion,
  stageEvent,
}) => {
  const safeSecret = text(journalSecret, 4_096);
  const safeAttemptId = text(attemptId, 80);
  const safeContractVersion = text(contractVersion, 80);
  const stage = new Set(["request", "approve"]).has(stageEvent?.stage)
    ? stageEvent.stage
    : null;
  const event = new Set(["started", "result"]).has(stageEvent?.event)
    ? stageEvent.event
    : null;
  if (
    safeSecret.length < 32 ||
    !SAFE_CASE_ID.test(safeAttemptId) ||
    !SAFE_CONTRACT_VERSION.test(safeContractVersion) ||
    !stage ||
    !event
  ) {
    throw new Error("Exact redacted Nayax stage evidence is required.");
  }

  const result = event === "result" && stageEvent.result
    ? stageEvent.result
    : {};
  const safeEnum = (value, allowed) => allowed.has(value) ? value : null;
  const classification = JSON.stringify({
    stage,
    event,
    outcome: text(result.outcome, 40) || null,
    httpStatus: Number.isInteger(result.httpStatus) &&
        result.httpStatus >= 100 && result.httpStatus <= 599
      ? result.httpStatus
      : null,
    httpAccepted: typeof result.httpAccepted === "boolean"
      ? result.httpAccepted
      : null,
    mediaTypeClass: safeEnum(
      result.mediaTypeClass,
      RESPONSE_MEDIA_TYPE_CLASSES,
    ),
    bodyKind: safeEnum(result.bodyKind, RESPONSE_BODY_KINDS),
    bodyLengthBucket: safeEnum(
      result.bodyLengthBucket,
      RESPONSE_LENGTH_BUCKETS,
    ),
    jsonParsed: typeof result.jsonParsed === "boolean"
      ? result.jsonParsed
      : null,
    jsonObject: typeof result.jsonObject === "boolean"
      ? result.jsonObject
      : null,
    resultKeyPresent: typeof result.resultKeyPresent === "boolean"
      ? result.resultKeyPresent
      : null,
    statusKeyPresent: typeof result.statusKeyPresent === "boolean"
      ? result.statusKeyPresent
      : null,
    resultValueType: safeEnum(
      result.resultValueType,
      RESPONSE_VALUE_TYPES,
    ),
    statusValueType: safeEnum(
      result.statusValueType,
      RESPONSE_VALUE_TYPES,
    ),
    schemaMatched: typeof result.schemaMatched === "boolean"
      ? result.schemaMatched
      : null,
    semanticPairMatched: typeof result.semanticPairMatched === "boolean"
      ? result.semanticPairMatched
      : null,
    contractMatched: typeof result.contractMatched === "boolean"
      ? result.contractMatched
      : null,
    failureType: safeEnum(
      result.failureType,
      new Set(["timeout", "network", "response_read"]),
    ),
    payloadRedacted: result.payloadRedacted === true,
  });
  return hmacSha256Hex(
    safeSecret,
    `bloomjoy-nayax-stage-v2|${safeAttemptId}|${safeContractVersion}|${classification}`,
  );
};

export const buildRedactedNayaxEvidenceReference = async ({
  contractVersion,
  idempotencyKey,
}) => {
  if (!SAFE_IDEMPOTENCY_KEY.test(text(idempotencyKey, 100))) {
    throw new Error("Exact Nayax idempotency evidence is required.");
  }
  const digest = await sha256Hex(
    `bloomjoy-nayax-provider-correlation-v1|${contractVersion}|${idempotencyKey}`,
  );
  return `nayax-evidence-${digest}`;
};

export const mapNayaxRefundExecutionOutcome = async (
  result,
  contractVersion,
  idempotencyKey,
) => {
  const finalStage = result.approve ?? result.request;
  if (result.executed) {
    return {
      kind: "success",
      providerReference: await buildRedactedNayaxEvidenceReference({
        contractVersion,
        idempotencyKey,
      }),
      providerStatus: providerStatus(finalStage),
      errorCode: null,
    };
  }
  if (finalStage.failureType === "timeout") {
    return {
      kind: "timeout",
      providerStatus: null,
      errorCode: `provider_${finalStage.stage}_timeout`,
    };
  }
  if (finalStage.outcome === "rejected") {
    return {
      kind: "rejected",
      providerStatus: providerStatus(finalStage),
      errorCode: `provider_${finalStage.stage}_rejected`,
    };
  }
  const errorCode = finalStage.outcome === "duplicate"
    ? "provider_duplicate"
    : finalStage.outcome === "already_refunded"
    ? "provider_already_refunded"
    : finalStage.outcome === "pending"
    ? "provider_approval_pending"
    : finalStage.failureType === "network"
    ? `provider_${finalStage.stage}_network_unknown`
    : finalStage.failureType === "response_read"
    ? `provider_${finalStage.stage}_response_read_unknown`
    : finalStage.httpStatus !== null && finalStage.httpAccepted === false
    ? `provider_${finalStage.stage}_http_error_unknown`
    : finalStage.mediaTypeClass !== "application_json"
    ? `provider_${finalStage.stage}_media_type_invalid`
    : finalStage.jsonParsed !== true || finalStage.jsonObject !== true
    ? `provider_${finalStage.stage}_response_invalid`
    : finalStage.schemaMatched !== true
    ? `provider_${finalStage.stage}_schema_mismatch`
    : finalStage.semanticPairMatched !== true
    ? `provider_${finalStage.stage}_semantic_mismatch`
    : finalStage.contractMatched === false
    ? `provider_${finalStage.stage}_contract_mismatch`
    : `provider_${finalStage.stage}_outcome_unknown`;
  return {
    kind: "unknown",
    providerStatus: providerStatus(finalStage),
    errorCode,
  };
};

export function createNayaxRefundProviderAdapter({
  contract: rawContract,
  requestToken: rawRequestToken,
  approveToken: rawApproveToken,
  evidence: rawEvidence,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onStageEvent = async (_stageEvent) => {},
}) {
  const contract = parseNayaxRefundProviderContract(rawContract);
  const { requestToken, approveToken } = parseWriteCredentials({
    contract,
    requestToken: rawRequestToken,
    approveToken: rawApproveToken,
  });
  const evidence = freezeNayaxRefundEvidence(rawEvidence);
  const boundedTimeoutMs = safeTimeoutMs(timeoutMs);

  return Object.freeze({
    mode: "live",
    contractVersion: contract.contractVersion,
    execute: async (request) => {
      const input = assertPlainObject(request, "Nayax orchestration request");
      if (
        input.caseId !== evidence.caseId ||
        input.amountCents !== evidence.amountCents ||
        input.currencyCode !== evidence.currencyCode ||
        !SAFE_IDEMPOTENCY_KEY.test(text(input.idempotencyKey, 100))
      ) {
        throw new Error(
          "Nayax provider execution does not match the frozen orchestration evidence.",
        );
      }

      const result = await executeNayaxRefundProvider({
        contract,
        requestToken,
        approveToken,
        amountCents: evidence.amountCents,
        transactionId: evidence.transactionId,
        siteId: evidence.siteId,
        machineAuthorizationTime: evidence.machineAuthorizationTime,
        fetchImpl,
        timeoutMs: boundedTimeoutMs,
        onStageEvent,
      });
      return Object.freeze(await mapNayaxRefundExecutionOutcome(
        result,
        contract.contractVersion,
        input.idempotencyKey,
      ));
    },
  });
}
