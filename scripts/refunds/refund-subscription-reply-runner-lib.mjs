import { extractLabeledRefundEmailFacts } from '../../supabase/functions/_shared/refund-email-fact-extraction.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const digest = /^[0-9a-f]{64}$/u;
const safeField = new Set(['amount', 'payment_method', 'card_last4']);

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
  const label = {
    amount: 'Amount',
    payment_method: 'Payment method',
    card_last4: 'Card last four',
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
  } else {
    const match = proposal.quote.match(/(?:physical\s+)?card[^.!?]{0,35}(?:end(?:s|ing)?\s+in|last\s+four|últimos?\s+cuatro)[^0-9]{0,12}([0-9]{4})/iu);
    if (!match || /\b(?:wallet|apple pay|google pay|device token)\b/iu.test(proposal.quote)) {
      throw new Error('physical_card_last4_not_supported');
    }
    value = match[1];
  }
  const extracted = extractLabeledRefundEmailFacts(`${label}: ${value}${proposal.field === 'card_last4' ? '\nCard last four source: physical card' : ''}`);
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
  const last4 = extracted.cardLast4;
  if (!last4 || extracted.cardLast4Provenance !== 'physical_card') {
    throw new Error('physical_card_last4_not_supported');
  }
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
      'conflicting_reply_evidence'].includes(proposal.reasonCode)) {
    throw new Error('unsupported_no_fact_review');
  }
  findSource(input, proposal.messageId, proposal.quote);
  return {
    evidenceMessageId: proposal.messageId,
    sourceQuote: proposal.quote,
    reasonCode: proposal.reasonCode,
  };
};
