import type { TransactionalEmailReceipt } from "./internal-email.ts";

type RefundDeliveryRpcClient = {
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<{
    data: unknown;
    error: { name?: string } | null;
  }>;
};

export const REFUND_TRANSACTIONAL_DELIVERY_CONTRACT_VERSION =
  "refund_transactional_delivery_v1" as const;

export type RefundTransactionalDeliveryState =
  | "accepted"
  | "deferred"
  | "delivered"
  | "failed"
  | "bounced"
  | "complained";

export type RefundTransactionalDeliveryWebhook = {
  providerMessageId: string;
  state: RefundTransactionalDeliveryState;
  eventAt: string;
};

const PROVIDER_MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{8,255}$/;

const RESEND_EVENT_STATES: Record<string, RefundTransactionalDeliveryState> = {
  "email.sent": "accepted",
  "email.delivery_delayed": "deferred",
  "email.delivered": "delivered",
  "email.failed": "failed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.suppressed": "failed",
};

export const parseRefundTransactionalDeliveryWebhook = (
  value: unknown,
): RefundTransactionalDeliveryWebhook | null => {
  if (!value || typeof value !== "object") {
    throw new Error("Transactional delivery webhook body is invalid.");
  }
  const payload = value as Record<string, unknown>;
  const type = typeof payload.type === "string" ? payload.type.trim() : "";
  const state = RESEND_EVENT_STATES[type];
  if (!state) return null;
  const data = payload.data && typeof payload.data === "object"
    ? payload.data as Record<string, unknown>
    : null;
  const providerMessageId = typeof data?.email_id === "string"
    ? data.email_id.trim()
    : "";
  const rawEventAt = typeof payload.created_at === "string"
    ? payload.created_at.trim()
    : "";
  const eventAtMs = Date.parse(rawEventAt);
  if (
    !PROVIDER_MESSAGE_ID_PATTERN.test(providerMessageId) ||
    !Number.isFinite(eventAtMs)
  ) {
    throw new Error("Transactional delivery webhook evidence is invalid.");
  }
  return {
    providerMessageId,
    state,
    eventAt: new Date(eventAtMs).toISOString(),
  };
};

export const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const bindRefundTransactionalDelivery = async ({
  supabase,
  refundCaseMessageId,
  receipt,
}: {
  supabase: RefundDeliveryRpcClient;
  refundCaseMessageId: string;
  receipt: TransactionalEmailReceipt;
}) => {
  const { data, error } = await supabase.rpc(
    "service_bind_refund_transactional_delivery",
    {
      p_refund_case_message_id: refundCaseMessageId,
      p_provider_message_id: receipt.providerMessageId,
      p_accepted_at: receipt.acceptedAt,
    },
  );
  const result = data && typeof data === "object"
    ? data as Record<string, unknown>
    : null;
  if (error || result?.bound !== true || result.payloadRedacted !== true) {
    throw new Error("Transactional delivery evidence could not be recorded.");
  }
  return result;
};

export const markRefundTransactionalDeliveryAttempt = async ({
  supabase,
  refundCaseMessageId,
}: {
  supabase: RefundDeliveryRpcClient;
  refundCaseMessageId: string;
}) => {
  const { data, error } = await supabase.rpc(
    "service_mark_refund_transactional_delivery_attempt",
    { p_refund_case_message_id: refundCaseMessageId },
  );
  const result = data && typeof data === "object"
    ? data as Record<string, unknown>
    : null;
  if (error || result?.marked !== true || result.payloadRedacted !== true) {
    throw new Error("Transactional delivery attempt could not be recorded.");
  }
  return result;
};
