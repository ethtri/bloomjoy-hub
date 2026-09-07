import { hashCorrectionToken, isCorrectionToken } from './refund-correction.ts';
import { sanitizeRefundMissingFields } from './refund-deterministic-follow-up.ts';

export const STORED_CORRECTION_LINK_MARKER = '[Secure refund correction link included at delivery]';
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
export async function refundCorrectionLinksEnabled(supabase: RpcClient) {
  const { data, error } = await supabase.rpc('refund_purchase_correction_links_enabled', {});
  if (error || typeof data !== 'boolean') throw new Error('Correction rollout state unavailable.');
  return data;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// One message always produces the same capability and provider payload on retry.
// This dedicated server secret is not a payment credential or a public setting.
export async function correctionTokenForMessage(messageId: string, secret = Deno.env.get('REFUND_CORRECTION_TOKEN_SECRET') ?? '') {
  if (!uuid.test(messageId) || secret.length < 43) throw new Error('Correction delivery configuration unavailable.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`refund-purchase-correction-message-v1:${messageId.toLowerCase()}`)));
  return btoa(String.fromCharCode(...signature)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function requireRefundCorrectionUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['app.bloomjoyusa.com', 'www.bloomjoyusa.com'].includes(url.hostname) ||
      url.username || url.password || url.port || url.search || url.pathname !== '/refunds/correct' ||
      !isCorrectionToken(url.hash.slice('#token='.length)) || !url.hash.startsWith('#token=')) {
    throw new Error('Correction link is not an approved scoped URL.');
  }
  return url.toString();
}

export async function issueRefundCorrectionForMessage({ supabase, messageId, factVersion }: {
  supabase: RpcClient; messageId: string; factVersion: number;
}) {
  if (!(await refundCorrectionLinksEnabled(supabase))) throw new Error('Correction delivery is not active.');
  if (!Number.isSafeInteger(factVersion) || factVersion < 1) throw new Error('Correction facts unavailable.');
  const token = await correctionTokenForMessage(messageId);
  const { data, error } = await supabase.rpc('service_issue_refund_purchase_correction', {
    p_message_id: messageId, p_token_hash: await hashCorrectionToken(token), p_expected_fact_version: factVersion,
  });
  const result = data as Record<string, unknown> | null;
  if (error || result?.state !== 'pending' || typeof result.requestId !== 'string' || !uuid.test(result.requestId) ||
      typeof result.expiresAt !== 'string' || !(Date.parse(result.expiresAt) > Date.now())) {
    throw new Error('Correction capability could not be prepared.');
  }
  return requireRefundCorrectionUrl(`https://app.bloomjoyusa.com/refunds/correct#token=${token}`);
}

export async function getCurrentRefundCorrectionFields(supabase: RpcClient, caseId: string) {
  const { data, error } = await supabase.rpc('refund_purchase_correction_request_fields', { p_case_id: caseId });
  if (error || !Array.isArray(data)) throw new Error('Current correction fields unavailable.');
  const fields = sanitizeRefundMissingFields(data);
  if (fields.length !== data.length) throw new Error('Correction field contract is invalid.');
  return fields;
}

export const correctionLinkRequested = (messageType: string, fields: unknown, enabled: boolean) =>
  enabled && ['more_info', 'no_safe_match', 'reminder', 'wallet_correction', 'wallet_correction_reminder'].includes(messageType) &&
  sanitizeRefundMissingFields(fields).length > 0;
