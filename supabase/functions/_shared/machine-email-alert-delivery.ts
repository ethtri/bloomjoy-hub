import {
  buildMachineEmail,
  type MachineEmailLinks,
  parseMachineEmailProjection,
} from "./machine-email-alert.ts";
import { deliverRefundManagerReadyClaim } from "./refund-manager-ready-delivery.ts";

export type AlertRpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};
export type AlertSendEmail = (
  message: {
    to: string[];
    subject: string;
    text: string;
    html: string;
    senderName: string;
    idempotencyKey: string;
  },
) => Promise<{ providerMessageId: string }>;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Subscription presentation around the mature, protected decision renderer; no workflow change. */
export function decorateReadySubscription<
  T extends { html: string; text: string },
>(message: T, preferencesUrl: string): T {
  const url = new URL(preferencesUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("email_alert_link_invalid");
  }
  const escaped = url.toString().replaceAll("&", "&amp;").replaceAll(
    '"',
    "&quot;",
  ).replaceAll("<", "&lt;");
  const header =
    '<p style="margin:0 0 26px;font-family:Arial,Helvetica,sans-serif;font-weight:700;color:#7b2946;letter-spacing:1px">bloomjoy HUB</p>';
  const footer =
    `<p style="font-size:14px;line-height:1.5;margin:24px 0 12px">You receive this update because you follow refund decisions for this machine.</p><p><a href="${escaped}" style="color:#7b2946;font-weight:700;text-decoration:underline">Manage or turn off email alerts</a></p>`;
  return {
    ...message,
    html: message.html.replace(/(<main[^>]*>)/, `$1${header}`).replace(
      "</main>",
      `${footer}</main>`,
    ),
    text:
      `${message.text}\n\nYou receive this update because you follow refund decisions for this machine.\nManage or turn off email alerts: ${url.toString()}`,
  };
}

export function deliverMachineReadyClaim(
  { client, claim, sendEmail, links }: {
    client: AlertRpcClient;
    claim: unknown;
    sendEmail: AlertSendEmail;
    links: MachineEmailLinks;
  },
): Promise<"sent" | "stale"> {
  return deliverRefundManagerReadyClaim({
    client,
    claim,
    caseUrl: links.caseUrl,
    sendEmail: (message) =>
      sendEmail(decorateReadySubscription(message, links.preferencesUrl)),
  });
}

/** One claimed delivery, one provider call. A started call is never automatically retried. */
export async function deliverMachineEmailClaim(
  { client, claim, sendEmail, links }: {
    client: AlertRpcClient;
    claim: unknown;
    sendEmail: AlertSendEmail;
    links: MachineEmailLinks;
  },
): Promise<"sent" | "stale"> {
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
    throw new Error("email_alert_claim_invalid");
  }
  const c = claim as Record<string, unknown>;
  if (
    c.claimed !== true || c.payloadRedacted !== true ||
    typeof c.jobId !== "string" || !uuid.test(c.jobId) ||
    typeof c.claimToken !== "string" || !uuid.test(c.claimToken) ||
    typeof c.recipient !== "string" ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(c.recipient) ||
    c.recipient !== c.recipient.trim().toLowerCase() ||
    typeof c.routeFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(c.routeFingerprint) ||
    typeof c.idempotencyKey !== "string" ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(c.idempotencyKey)
  ) throw new Error("email_alert_claim_route_invalid");
  let providerStarted = false;
  let providerId: string | null = null;
  try {
    const projection = parseMachineEmailProjection(c.projection);
    if (projection.category !== c.category) {
      throw new Error("email_alert_claim_category_invalid");
    }
    const message = buildMachineEmail({ projection, links });
    const started = await client.rpc(
      "service_mark_email_alert_provider_started",
      {
        p_job_id: c.jobId,
        p_claim_token: c.claimToken,
        p_recipient: c.recipient,
        p_route_fingerprint: c.routeFingerprint,
      },
    );
    if (started.error) throw new Error("email_alert_start_failed");
    if (started.data !== true) return "stale";
    providerStarted = true;
    const receipt = await sendEmail({
      to: [c.recipient],
      subject: message.subject,
      text: message.text,
      html: message.html,
      senderName: "Bloomjoy Hub",
      idempotencyKey: c.idempotencyKey,
    });
    if (!/^[A-Za-z0-9_-]{8,255}$/.test(receipt.providerMessageId)) {
      throw new Error("email_alert_receipt_invalid");
    }
    providerId = receipt.providerMessageId;
    const completed = await client.rpc("service_complete_email_alert", {
      p_job_id: c.jobId,
      p_claim_token: c.claimToken,
      p_outcome: "sent",
      p_provider_id: providerId,
      p_error_code: null,
    });
    if (completed.error || completed.data !== true) {
      throw new Error("email_alert_settlement_failed");
    }
    return "sent";
  } catch {
    try {
      // Preserve a known receipt if settlement failed. Never replace it with an unknown outcome.
      await client.rpc("service_complete_email_alert", {
        p_job_id: c.jobId,
        p_claim_token: c.claimToken,
        p_outcome: providerId
          ? "sent"
          : providerStarted
          ? "delivery_unknown"
          : "known_not_sent",
        p_provider_id: providerId,
        p_error_code: providerId
          ? "settlement_retry"
          : providerStarted
          ? "provider_outcome_unconfirmed"
          : "projection_or_start_invalid",
      });
    } catch {
      /* The durable provider-start marker already prevents a blind resend. */
    }
    throw new Error(
      providerStarted ? "email_alert_delivery_held" : "email_alert_not_sent",
    );
  }
}

export function machineEmailLinks(
  origin = "https://app.bloomjoyusa.com",
): MachineEmailLinks {
  const base = new URL(origin);
  if (
    base.protocol !== "https:" || base.username || base.password ||
    base.pathname !== "/" || base.search || base.hash
  ) throw new Error("email_alert_portal_origin_invalid");
  return {
    preferencesUrl: `${base.origin}/portal/notifications`,
    reportUrl: `${base.origin}/portal/reports`,
    caseUrl: (caseId) =>
      `${base.origin}/refunds?case=${encodeURIComponent(caseId)}`,
    machineUrl: (machineId) =>
      `${base.origin}/portal/reports?machine=${encodeURIComponent(machineId)}`,
  };
}
