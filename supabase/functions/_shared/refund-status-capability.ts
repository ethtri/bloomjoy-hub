export const REFUND_STATUS_TOKEN_BYTES = 32;
export const REFUND_STATUS_DEFAULT_TTL_DAYS = 30;
export const REFUND_STATUS_MAX_TTL_DAYS = 45;

export type RefundStatusCapability = {
  capabilityId: string;
  token: string;
  url: string;
  expiresAt: string;
};

export type CustomerRefundLifecycle = {
  schemaVersion: "refund_lifecycle_v2";
  version: number;
  stage:
    | "matching"
    | "waiting_on_customer"
    | "needs_transaction_selection"
    | "transaction_confirmed"
    | "awaiting_payout"
    | "refund_initiated"
    | "confirming_with_nayax"
    | "refund_confirmed"
    | "customer_notified"
    | "needs_refund_operations"
    | "integrity_hold"
    | "denied"
    | "unable_to_complete";
  stageRank: number;
  reasonCode: string;
  customerAction: {
    action: string;
    required: boolean;
    requestedFields: string[];
    payloadRedacted: true;
  };
  paymentState: string;
  messageState: {
    state: string;
    payloadRedacted: true;
  };
  lastUpdatedAt: string;
  publicCopyKey: string;
  terminal: boolean;
  refreshAfterSeconds: number | null;
  payloadRedacted: true;
};

type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

const encoder = new TextEncoder();
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const lifecycleStages = new Set<CustomerRefundLifecycle["stage"]>([
  "matching",
  "waiting_on_customer",
  "needs_transaction_selection",
  "transaction_confirmed",
  "awaiting_payout",
  "refund_initiated",
  "confirming_with_nayax",
  "refund_confirmed",
  "customer_notified",
  "needs_refund_operations",
  "integrity_hold",
  "denied",
  "unable_to_complete",
]);
const lifecycleRequestedFields = new Set([
  "location_or_machine",
  "incident_date",
  "incident_time",
  "payment_method",
  "payment_interaction",
  "wallet_provider",
  "amount",
  "card_last4",
  "card_network",
  "zelle_payment_contact",
]);
const boundedContractValue = (value: unknown, maximum = 80): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= maximum &&
  /^[a-z0-9_:-]+$/u.test(value);
const exactObjectKeys = (value: Record<string, unknown>, expected: string[]) => {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
};

const base64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

export const isRefundStatusToken = (value: unknown): value is string =>
  typeof value === "string" && tokenPattern.test(value);

