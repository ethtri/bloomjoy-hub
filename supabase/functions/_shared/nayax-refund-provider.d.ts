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
  baseUrl: string;
  providerEmailBehavior: "suppressed_by_written_contract" | "owner_consented_expected";
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
