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

const text = (value, maxLength = 200) =>
  value === null || value === undefined
    ? ""
    : String(value).trim().slice(0, maxLength);

const normalizeResponseValue = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = text(value, 80).toLowerCase();
  return normalized || null;
};

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
  const allowedOutcomes = stage === "request" ? REQUEST_OUTCOMES : APPROVE_OUTCOMES;
  if (!allowedOutcomes.has(outcome)) {
    throw new Error(`${label} has an unsupported outcome.`);
  }

  const result = normalizeResponseValue(record.result);
  const status = normalizeResponseValue(record.status);
  if (result === null || status === null) {
    throw new Error(`${label} must match an exact Result and Status pair.`);
  }

  return { result, status, outcome };
};

const parsePatterns = (patterns, stage) => {
  if (!Array.isArray(patterns) || patterns.length === 0 || patterns.length > 30) {
    throw new Error(`Nayax refund contract ${stage}Responses must contain 1 to 30 patterns.`);
  }

  const parsed = patterns.map((pattern, index) => parsePattern(pattern, stage, index));
  const signatures = new Set();
  for (const pattern of parsed) {
    const signature = `${pattern.result ?? "<null>"}|${pattern.status ?? "<null>"}`;
    if (signatures.has(signature)) {
      throw new Error(`Nayax refund contract ${stage}Responses contains a duplicate match.`);
    }
    signatures.add(signature);
  }
  return parsed;
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
      "amountUnit",
      "refundEmailListMode",
      "requestResponses",
      "approveResponses",
    ]),
    "Nayax refund provider contract",
  );

  if (contract.schemaVersion !== 1) {
    throw new Error("Nayax refund provider contract schemaVersion must be 1.");
  }

  const contractVersion = text(contract.contractVersion, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{5,79}$/.test(contractVersion)) {
    throw new Error("Nayax refund provider contractVersion is invalid.");
  }

  const amountUnit = text(contract.amountUnit, 40).toLowerCase();
  if (!["major", "minor"].includes(amountUnit)) {
    throw new Error("Nayax refund provider amountUnit must be major or minor.");
  }

  const refundEmailListMode = text(contract.refundEmailListMode, 40).toLowerCase();
  if (!["omit", "empty_string"].includes(refundEmailListMode)) {
    throw new Error(
      "Nayax refund provider refundEmailListMode must be omit or empty_string.",
    );
  }

  const requestResponses = parsePatterns(contract.requestResponses, "request");
  const approveResponses = parsePatterns(contract.approveResponses, "approve");
  if (!requestResponses.some((pattern) => pattern.outcome === "accepted")) {
    throw new Error("Nayax refund provider contract needs an accepted request response.");
  }
  if (!approveResponses.some((pattern) => pattern.outcome === "succeeded")) {
    throw new Error("Nayax refund provider contract needs a succeeded approval response.");
  }

  return Object.freeze({
    schemaVersion: 1,
    contractVersion,
    baseUrl: parseBaseUrl(contract.baseUrl),
    amountUnit,
    refundEmailListMode,
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
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("Refund amount must be a positive integer number of cents.");
  }
  return amountUnit === "major"
    ? Number((amountCents / 100).toFixed(2))
    : amountCents;
};

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

const patternMatches = (pattern, result, status) =>
  (pattern.result === null || pattern.result === result) &&
  (pattern.status === null || pattern.status === status);

export function classifyNayaxRefundResponse({
  stage,
  httpStatus,
  payload,
  patterns,
}) {
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const result = normalizeResponseValue(record.Result);
  const status = normalizeResponseValue(record.Status);
  const pattern = patterns.find((candidate) => patternMatches(candidate, result, status));
  let outcome = pattern?.outcome ?? "unknown";
  if (httpStatus < 200 || httpStatus >= 300) {
    outcome = "unknown";
  }

  return {
    stage,
    outcome,
    httpStatus,
    result,
    status,
    payloadRedacted: true,
  };
}

const parseResponsePayload = async (response) => {
  const responseText = await response.text();
  if (responseText.length > MAX_RESPONSE_LENGTH) return null;
  try {
    return JSON.parse(responseText);
  } catch {
    return null;
  }
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
  if (!text(token, 5_000)) {
    throw new Error("Nayax refund token is missing.");
  }

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
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "error",
    });
    const payload = await parseResponsePayload(response);
    return classifyNayaxRefundResponse({
      stage,
      httpStatus: response.status,
      payload,
      patterns,
    });
  } catch (error) {
    return {
      stage,
      outcome: "unknown",
      httpStatus: null,
      result: null,
      status: null,
      failureType: error?.name === "AbortError" ? "timeout" : "network",
      payloadRedacted: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function executeNayaxRefundProvider({
  contract,
  token,
  amountCents,
  transactionId,
  siteId,
  machineAuthorizationTime,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onStage = async (_stageResult) => {},
}) {
  const requestBody = buildNayaxRefundRequestBody({
    contract,
    amountCents,
    transactionId,
    siteId,
    machineAuthorizationTime,
  });
  const request = await postNayaxRefundStep({
    stage: "request",
    contract,
    token,
    body: requestBody,
    fetchImpl,
    timeoutMs,
  });
  await onStage(request);
  if (request.outcome !== "accepted") {
    return { request, approve: null, executed: false };
  }

  const approveBody = buildNayaxRefundApprovalBody({
    transactionId,
    siteId,
    machineAuthorizationTime,
  });
  const approve = await postNayaxRefundStep({
    stage: "approve",
    contract,
    token,
    body: approveBody,
    fetchImpl,
    timeoutMs,
  });
  await onStage(approve);

  return {
    request,
    approve,
    executed: approve.outcome === "succeeded",
  };
}
