import { buildRefundManagerReadyEmail, parseRefundManagerReadyNotice } from "./refund-manager-ready-email.ts";

type RpcResult = { data: unknown; error: unknown };
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult> };
type SendEmail = (message: {
  to: string[]; subject: string; text: string; html: string;
  senderName: string; idempotencyKey: string;
}) => Promise<{ providerMessageId: string }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const email = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export const deliverRefundManagerReadyClaim = async ({ client, claim, sendEmail, caseUrl }: {
  client: RpcClient;
  claim: unknown;
  sendEmail: SendEmail;
  caseUrl: (caseId: string) => string;
}): Promise<"sent" | "stale"> => {
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
    throw new Error("Ready notice claim is invalid.");
  }
  const value = claim as Record<string, unknown>;
  const intentId = value.intentId;
  const token = value.claimToken;
  const recipient = value.recipient;
  const routeFingerprint = value.routeFingerprint;
  if (value.claimed !== true || value.payloadRedacted !== true ||
    typeof intentId !== "string" || !uuid.test(intentId) ||
    typeof token !== "string" || !uuid.test(token) ||
    typeof recipient !== "string" || !email.test(recipient) ||
    recipient !== recipient.trim().toLowerCase() ||
    typeof routeFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(routeFingerprint)) {
    throw new Error("Ready notice claim contains an unsafe route.");
  }
  let providerStarted = false;
  try {
    const notice = parseRefundManagerReadyNotice(value.projection);
    const message = buildRefundManagerReadyEmail({ notice, caseUrl: caseUrl(notice.caseId) });
    const started = await client.rpc("service_mark_refund_manager_ready_notice_provider_started", {
      p_intent_id: intentId, p_claim_token: token,
      p_route_fingerprint: routeFingerprint, p_recipient: recipient,
    });
    if (started.error) throw started.error;
    if (started.data !== true) return "stale";
    providerStarted = true;
    const receipt = await sendEmail({
      to: [recipient], subject: message.subject, text: message.text, html: message.html,
      senderName: "Bloomjoy Refunds",
      idempotencyKey: `refund_manager_ready_${intentId.replaceAll("-", "")}`,
    });
    const completed = await client.rpc("service_complete_refund_manager_ready_notice", {
      p_intent_id: intentId, p_claim_token: token,
      p_outcome: "sent", p_provider_message_id: receipt.providerMessageId,
    });
    if (completed.error || completed.data !== true) {
      throw completed.error ?? new Error("Ready notice settlement was not confirmed.");
    }
    return "sent";
  } catch (error) {
    try {
      await client.rpc("service_complete_refund_manager_ready_notice", {
        p_intent_id: intentId, p_claim_token: token,
        p_outcome: providerStarted ? "delivery_unknown" : "known_not_sent",
        p_provider_message_id: null,
      });
    } catch {
      // The provider-start marker is already the durable no-blind-retry hold.
    }
    throw error;
  }
};
