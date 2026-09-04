import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { corsHeaders } from './cors.ts';
import { hashCorrectionToken, isCorrectionToken, validateCorrectionAnswers, type CorrectionContext } from './refund-correction.ts';
import { runAutomaticNayaxLookupIfReady } from './automatic-nayax-lookup.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: {
  ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive',
} });
const unavailable = () => json({ errorCode: 'correction_unavailable', correction: { state: 'unavailable' } }, 409);
const temporarilyUnavailable = () => json({ errorCode: 'correction_temporarily_unavailable' }, 503);
// Exact P0001 messages raised by the scoped submit RPC. Other database failures
// are operational: never mislabel a timeout or an internal constraint as expiry.
const staleSaveMessages = new Set(['Correction link unavailable', 'Correction link is stale or unavailable']);
const invalidSaveMessages = new Set([
  'Requested answers required', 'Unsupported correction answer', 'Invalid time confidence',
  'Missing values cannot be confirmed', 'Unknown answers cannot contain values',
  'Invalid correction value', 'Invalid payout contact', 'Payment method and interaction conflict',
  'Wallet details require a wallet purchase', 'Confirm how the card was used before changing its digits',
  'Card details require a card purchase', 'Purchase time outside supported range',
]);

export async function recheckSavedPurchaseCorrection(supabase: SupabaseClient, requestId: string, caseId: string, factVersion: number,
  lookup = runAutomaticNayaxLookupIfReady) {
  try {
    // Reuse the current fact-version action claim and stale-result protection.
    // A retry/replayed worker cannot issue a second lookup for this version.
    const result = await lookup({ supabase, caseId, source: 'customer_reply_recheck', expectedFactVersion: factVersion });
    let state: 'pending' | 'completed' | 'failed' | 'not_ready' | 'stale' | 'in_progress';
    if (result.status === 'deduplicated') {
      const { data: action, error } = await supabase.from('refund_automation_actions').select('status')
        .eq('action_key', `nayax_lookup:${caseId}:v${factVersion}`).maybeSingle();
      if (error) throw error;
      state = action?.status === 'completed' ? 'completed' : action?.status === 'failed' ? 'failed' : 'in_progress';
    } else state = result.status;
    const { error } = await supabase.from('refund_wallet_correction_contexts').update({
      correction_next_action: state === 'in_progress' ? 'recheck' : 'review',
      correction_recheck_state: state,
    })
      .eq('id', requestId).eq('correction_resulting_fact_version', factVersion).eq('status', 'submitted');
    if (error) throw error;
  } catch {
    // The committed response remains available to the existing sweep. Never
    // convert a lookup outage into a failed customer submission or payment.
    console.error('saved purchase correction needs internal recheck recovery');
  }
}

async function resumeSavedResponse(supabase: SupabaseClient, tokenHash: string) {
  const { data: request, error } = await supabase.from('refund_wallet_correction_contexts')
    .select('id,refund_case_id,correction_resulting_fact_version').eq('token_hash',tokenHash)
    .eq('correction_kind','purchase').eq('status','submitted').eq('correction_next_action','recheck').maybeSingle();
  if (error) return;
  if (request) await recheckSavedPurchaseCorrection(supabase,request.id,request.refund_case_id,request.correction_resulting_fact_version);
}

async function currentSavedResponse(supabase: SupabaseClient, tokenHash: string, publicReference?: string) {
  // A synchronous recheck can already have finished. Read its committed result;
  // the response's original nextAction is not current execution evidence.
  try {
    const { data, error } = await supabase.rpc('service_get_refund_purchase_correction', { p_token_hash: tokenHash });
    if (!error && data?.state === 'received') return data;
  } catch { /* A read outage cannot undo the committed customer response. */ }
  return { state: 'received', publicReference };
}

export async function handlePurchaseCorrection(body: Record<string, unknown>, supabase: SupabaseClient) {
  const submitting = body.action === 'submitPurchaseCorrection';
  const allowed = submitting ? ['action','token','version','answers'] : ['action','token'];
  if (Object.keys(body).some((key) => !allowed.includes(key)) || typeof body.token !== 'string' || !isCorrectionToken(body.token)) return unavailable();
  const hash = await hashCorrectionToken(body.token);
  const { data, error } = await supabase.rpc('service_get_refund_purchase_correction', { p_token_hash: hash });
  if (error) return json({ errorCode: 'correction_temporarily_unavailable' }, 503);
  const context = data as CorrectionContext;
  if (!submitting) return json({ correction: context });
  if (context?.state === 'received') {
    await resumeSavedResponse(supabase,hash);
    return json({ correction: await currentSavedResponse(supabase, hash, context.publicReference) });
  }
  if (context?.state !== 'ready' || !Number.isSafeInteger(body.version) || body.version !== context.version) return unavailable();
  let answers;
  try { answers = validateCorrectionAnswers(body.answers, context); }
  catch { return json({ errorCode: 'correction_invalid_answers' }, 400); }
  let saveResult: Awaited<ReturnType<typeof supabase.rpc>>;
  try {
    saveResult = await supabase.rpc('service_submit_refund_purchase_correction', {
      p_token_hash: hash, p_expected_fact_version: body.version, p_answers: answers,
    });
  } catch { return temporarilyUnavailable(); }
  const { data: saved, error: saveError } = saveResult;
  if (saveError) {
    if (saveError.code === 'P0001' && staleSaveMessages.has(saveError.message)) return unavailable();
    if (saveError.code === 'P0001' && invalidSaveMessages.has(saveError.message)) return json({ errorCode: 'correction_invalid_answers' }, 400);
    return temporarilyUnavailable();
  }
  if (!saved) return temporarilyUnavailable();
  if (saved?.nextAction === 'recheck' && saved?.refundCaseId && saved?.requestId) {
    await recheckSavedPurchaseCorrection(supabase, saved.requestId, saved.refundCaseId, saved.factVersion);
  }
  return json({ correction: await currentSavedResponse(supabase, hash, saved.publicReference) });
}
