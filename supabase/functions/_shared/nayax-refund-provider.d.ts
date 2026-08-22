export type NayaxControlledPilotStageResult = {
  stage: "request" | "approve";
  outcome: string;
  httpStatus: number | null;
  result: string | null;
  status: string | null;
  contractMatched: boolean;
  failureType?: "timeout" | "network";
  payloadRedacted: true;
};

export type NayaxControlledPilotStageEvent =
  | { stage: "request" | "approve"; event: "started" }
  | {
    stage: "request" | "approve";
    event: "result";
    result: NayaxControlledPilotStageResult;
  };

export function parseNayaxRefundProviderContract(rawValue: unknown): Readonly<{
  contractVersion: string;
  baseUrl: string;
  requestAdvanceMode: "exact_response" | "http_2xx";
  providerEmailBehavior:
    | "suppressed_by_written_contract"
    | "owner_consented_expected"
    | "recipient_omitted";
}>;

export function parseNayaxRefundApprovalContract(rawValue: unknown): Readonly<{
  contractVersion: string;
  baseUrl: string;
  authorizationMode: "bearer" | "raw";
  approveResponses: ReadonlyArray<unknown>;
}>;

export function executeNayaxRefundApprovalOnly(input: {
  contract: ReturnType<typeof parseNayaxRefundApprovalContract>;
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
  onStageEvent?: (event: NayaxControlledPilotStageEvent) => Promise<void>;
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
