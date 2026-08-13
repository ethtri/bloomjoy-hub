import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { RefundGmailError, sha256Hex } from "./refund-gmail.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

type ProofRpcResult = Record<string, unknown> | null;

const proofError = (status: unknown) => {
  const normalized = typeof status === "string" && status
    ? status.replace(/[^a-z0-9_]/gi, "_").toLowerCase()
    : "not_authorized";
  return new RefundGmailError(
    `synthetic_proof_${normalized}`,
    "This message is outside the owner-controlled synthetic Gmail proof.",
  );
};

const requireUuid = (value: unknown, status: string) => {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw proofError(status);
  }
  return value;
};

export const authorizeRefundSyntheticGmailProof = async ({
  supabase,
  refundCaseId,
  recipientEmail,
  runToken,
  messageType,
  defaultTemplateOnly,
}: {
  supabase: SupabaseClient;
  refundCaseId: string;
  recipientEmail: string;
  runToken: unknown;
  messageType: string;
  defaultTemplateOnly: boolean;
}) => {
  const normalizedToken = typeof runToken === "string" ? runToken.trim() : "";
  const tokenDigest = RUN_TOKEN_PATTERN.test(normalizedToken)
    ? await sha256Hex(normalizedToken)
    : "";
  const { data, error } = await supabase.rpc(
    "service_authorize_refund_synthetic_gmail_proof",
    {
      p_refund_case_id: refundCaseId,
      p_recipient_email: recipientEmail,
      p_run_token_digest: tokenDigest,
      p_message_type: messageType,
      p_default_template_only: defaultTemplateOnly,
    },
  );
  if (error) {
    throw new RefundGmailError(
      "synthetic_proof_authorization_failed",
      "The owner-controlled synthetic Gmail proof could not be authorized.",
    );
  }

  const result = data && typeof data === "object"
    ? data as ProofRpcResult
    : null;
  const required = result?.required === true;
  if (!required) {
    if (normalizedToken) throw proofError("unexpected_token");
    return {
      required: false as const,
      authorizationId: null,
      gmailThreadId: null,
    };
  }
  if (result?.allowed !== true) throw proofError(result?.status);

  return {
    required: true as const,
    authorizationId: requireUuid(
      result.authorizationId,
      "invalid_authorization",
    ),
    gmailThreadId: requireUuid(result.gmailThreadId, "invalid_thread"),
  };
};

export const bindRefundSyntheticGmailProofMessage = async ({
  supabase,
  authorizationId,
  refundCaseId,
  refundCaseMessageId,
}: {
  supabase: SupabaseClient;
  authorizationId: string;
  refundCaseId: string;
  refundCaseMessageId: string;
}) => {
  const { data, error } = await supabase.rpc(
    "service_bind_refund_synthetic_gmail_proof_message",
    {
      p_authorization_id: authorizationId,
      p_refund_case_id: refundCaseId,
      p_refund_case_message_id: refundCaseMessageId,
    },
  );
  if (error || data !== true) {
    throw new RefundGmailError(
      "synthetic_proof_message_binding_failed",
      "The one-shot synthetic message could not be bound before delivery.",
    );
  }
};

export const verifyRefundSyntheticGmailProofTransport = async ({
  supabase,
  refundCaseId,
  refundCaseMessageId,
  recipientEmail,
  authorizationId,
}: {
  supabase: SupabaseClient;
  refundCaseId: string;
  refundCaseMessageId: string;
  recipientEmail: string;
  authorizationId?: string | null;
}) => {
  const { data, error } = await supabase.rpc(
    "service_verify_refund_synthetic_gmail_proof_transport",
    {
      p_refund_case_id: refundCaseId,
      p_refund_case_message_id: refundCaseMessageId,
      p_recipient_email: recipientEmail,
      p_authorization_id: authorizationId ?? null,
    },
  );
  if (error) {
    throw new RefundGmailError(
      "synthetic_proof_transport_check_failed",
      "The synthetic Gmail proof transport check failed closed.",
    );
  }

  const result = data && typeof data === "object"
    ? data as ProofRpcResult
    : null;
  const required = result?.required === true;
  if (!required) {
    if (authorizationId) throw proofError("unexpected_authorization");
    return { required: false as const, gmailThreadId: null };
  }
  if (result?.allowed !== true) throw proofError(result?.status);
  return {
    required: true as const,
    gmailThreadId: requireUuid(result.gmailThreadId, "invalid_thread"),
    expectedManagerCount: typeof result.expectedManagerCount === "number" &&
        Number.isInteger(result.expectedManagerCount) &&
        result.expectedManagerCount >= 1 && result.expectedManagerCount <= 3
      ? result.expectedManagerCount
      : (() => {
        throw proofError("invalid_manager_route");
      })(),
    managerRouteDigest: typeof result.managerRouteDigest === "string" &&
        SHA256_PATTERN.test(result.managerRouteDigest)
      ? result.managerRouteDigest
      : (() => {
        throw proofError("invalid_manager_route");
      })(),
  };
};
