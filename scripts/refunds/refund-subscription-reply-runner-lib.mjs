import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// The hosted refund workflow uses Node 20, which cannot import .ts directly.
// Transpile the existing checked-in deterministic parser in memory so the
// subscription runner and Gmail intake share one value parser on that host.
const parserSource = fs.readFileSync(new URL('../../supabase/functions/_shared/refund-email-fact-extraction.ts', import.meta.url), 'utf8');
const parserJavaScript = ts.transpileModule(parserSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: fileURLToPath(new URL('../../supabase/functions/_shared/refund-email-fact-extraction.ts', import.meta.url)),
}).outputText;
const { extractLabeledRefundEmailFacts } = await import(`data:text/javascript;base64,${Buffer.from(parserJavaScript).toString('base64')}`);

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const digest = /^[0-9a-f]{64}$/u;
const safeField = new Set([
  'amount', 'payment_method', 'card_last4', 'card_network',
  'wallet_token_last4',
]);

export const validateProposalShape = (proposal) => {
  const allowed = proposal?.kind === 'fact'
    ? ['kind', 'field', 'messageId', 'quote']
    : proposal?.kind === 'reviewed_no_fact'
    ? ['kind', 'reasonCode', 'messageId', 'quote']
    : proposal?.kind === 'internal_research'
    ? ['kind', 'reasonCode'] : [];
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal) ||
    allowed.length === 0 || Object.keys(proposal).some((key) => !allowed.includes(key)) ||
    allowed.some((key) => !Object.hasOwn(proposal, key))) {
    throw new Error('invalid_reply_proposal_shape');
  }
  return proposal;
};

export const validateClaim = (task) => {
  if (!task || typeof task !== 'object' ||
    ![task.requestId, task.refundCaseId, task.sourceMessageId, task.claimToken]
      .every((value) => typeof value === 'string' && uuid.test(value)) ||
    !Number.isSafeInteger(Number(task.factVersion)) || Number(task.factVersion) < 1 ||
    typeof task.bodySha256 !== 'string' || !digest.test(task.bodySha256)) {
    throw new Error('invalid_reply_claim');
  }
  return task;
};

export const validateResearchInput = (task, input) => {
  validateClaim(task);
  if (!input || input.outcome !== 'ready' ||
    input.requestId !== task.requestId ||
    input.refundCaseId !== task.refundCaseId ||
    input.sourceMessageId !== task.sourceMessageId ||
    Number(input.factVersion) !== Number(task.factVersion) ||
    input.bodySha256 !== task.bodySha256 ||
    !Array.isArray(input.replyMessages) || input.replyMessages.length < 1 ||
    !input.replyMessages.some((entry) => entry.messageId === task.sourceMessageId) ||
    input.sensitiveDataRedacted === true) {
    throw new Error('stale_or_sensitive_reply_input');
  }
  return input;
};

const findSource = (input, messageId, quote) => {
  if (typeof messageId !== 'string' || !uuid.test(messageId) ||
    typeof quote !== 'string' || quote.length < 3 || quote.length > 240 ||
    /[\u0000-\u001f]/u.test(quote)) throw new Error('invalid_source_span');
  const message = input.replyMessages.find((entry) => entry.messageId === messageId);
  if (!message || typeof message.body !== 'string' ||
    !message.body.includes(quote)) throw new Error('source_span_not_in_verified_reply');
  return message;
};

