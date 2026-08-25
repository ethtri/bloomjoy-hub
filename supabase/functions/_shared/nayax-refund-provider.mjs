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
const SAFE_IDEMPOTENCY_KEY = /^nayax-refund-[a-f0-9]{64}$/;
const SAFE_CONTRACT_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,79}$/;
const SAFE_CASE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  const result = normalizeResponseValue(record.result);
  const status = normalizeResponseValue(record.status);
  if (result === null || status === null) {
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
      "providerEmailBehavior",
      "writeCredentialMode",
      "sameWriteTokenContractConfirmed",
      "reconciliationMode",
      "requestAdvanceMode",
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
  if (!new Set(["bearer", "raw"]).has(authorizationMode)) {
    throw new Error(
      "Nayax refund provider authorizationMode must be bearer or raw.",
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

  const providerEmailBehavior = text(
    contract.providerEmailBehavior,
    60,
  ).toLowerCase();
  if (!new Set([
    "suppressed_by_written_contract",
    "owner_consented_expected",
    "recipient_omitted",
  ]).has(providerEmailBehavior)) {
    throw new Error(
      "Nayax refund provider providerEmailBehavior must suppress or omit the provider recipient.",
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

  const requestAdvanceMode = text(
    contract.requestAdvanceMode ?? "exact_response",
    40,
  ).toLowerCase();
  if (!new Set(["exact_response", "http_2xx"]).has(requestAdvanceMode)) {
    throw new Error(
      "Nayax refund provider requestAdvanceMode must be exact_response or http_2xx.",
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
    schemaVersion: 1,
    contractVersion,
    baseUrl: parseBaseUrl(contract.baseUrl),
    authorizationMode,
    amountUnit,
    amountRoundingMode,
    refundEmailListMode,
    providerEmailBehavior,
    writeCredentialMode,
    sameWriteTokenContractConfirmed,
    reconciliationMode,
    requestAdvanceMode,
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
}) {
  if (!new Set(["request", "approve"]).has(stage)) {
    throw new Error("Nayax refund stage must be request or approve.");
  }
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : {};
  const result = normalizeResponseValue(record.Result);
  const status = normalizeResponseValue(record.Status);
  const pattern = patterns.find((candidate) =>
    candidate.result === result && candidate.status === status
  );
  let outcome = pattern?.outcome ?? "unknown";
  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    outcome = "unknown";
  }

  return Object.freeze({
    stage,
    outcome,
    httpStatus: Number.isInteger(httpStatus) ? httpStatus : null,
    result,
    status,
    contractMatched: Boolean(pattern) && outcome !== "unknown",
    payloadRedacted: true,
  });
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
  if (!new Set(["request", "approve"]).has(stage)) {
    throw new Error("Nayax refund stage must be request or approve.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Nayax refund transport is unavailable.");
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
        Authorization: contract.authorizationMode === "bearer"
          ? `Bearer ${safeToken}`
          : safeToken,
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
    return Object.freeze({
      stage,
      outcome: "unknown",
      httpStatus: null,
      result: null,
      status: null,
      contractMatched: false,
      failureType: error?.name === "AbortError" ? "timeout" : "network",
      payloadRedacted: true,
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
  if (contract.schemaVersion !== 1) {
    throw new Error("Nayax refund approval contract schemaVersion must be 1.");
  }
  const contractVersion = text(contract.contractVersion, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{5,79}$/.test(contractVersion)) {
    throw new Error("Nayax refund approval contractVersion is invalid.");
  }
  const authorizationMode = text(contract.authorizationMode, 40).toLowerCase();
  if (!new Set(["bearer", "raw"]).has(authorizationMode)) {
    throw new Error("Nayax refund approval authorizationMode is invalid.");
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
    schemaVersion: 1,
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
  const classification = JSON.stringify({
    stage,
    event,
    outcome: text(result.outcome, 40) || null,
    httpStatus: Number.isInteger(result.httpStatus) ? result.httpStatus : null,
    result: normalizeResponseValue(result.result),
    status: normalizeResponseValue(result.status),
    contractMatched: result.contractMatched === true,
    failureType: text(result.failureType, 40) || null,
  });
  return hmacSha256Hex(
    safeSecret,
    `bloomjoy-nayax-stage-v1|${safeAttemptId}|${safeContractVersion}|${classification}`,
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
  const requestToken = parseToken(rawRequestToken);
  const approveToken = parseToken(rawApproveToken);
  if (contract.writeCredentialMode === "separate" && requestToken === approveToken) {
    throw new Error(
      "Nayax refund contract requires separate request and approval write credentials.",
    );
  }
  if (
    contract.writeCredentialMode === "same_token_explicit" &&
    requestToken !== approveToken
  ) {
    throw new Error(
      "Nayax refund same-token contract does not match the supplied credentials.",
    );
  }
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