export const hashRefundStatusValue = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const createRefundStatusToken = () => {
  const bytes = new Uint8Array(REFUND_STATUS_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
};

export const refundStatusLinksEnabled = () =>
  Deno.env.get("REFUND_STATUS_LINKS_ENABLED")?.trim().toLowerCase() === "true";

const resolveStatusTtlDays = () => {
  const configured = Number(Deno.env.get("REFUND_STATUS_LINK_TTL_DAYS") ?? "");
  if (!Number.isSafeInteger(configured)) return REFUND_STATUS_DEFAULT_TTL_DAYS;
  return Math.min(REFUND_STATUS_MAX_TTL_DAYS, Math.max(7, configured));
};

const resolveStatusOrigin = () => {
  const configured = Deno.env.get("REFUND_STATUS_PUBLIC_ORIGIN")?.trim() ||
    "https://app.bloomjoyusa.com";
  const parsed = new URL(configured);
  const productionHost = parsed.protocol === "https:" && [
    "app.bloomjoyusa.com",
    "www.bloomjoyusa.com",
  ].includes(parsed.hostname);
  const localHost = Deno.env.get("REFUND_STATUS_ALLOW_LOCAL_ORIGIN") === "true" &&
    parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if ((!productionHost && !localHost) || parsed.username || parsed.password) {
    throw new Error("Refund status public origin is not approved.");
  }
  return parsed.origin;
};

export const issueRefundStatusCapability = async ({
  supabase,
  refundCaseId,
}: {
  supabase: RpcClient;
  refundCaseId: string;
}): Promise<RefundStatusCapability | null> => {
  if (!refundStatusLinksEnabled()) return null;
  if (!/^[0-9a-f-]{36}$/i.test(refundCaseId)) {
    throw new Error("Refund status capability requires a valid case.");
  }

  const token = createRefundStatusToken();
  const tokenDigest = await hashRefundStatusValue(token);
  const expiresAt = new Date(
    Date.now() + resolveStatusTtlDays() * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await supabase.rpc(
    "service_issue_refund_status_capability",
    {
      p_refund_case_id: refundCaseId,
      p_token_digest: tokenDigest,
      p_expires_at: expiresAt,
    },
  );
  const result = data as Record<string, unknown> | null;
  if (
    error || result?.issued !== true || result?.payloadRedacted !== true ||
    typeof result?.capabilityId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(result.capabilityId) ||
    typeof result?.expiresAt !== "string"
  ) {
    throw new Error("Refund status link could not be issued.");
  }

  const url = new URL("/refunds/status", resolveStatusOrigin());
  // A fragment never reaches CDN/server request logs or referrer headers.
  url.hash = `token=${token}`;
  return {
    capabilityId: result.capabilityId,
    token,
    url: url.toString(),
    expiresAt: result.expiresAt,
  };
};

export const tryIssueRefundStatusCapability = async (
  input: Parameters<typeof issueRefundStatusCapability>[0],
) => {
  try {
    return await issueRefundStatusCapability(input);
  } catch (error) {
    console.error("refund status capability issuance unavailable", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
};

export const tryIssueRefundStatusCapabilityForMessage = async ({
  supabase,
  refundCaseId,
  refundCaseMessageId,
}: {
  supabase: RpcClient;
  refundCaseId: string;
  refundCaseMessageId: string;
}) => {
  if (!/^[0-9a-f-]{36}$/i.test(refundCaseMessageId)) return null;
  const capability = await tryIssueRefundStatusCapability({
    supabase,
    refundCaseId,
  });
  if (!capability) return null;
  const { data, error } = await supabase.rpc(
    "service_attach_refund_status_capability_to_message",
    {
      p_refund_case_id: refundCaseId,
      p_refund_case_message_id: refundCaseMessageId,
      p_status_capability_id: capability.capabilityId,
    },
  );
  if (error || data !== true) {
    console.error("refund status capability message audit unavailable", {
      errorType: "database_error",
    });
    return null;
  }
  return capability;
};

export const requireCustomerRefundLifecycle = (
  value: unknown,
): CustomerRefundLifecycle => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Refund status is unavailable.");
  }
  const source = value as Record<string, unknown>;
  const customerAction = source.customerAction &&
      typeof source.customerAction === "object" &&
      !Array.isArray(source.customerAction)
    ? source.customerAction as Record<string, unknown>
    : null;
  const messageState = source.messageState &&
      typeof source.messageState === "object" &&
      !Array.isArray(source.messageState)
    ? source.messageState as Record<string, unknown>
    : null;
  const requestedFields = customerAction && Array.isArray(customerAction.requestedFields)
    ? customerAction.requestedFields
    : null;
  const requestedFieldStrings = requestedFields?.every((field) =>
      typeof field === "string" && lifecycleRequestedFields.has(field)
    ) === true
    ? requestedFields as string[]
    : null;
  if (
    source.schemaVersion !== "refund_lifecycle_v2" ||
    source.payloadRedacted !== true ||
    typeof source.version !== "number" ||
    !Number.isSafeInteger(source.version) ||
    source.version < 1 ||
    typeof source.stage !== "string" ||
    !lifecycleStages.has(source.stage as CustomerRefundLifecycle["stage"]) ||
    typeof source.stageRank !== "number" ||
    !Number.isFinite(source.stageRank) ||
    !boundedContractValue(source.reasonCode) ||
    !customerAction ||
    !exactObjectKeys(customerAction, [
      "action",
      "payloadRedacted",
      "requestedFields",
      "required",
    ]) ||
    !boundedContractValue(customerAction.action) ||
    typeof customerAction.required !== "boolean" ||
    customerAction.payloadRedacted !== true ||
    !requestedFieldStrings ||
    requestedFieldStrings.length > lifecycleRequestedFields.size ||
    new Set(requestedFieldStrings).size !== requestedFieldStrings.length ||
    !messageState ||
    !exactObjectKeys(messageState, ["payloadRedacted", "state"]) ||
    !boundedContractValue(messageState.state) ||
    messageState.payloadRedacted !== true ||
    !boundedContractValue(source.paymentState) ||
    typeof source.lastUpdatedAt !== "string" ||
    Number.isNaN(Date.parse(source.lastUpdatedAt)) ||
    !boundedContractValue(source.publicCopyKey, 120) ||
    typeof source.terminal !== "boolean" ||
    !(
      source.refreshAfterSeconds === null ||
      (typeof source.refreshAfterSeconds === "number" &&
        Number.isFinite(source.refreshAfterSeconds) &&
        source.refreshAfterSeconds >= 1 &&
        source.refreshAfterSeconds <= 15)
    )
  ) {
    throw new Error("Refund status is unavailable.");
  }

  return {
    schemaVersion: "refund_lifecycle_v2",
    version: source.version,
    stage: source.stage as CustomerRefundLifecycle["stage"],
    stageRank: source.stageRank,
    reasonCode: source.reasonCode as string,
    customerAction: {
      action: customerAction.action as string,
      required: customerAction.required as boolean,
      requestedFields: [...requestedFieldStrings],
      payloadRedacted: true,
    },
    paymentState: source.paymentState as string,
    messageState: {
      state: messageState.state as string,
      payloadRedacted: true,
    },
    lastUpdatedAt: source.lastUpdatedAt,
    publicCopyKey: source.publicCopyKey as string,
    terminal: source.terminal,
    refreshAfterSeconds: source.refreshAfterSeconds as number | null,
    payloadRedacted: true,
  };
};

export const readRefundStatusCapability = async ({
  supabase,
  token,
  accessKeyDigest,
}: {
  supabase: RpcClient;
  token: string;
  accessKeyDigest: string;
}) => {
  const tokenDigest = isRefundStatusToken(token)
    ? await hashRefundStatusValue(token)
    : await hashRefundStatusValue("invalid-refund-status-capability");
  if (!digestPattern.test(accessKeyDigest)) {
    throw new Error("Refund status is unavailable.");
  }
  const { data, error } = await supabase.rpc(
    "service_read_refund_status_capability",
    {
      p_token_digest: tokenDigest,
      p_access_key_digest: accessKeyDigest,
    },
  );
  const result = data as Record<string, unknown> | null;
  if (error || result?.payloadRedacted !== true) {
    throw new Error("Refund status is unavailable.");
  }
  if (result.rateLimited === true) {
    return { available: false as const, rateLimited: true as const };
  }
  if (result.available !== true) {
    return { available: false as const, rateLimited: false as const };
  }
  return {
    available: true as const,
    rateLimited: false as const,
    lifecycle: requireCustomerRefundLifecycle(result.lifecycle),
    expiresAt: typeof result.expiresAt === "string" ? result.expiresAt : null,
  };
};
