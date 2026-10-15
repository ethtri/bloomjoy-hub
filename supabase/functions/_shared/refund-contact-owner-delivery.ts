import { getRefundManagerNoticeReservationRouteInputs } from './refund-manager-notification.ts';
import type { AlertRpcClient, AlertSendEmail } from './machine-email-alert-delivery.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const email = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Purpose-specific adapter around the existing protected action ledger. */
export async function deliverRefundContactOwnerClaim({ client, claim, sendEmail, caseUrl }: {
  client: AlertRpcClient; claim: unknown; sendEmail: AlertSendEmail; caseUrl: (id: string) => string;
}): Promise<'sent' | 'stale'> {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('contact_owner_claim_invalid');
  const c = claim as Record<string, unknown>;
  const keys = ['claimed', 'claimKind', 'requiredRefundActionsVersion', 'actionId', 'claimToken', 'recipients', 'routeFingerprint', 'caseId', 'publicReference', 'machineLabel', 'payloadRedacted'];
  if (Object.keys(c).some(key => !keys.includes(key)) || c.claimed !== true || c.claimKind !== 'customer_contact_owner_needed' ||
    c.requiredRefundActionsVersion !== 1 || c.payloadRedacted !== true ||
    ![c.actionId, c.claimToken, c.caseId].every(value => typeof value === 'string' && uuid.test(value)) ||
    !Array.isArray(c.recipients) || c.recipients.length < 1 || c.recipients.length > 5 ||
    !c.recipients.every(value => typeof value === 'string' && email.test(value) && value === value.trim().toLowerCase()) ||
    new Set(c.recipients).size !== c.recipients.length || typeof c.routeFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(c.routeFingerprint) ||
    ![c.publicReference, c.machineLabel].every(value => typeof value === 'string' && value.trim().length > 0 && value.length <= 240 && !/[\r\n]/.test(value))) {
    throw new Error('contact_owner_claim_invalid');
  }
  let providerStarted = false;
  try {
    const url = new URL(caseUrl(c.caseId as string));
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('contact_owner_link_invalid');
    const instructions = 'The refund decision is saved, but the customer notice could not be sent. Assign a responsible Manager to review the customer email and retry the saved notice.';
    const subject = `Customer contact needs an owner: ${c.publicReference}`;
    const text = `${instructions}\n\n${c.publicReference}\n${c.machineLabel}\nOpen case: ${url}\n\nThis routing exception goes to Bloomjoy operations. Quiet hours apply.`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172535"><main style="box-sizing:border-box;max-width:640px;margin:auto;padding:24px;background:white;line-height:1.5;overflow-wrap:anywhere"><p>bloomjoy HUB</p><h1 style="font-size:22px;line-height:1.25">Customer contact needs an owner</h1><p>${escape(instructions)}</p><p><strong>${escape(c.publicReference as string)}</strong><br>${escape(c.machineLabel as string)}</p><p><a href="${escape(url.toString())}">Open refund case ${escape(c.publicReference as string)}</a></p><p style="font-size:13px">This routing exception goes to Bloomjoy operations. Quiet hours apply.</p></main></body></html>`;
    // The configured Ops route is reused; no caller can supply a different
    // fallback after reservation without invalidating the stored fingerprint.
    const inputs = getRefundManagerNoticeReservationRouteInputs({ customerEmail: '' });
    const started = await client.rpc('service_mark_refund_contact_owner_provider_started', {
      p_action_id: c.actionId, p_claim_token: c.claimToken, p_route_fingerprint: c.routeFingerprint,
      p_recipients: c.recipients,
      p_mailbox_identities: inputs.mailboxIdentities, p_ops_fallback_recipients: inputs.opsFallbackRecipients,
    });
    if (started.error) throw started.error;
    if (started.data !== true) {
      await client.rpc('service_complete_refund_manager_notification', { p_action_id: c.actionId, p_claim_token: c.claimToken, p_outcome: 'known_not_sent', p_provider_message_id: null });
      return 'stale';
    }
    providerStarted = true;
    const receipt = await sendEmail({ to: c.recipients as string[], subject, text, html, senderName: 'Bloomjoy Hub', idempotencyKey: `refund_manager_${(c.actionId as string).replaceAll('-', '')}` });
    const settled = await client.rpc('service_complete_refund_manager_notification', { p_action_id: c.actionId, p_claim_token: c.claimToken, p_outcome: 'sent', p_provider_message_id: receipt.providerMessageId });
    if (settled.error || settled.data !== true) throw new Error('contact_owner_settlement_unconfirmed');
    return 'sent';
  } catch (error) {
    try { await client.rpc('service_complete_refund_manager_notification', { p_action_id: c.actionId, p_claim_token: c.claimToken, p_outcome: providerStarted ? 'delivery_unknown' : 'known_not_sent', p_provider_message_id: null }); } catch { /* Existing provider marker is a durable no-blind-retry hold. */ }
    throw error;
  }
}