// The model chooses a source span and field. Only the existing deterministic
// parser converts that exact span into a value; arbitrary model values are not
// accepted as database updates. This deliberately omits payout details,
// machine selection, payment authority and ambiguous date/time conversion.
export const deriveSourceBoundFact = (input, proposal) => {
  if (!proposal || proposal.kind !== 'fact' ||
    !safeField.has(proposal.field)) throw new Error('unsupported_fact_proposal');
  findSource(input, proposal.messageId, proposal.quote);
  // A source span that denies or corrects a value is evidence to investigate,
  // not authority to turn the mentioned value into a positive case fact.
  if (/(?:^|\W)(?:not|never|no|didn't|did not|wasn't|was not|isn't|is not|don't|do not|doesn't|does not|cannot|can't|couldn't|could not|wrong|incorrect|no longer)(?:\W|$)/iu.test(proposal.quote)) {
    throw new Error('negated_source_span_requires_research');
  }
  if (proposal.field === 'wallet_token_last4') {
    if (!/\b(?:apple pay|google pay|wallet|device token)\b/iu.test(proposal.quote))
      throw new Error('wallet_context_not_supported');
    const afterToken = proposal.quote.match(/\b(?:device token|wallet token)\b[^0-9]{0,40}([0-9]{4})\b/iu);
    const beforeToken = proposal.quote.match(/\b([0-9]{4})\b[^0-9]{0,50}\b(?:apple pay device token|device token|wallet token)\b/iu);
    const tokenDigits = afterToken?.[1] ?? beforeToken?.[1];
    if (!tokenDigits || (afterToken?.[1] && beforeToken?.[1] && afterToken[1] !== beforeToken[1]))
      throw new Error('wallet_token_digits_not_supported');
    return {
      evidenceMessageId: proposal.messageId, sourceQuote: proposal.quote,
      appliedFields: ['card_last4'],
      updates: {
        card_last4: tokenDigits, card_last4_provenance: 'wallet_device_token',
        card_wallet_used: true, payment_interaction: 'phone_watch_wallet',
      },
    };
  }
  const label = {
    amount: 'Amount',
    payment_method: 'Payment method',
    card_last4: 'Card last four',
    card_network: 'Card type',
  }[proposal.field];
  let value = proposal.quote;
  if (proposal.field === 'amount') {
    const match = proposal.quote.match(/(?:\$\s*([0-9]{1,7}(?:\.[0-9]{2})?)|\b([0-9]{1,7}(?:\.[0-9]{2})?)\s*(?:dollars?|usd)\b)/iu);
    if (!match || !/(?:paid?|charged?|amount|total|cost|monto|cobr)/iu.test(proposal.quote)) {
      throw new Error('amount_not_supported');
    }
    value = `$${match[1] ?? match[2]}`;
  } else if (proposal.field === 'payment_method') {
    const cash = /\b(?:paid|used|inserted|put in|pagu[eé]|us[eé])\b[^.!?]{0,45}\b(?:cash|efectivo)\b/iu.test(proposal.quote);
    const card = /\b(?:paid|used|tapped|inserted|swiped|pagu[eé]|us[eé])\b[^.!?]{0,45}\b(?:card|tarjeta)\b/iu.test(proposal.quote);
    if (cash === card) throw new Error('payment_method_not_supported');
    value = cash ? 'cash' : 'card';
  } else if (proposal.field === 'card_last4') {
    const match = proposal.quote.match(/(?:physical\s+)?card[^.!?]{0,35}(?:end(?:s|ing)?\s+in|last\s+four|últimos?\s+cuatro)[^0-9]{0,12}([0-9]{4})/iu);
    if (!match || /\b(?:wallet|apple pay|google pay|device token)\b/iu.test(proposal.quote)) {
      throw new Error('physical_card_last4_not_supported');
    }
    value = match[1];
  } else {
    const networks = [...proposal.quote.matchAll(/\b(?:visa|master\s*card|mastercard|amex|american\s+express|discover)\b/giu)];
    if (networks.length !== 1 || !/\b(?:card|tarjeta|network)\b/iu.test(proposal.quote)) {
      throw new Error('card_network_not_supported');
    }
    value = networks[0][0];
  }
  const extracted = extractLabeledRefundEmailFacts(`${label}: ${value}${proposal.field === 'card_last4'
    ? '\nCard last four source: physical card' : ''}`);
  if (extracted.manualReviewReason || extracted.ambiguousFields.length > 0) {
    throw new Error('ambiguous_source_span');
  }
  if (proposal.field === 'amount') {
    const cents = extracted.amountCents;
    if (!Number.isSafeInteger(cents) || cents < 1) throw new Error('amount_not_supported');
    return {
      evidenceMessageId: proposal.messageId,
      sourceQuote: proposal.quote,
      appliedFields: ['amount'],
      updates: { payment_amount_cents: cents, refund_amount_cents: cents },
    };
  }
  if (proposal.field === 'payment_method') {
    const method = extracted.paymentMethod;
    if (method !== 'card' && method !== 'cash') throw new Error('payment_method_not_supported');
    return {
      evidenceMessageId: proposal.messageId,
      sourceQuote: proposal.quote,
      appliedFields: ['payment_method'],
      updates: { payment_method: method },
    };
  }
  if (proposal.field === 'card_network') {
    if (!['visa', 'mastercard', 'american_express', 'discover'].includes(extracted.cardNetwork)) {
      throw new Error('card_network_not_supported');
    }
    return {
      evidenceMessageId: proposal.messageId, sourceQuote: proposal.quote,
      appliedFields: ['card_network'], updates: { card_network: extracted.cardNetwork },
    };
  }
  const last4 = extracted.cardLast4;
  if (!last4 || extracted.cardLast4Provenance !== 'physical_card')
    throw new Error('card_last4_provenance_not_supported');
  return {
    evidenceMessageId: proposal.messageId,
    sourceQuote: proposal.quote,
    appliedFields: ['card_last4'],
    updates: { card_last4: last4, card_last4_provenance: 'physical_card' },
  };
};

export const validateDeferral = (proposal) => {
  if (!proposal || proposal.kind !== 'internal_research' ||
    ![
      'provider_configuration_missing', 'provider_unavailable',
      'provider_timeout', 'provider_schema_rejected',
      'research_input_unavailable', 'research_result_unresolved',
    ].includes(proposal.reasonCode)) throw new Error('unsupported_research_deferral');
  return proposal.reasonCode;
};

export const validateNoFactReview = (input, proposal) => {
  if (!proposal || proposal.kind !== 'reviewed_no_fact' ||
    !['customer_cannot_provide', 'no_supported_new_fact',
      'conflicting_reply_evidence','inexact_purchase_time_requires_research',
      'wallet_token_requires_research'].includes(proposal.reasonCode)) {
    throw new Error('unsupported_no_fact_review');
  }
  findSource(input, proposal.messageId, proposal.quote);
  if (proposal.reasonCode === 'customer_cannot_provide' &&
    !/(?:cannot|can't|could not|couldn't|unable to|not able to|do not have|don't have|no longer have|do not remember|don't remember|no tengo|no puedo)/iu.test(proposal.quote)) {
    throw new Error('cannot_provide_source_not_supported');
  }
  if (proposal.reasonCode === 'no_supported_new_fact' &&
    /(?:^|\W)(?:not|never|no|didn't|did not|wasn't|was not|isn't|is not|don't|do not|doesn't|does not|cannot|can't|couldn't|could not|wrong|incorrect)(?:\W|$)/iu.test(proposal.quote) &&
    /(?:\d|\bcash\b|\bcard\b|\bwallet\b|\bvisa\b|\bmastercard\b)/iu.test(proposal.quote)) {
    throw new Error('supported_fact_requires_fact_review');
  }
  // Generic no-fact dispositions cannot discard a concrete amount, payment
  // method, physical-card suffix or network supplied in the cited span.
  const quotedFact = /(?:\$\s*\d|\b(?:paid|charged|amount|total|cost|monto|cobr)\b[^.!?]{0,25}\d|\b(?:paid|used|tapped|inserted|swiped)\b[^.!?]{0,45}\b(?:cash|card)\b|\bcard\b[^.!?]{0,35}\b(?:ends? in|last four)\b[^.!?]{0,12}\d{4}\b|\b(?:visa|mastercard|amex|discover)\b)/iu.test(proposal.quote);
  if (quotedFact && ['customer_cannot_provide', 'no_supported_new_fact',
    'conflicting_reply_evidence'].includes(proposal.reasonCode)) {
    const current = input.currentFacts ?? {};
    const sameAsCurrent = proposal.reasonCode === 'no_supported_new_fact' &&
      [...proposal.quote.matchAll(/\$\s*\d/gu)].length <= 1 &&
      [...proposal.quote.matchAll(/\b(?:visa|mastercard|amex|discover)\b/giu)].length <= 1 &&
      !(/\b(?:paid|charged|amount|total|cost|monto|cobr)\b[^.!?]{0,25}\d/iu.test(proposal.quote) &&
        !/\$\s*\d/u.test(proposal.quote)) &&
      ['amount', 'payment_method', 'card_last4', 'card_network'].some((field) => {
        try {
          const fact = deriveSourceBoundFact(input, { kind: 'fact', field,
            messageId: proposal.messageId, quote: proposal.quote });
          return field === 'amount'
            ? Number(current.paymentAmountCents) === fact.updates.payment_amount_cents
            : field === 'payment_method'
            ? current.paymentMethod === fact.updates.payment_method
            : field === 'card_network'
            ? current.cardNetwork === fact.updates.card_network
            : current.cardLast4 === fact.updates.card_last4 &&
              current.cardLast4Provenance === fact.updates.card_last4_provenance;
        } catch { return false; }
      });
    if (!sameAsCurrent) throw new Error('supported_fact_requires_fact_review');
  }
  if (proposal.reasonCode === 'wallet_token_requires_research' &&
    !/(?:apple pay|google pay|wallet|device token)/iu.test(proposal.quote)) {
    throw new Error('wallet_research_source_not_supported');
  }
  if (proposal.reasonCode === 'inexact_purchase_time_requires_research' &&
    !/(?:around|about|roughly|remember|morning|afternoon|evening)/iu.test(proposal.quote)) {
    throw new Error('time_research_source_not_supported');
  }
  return {
    evidenceMessageId: proposal.messageId,
    sourceQuote: proposal.quote,
    reasonCode: proposal.reasonCode,
  };
};
