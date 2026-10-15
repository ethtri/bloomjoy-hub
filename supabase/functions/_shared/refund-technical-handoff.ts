import type { TransactionalEmailInput, TransactionalEmailReceipt } from "./internal-email.ts";

type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{data: unknown; error: unknown}> };
export type TechnicalHandoffRuntime = {
  automation: boolean; customerContact: boolean; manualOutbox: boolean; managerDigest: boolean; managerReady: boolean;
};
const approved = ["etrifari@bloomjoysweets.com", "ian@bloomjoysweets.com"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type TechnicalHandoffOutcome = "legacy" | "not_needed" | "deferred" | "accepted" | "delivery_unknown" | "unavailable";

// One application-level event survives all cron ticks, deployments and provider
// idempotency windows. Never use the broad internal recipient/env union here.
export async function deliverRefundTechnicalHandoff({
  client, health, runId, sender, refundsUrl, runtime, mailboxIdentities, sendEmail, providerTimeoutMs = 5_000,
}: {
  client: RpcClient; health: {technicalIncidentHandoffVersion?: unknown; status?: string};
  runId: string; sender: string | null; refundsUrl: string; runtime: TechnicalHandoffRuntime;
  mailboxIdentities: string[]; providerTimeoutMs?: number; sendEmail: (input: TransactionalEmailInput) => Promise<TransactionalEmailReceipt>;
}): Promise<TechnicalHandoffOutcome> {
  if (!Object.prototype.hasOwnProperty.call(health, "technicalIncidentHandoffVersion")) return "legacy";
  if (health.technicalIncidentHandoffVersion !== 1) return "unavailable";
  // Missing sender configuration is known pre-provider unavailability. It never
  // claims/consumes the one notice; a later ordinary health tick can try safely.
  if (!sender?.trim()) return "unavailable";
  const claimed = await client.rpc("service_claim_refund_technical_incident_handoff", {
    p_run_id: runId, p_health_status: health.status ?? null, p_sender: sender, p_refunds_url: refundsUrl,
  });
  if (claimed.error || !claimed.data || typeof claimed.data !== "object") return "unavailable";
  const c = claimed.data as Record<string, unknown>;
  if (c.claimed === false) return c.state === "delivery_unknown" ? "delivery_unknown" : "not_needed";
  if (c.claimed !== true || c.payloadRedacted !== true || typeof c.incidentId !== "string" || !uuid.test(c.incidentId) ||
    typeof c.claimToken !== "string" || !uuid.test(c.claimToken) || !c.payload || typeof c.payload !== "object") return "unavailable";
  const p = c.payload as Record<string, unknown>;
  if (!Array.isArray(p.to) || JSON.stringify(p.to) !== JSON.stringify(approved) ||
    typeof p.senderEmail !== "string" || !p.senderEmail.trim() || /[\r\n]/.test(p.senderEmail) ||
    typeof p.subject !== "string" || !p.subject || p.subject.length > 200 || /[\r\n]/.test(p.subject) ||
    typeof p.text !== "string" || !p.text || p.text.length > 4000 ||
    p.idempotencyKey !== `refund_technical_incident_${c.incidentId}` ||
    Object.keys(p).sort().join(",") !== "idempotencyKey,senderEmail,subject,text,to") return "unavailable";
  // Copy the frozen effective provider payload. Current env sender/settings can
  // change without changing the bytes of an already prepared same-key notice.
  const payload = {to: [...approved], senderEmail: p.senderEmail, subject: p.subject,
    text: p.text, idempotencyKey: p.idempotencyKey as string};
  let providerStarted = false;
  try {
    const marked = await client.rpc("service_mark_refund_technical_handoff_provider_started", {
      p_incident_id: c.incidentId, p_claim_token: c.claimToken, p_payload: payload,
      p_runtime: runtime, p_mailbox_identities: mailboxIdentities,
    });
    if (marked.error || !marked.data || typeof marked.data !== "object" || !("allowed" in marked.data)) return "unavailable";
    if (marked.data.allowed !== true) return "deferred";
    providerStarted = true;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let receipt: TransactionalEmailReceipt;
    try {
      receipt = await Promise.race([sendEmail(payload), new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error("Handoff acceptance timeout")), providerTimeoutMs);
      })]);
    } finally { if (deadline !== undefined) clearTimeout(deadline); }
    if (receipt.provider !== "resend" || !/^[A-Za-z0-9_-]{8,255}$/.test(receipt.providerMessageId)) throw new Error("Handoff receipt unavailable");
    const settled = await client.rpc("service_complete_refund_technical_incident_handoff", {
      p_incident_id: c.incidentId, p_claim_token: c.claimToken, p_outcome: "accepted",
      p_provider_message_id: receipt.providerMessageId,
    });
    // A failed receipt commit leaves the durable pre-send unknown marker. No
    // repeat transport call is allowed to discover whether acceptance occurred.
    return !settled.error && settled.data === true ? "accepted" : "delivery_unknown";
  } catch {
    try { await client.rpc("service_complete_refund_technical_incident_handoff", {
      p_incident_id: c.incidentId, p_claim_token: c.claimToken,
      p_outcome: providerStarted ? "delivery_unknown" : "known_not_sent", p_provider_message_id: null,
    }); } catch { /* Durable provider marker remains authoritative. */ }
    return providerStarted ? "delivery_unknown" : "unavailable";
  }
}
