export type NayaxResponseMediaTypeClass =
  | "application_json"
  | "json_suffix"
  | "html"
  | "text"
  | "other"
  | "missing"
  | "unavailable";

export type NayaxResponseBodyKind =
  | "empty"
  | "json_object"
  | "json_non_object"
  | "html"
  | "text"
  | "malformed_json"
  | "oversize"
  | "read_error"
  | "unavailable";

export type NayaxResponseLengthBucket =
  | "empty"
  | "1_256"
  | "257_2048"
  | "2049_16384"
  | "over_16384"
  | "unavailable";

export type NayaxResponseValueType =
  | "string"
  | "null"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "missing"
  | "unavailable";

export type NayaxControlledPilotStageResult = Readonly<{
  stage: "request" | "approve";
  outcome: string;
  httpStatus: number | null;
  httpAccepted: boolean;
  mediaTypeClass: NayaxResponseMediaTypeClass;
  bodyKind: NayaxResponseBodyKind;
  bodyLengthBucket: NayaxResponseLengthBucket;
  jsonParsed: boolean;
  jsonObject: boolean;
  resultKeyPresent: boolean;
  statusKeyPresent: boolean;
  resultValueType: NayaxResponseValueType;
  statusValueType: NayaxResponseValueType;
  schemaMatched: boolean;
  semanticPairMatched: boolean;
  contractMatched: boolean;
  failureType?: "timeout" | "network" | "response_read";
  payloadRedacted: true;
}>;

export type NayaxControlledPilotStageEvent =
  | { stage: "request" | "approve"; event: "started" }
  | {
    stage: "request" | "approve";
    event: "result";
    result: NayaxControlledPilotStageResult;
  };

export type NayaxProviderStageDecision = Readonly<{
  approvalAuthorized: boolean;
  approvalPolicyVersion?: string;
  responseEnvelopeVersion?: string;
  journalContractVersion?: string;
  providerContractVersion?: string;
  payloadRedacted?: true;
}>;

export type NayaxRefundResponsePattern = Readonly<{
  result: string;
  status: string;
  outcome: string;
}>;

export type NayaxRefundProviderContract = Readonly<{
  schemaVersion: 2;
  contractVersion: string;
  baseUrl: string;
  authorizationMode: "bearer";
  amountUnit: "major" | "minor";
  amountRoundingMode: "exact_cent";
  refundEmailListMode: "omit" | "empty_string";
  writeCredentialMode: "separate" | "same_token_explicit";
  sameWriteTokenContractConfirmed: boolean;
  reconciliationMode: "dtm_then_structured_resolution";
  responseLearningMode?: "inspect_unknown";
  requestResponses: ReadonlyArray<NayaxRefundResponsePattern>;
  approveResponses: ReadonlyArray<NayaxRefundResponsePattern>;
}>;

export type NayaxRefundApprovalContract = Readonly<{
  schemaVersion: 2;
  contractVersion: string;
  baseUrl: string;
  authorizationMode: "bearer";
  reconciliationMode: "dtm_then_structured_resolution";
  approveResponses: ReadonlyArray<NayaxRefundResponsePattern>;
}>;

export const NAYAX_REFUND_PRODUCTION_BASE_URL: "https://lynx.nayax.com/operational/v1";

export function parseNayaxRefundProviderContract(
  rawValue: unknown,
): NayaxRefundProviderContract;

export function parseNayaxRefundApprovalContract(
  rawValue: unknown,
): NayaxRefundApprovalContract;

export function areNayaxRefundWriteCredentialsReady(input: {
  contract: unknown;
  requestToken: string;
  approveToken: string;
}): boolean;

export function executeNayaxRefundApprovalOnly(input: {
  contract: NayaxRefundApprovalContract;
  approveToken: string;
  transactionId: string | number;
  siteId: number;
  machineAuthorizationTime: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  onStageEvent?: (event: NayaxControlledPilotStageEvent) => Promise<void>;
}): Promise<{
  request: null;
  approve: NayaxControlledPilotStageResult;
  executed: boolean;
}>;

export function buildRedactedNayaxStageDigest(input: {
  journalSecret: string;
  attemptId: string;
  contractVersion: string;
  stageEvent: NayaxControlledPilotStageEvent;
}): Promise<string>;

export function mapNayaxRefundExecutionOutcome(
  result: {
    request: NayaxControlledPilotStageResult | null;
    approve: NayaxControlledPilotStageResult | null;
    executed: boolean;
  },
  contractVersion: string,
  idempotencyKey: string,
): Promise<{
  kind: "success" | "rejected" | "timeout" | "unknown";
  providerReference?: string | null;
  providerStatus?: string | null;
  errorCode?: string | null;
}>;

export function createNayaxRefundProviderAdapter(input: {
  contract: unknown;
  requestToken: string;
  approveToken: string;
  evidence: {
    caseId: string;
    amountCents: number;
    currencyCode: "USD";
    transactionId: string | null;
    siteId: number | null;
    machineAuthorizationTime: string | null;
  };
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  onStageEvent?: (
    event: NayaxControlledPilotStageEvent,
  ) => Promise<NayaxProviderStageDecision | void>;
}): Readonly<{
  mode: "live";
  contractVersion: string;
  execute(request: {
    caseId: string;
    idempotencyKey: string;
    amountCents: number;
    currencyCode: "USD";
  }): Promise<{
    kind: "success" | "rejected" | "timeout" | "unknown";
    providerReference?: string | null;
    providerStatus?: string | null;
    errorCode?: string | null;
  }>;
}>;
