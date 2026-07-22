export const REFUND_GPT_TRIAGE_SCHEMA_VERSION = 'refund_gpt_triage_v1';
export const REFUND_GPT_TRIAGE_PROMPT_VERSION = 'refund_missing_info_v1';
export const REFUND_GPT_TRIAGE_HIGH_VALUE_CENTS = 2500;

export const REFUND_GPT_TRIAGE_MISSING_FIELDS = Object.freeze([
  'location_or_machine',
  'incident_date',
  'incident_time',
  'payment_method',
  'amount',
  'card_last4',
]);

export const REFUND_GPT_TRIAGE_POLICY_FLAGS = Object.freeze([
  'legal',
  'safety',
  'threat',
  'chargeback',
  'abusive_or_escalated',
  'prompt_injection',
  'high_value',
  'wallet_payment',
  'prohibited_payment_data',
]);

const TOP_LEVEL_KEYS = Object.freeze([
  'schemaVersion',
  'classification',
  'confidenceBand',
  'language',
  'route',
  'summary',
  'extracted',
  'missingFields',
  'policyFlags',
  'draft',
]);

const EXTRACTED_KEYS = Object.freeze([
  'locationName',
  'machineLabel',
  'incidentDate',
  'incidentTime',
  'paymentMethod',
  'amountCents',
  'cardLast4',
  'walletUsed',
]);

const DRAFT_KEYS = Object.freeze(['subject', 'body']);
const CLASSIFICATIONS = new Set(['refund', 'unrelated', 'uncertain']);
const CONFIDENCE_BANDS = new Set(['high', 'medium', 'low']);
const ROUTES = new Set(['draft_reply', 'human_review']);
const PAYMENT_METHODS = new Set(['card', 'cash', 'unknown']);
const MISSING_FIELD_SET = new Set(REFUND_GPT_TRIAGE_MISSING_FIELDS);
const POLICY_FLAG_SET = new Set(REFUND_GPT_TRIAGE_POLICY_FLAGS);

const FIELD_LABELS = Object.freeze({
  location_or_machine: 'the machine location or a description of the machine',
  incident_date: 'the purchase date',
  incident_time: 'the approximate purchase time',
  payment_method: 'whether you paid by card or cash',
  amount: 'the amount paid',
  card_last4: 'only the last four digits shown on the card charge',
});

const REQUEST_INTENTS = Object.freeze({
  location_or_machine: [/(?:machine|purchase) location/i, /where (?:the )?(?:machine|purchase)/i, /description of the machine/i],
  incident_date: [/purchase date/i, /date of (?:the )?purchase/i, /what date/i],
  incident_time: [/purchase time/i, /approximate time/i, /what time/i],
  payment_method: [/paid by card or cash/i, /payment method/i, /card or cash/i],
  amount: [/amount paid/i, /purchase amount/i, /how much/i],
  card_last4: [/last four/i, /last 4/i],
});

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const exactKeys = (value, allowedKeys) => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === allowedKeys.length && keys.every((key, index) => key === [...allowedKeys].sort()[index]);
};

const cleanString = (value, maxLength) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : '';

const nullableStringValid = (value, maxLength) =>
  value === null || (typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength);

const uniqueSorted = (values) => [...new Set(values)].sort();

const luhnValid = (digits) => {
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
};

export const redactRefundTriageContent = (value) => {
  let redacted = false;
  const input = String(value ?? '').slice(0, 50_000);
  const cardRedacted = input.replace(/(?:\d[ -]?){13,19}/g, (candidate) => {
    const digits = candidate.replace(/\D/g, '');
    if (!luhnValid(digits)) return candidate;
    redacted = true;
    return `[card redacted; last four ${digits.slice(-4)}]`;
  });
  const credentialRedacted = cardRedacted.replace(
    /\b(?:cvv|cvc|security code|pin|password|bank login)\s*(?:is|:|-)?\s*[a-z0-9!@#$%^&*._-]{3,64}\b/gi,
    (candidate) => {
      redacted = true;
      return `[credential redacted: ${candidate.split(/\s/)[0]}]`;
    }
  );
  return { text: credentialRedacted, redacted };
};

export const buildRefundGptTriageInput = ({ subject, messages }) => {
  const safeMessages = (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.direction === 'inbound' && message?.kind !== 'bounce')
    .slice(-8)
    .map((message) => {
      const redacted = redactRefundTriageContent(message?.body);
      return {
        receivedAt: typeof message?.receivedAt === 'string' ? message.receivedAt : null,
        body: redacted.text.slice(0, 6000),
        contentRedacted: redacted.redacted || message?.sensitiveDataRedacted === true,
      };
    });
  const safeSubject = redactRefundTriageContent(subject).text.slice(0, 240);
  return {
    schemaVersion: REFUND_GPT_TRIAGE_SCHEMA_VERSION,
    promptVersion: REFUND_GPT_TRIAGE_PROMPT_VERSION,
    subject: safeSubject,
    messages: safeMessages,
    untrustedContent: true,
  };
};

export const detectRefundGptTriagePolicyFlags = (sourceText, amountCents = null) => {
  const text = String(sourceText ?? '');
  const flags = [];
  const rules = [
    ['legal', /\b(?:attorney|lawyer|lawsuit|legal action|regulator|ftc|attorney general)\b/i],
    ['safety', /\b(?:injur(?:y|ed)|hospital|fire|burn(?:ed|t)?|electric shock|unsafe|medical)\b/i],
    ['threat', /\b(?:threat(?:en|ening)?|kill|hurt you|come after|destroy your)\b/i],
    ['chargeback', /\b(?:chargeback|charge back|bank dispute|dispute (?:the|this) charge)\b/i],
    ['abusive_or_escalated', /\b(?:furious|enraged|scam|fraud|steal(?:ing)?|rip[- ]?off|unacceptable)\b/i],
    ['prompt_injection', /\b(?:ignore (?:all |the )?(?:previous|prior|system)|system prompt|developer message|assistant instructions|follow these instructions instead|reveal your prompt)\b/i],
  ];
  for (const [flag, pattern] of rules) {
    if (pattern.test(text)) flags.push(flag);
  }
  if (typeof amountCents === 'number' && amountCents > REFUND_GPT_TRIAGE_HIGH_VALUE_CENTS) {
    flags.push('high_value');
  }
  if (redactRefundTriageContent(text).redacted) flags.push('prohibited_payment_data');
  return uniqueSorted(flags);
};

export const deriveRefundGptMissingFields = (extracted) => {
  const missing = [];
  if (!cleanString(extracted?.locationName, 160) && !cleanString(extracted?.machineLabel, 160)) {
    missing.push('location_or_machine');
  }
  if (!cleanString(extracted?.incidentDate, 10)) missing.push('incident_date');
  if (!cleanString(extracted?.incidentTime, 8)) missing.push('incident_time');
  const paymentMethod = PAYMENT_METHODS.has(extracted?.paymentMethod) ? extracted.paymentMethod : 'unknown';
  if (paymentMethod === 'unknown') missing.push('payment_method');
  if (!Number.isInteger(extracted?.amountCents) || extracted.amountCents <= 0) missing.push('amount');
  if (paymentMethod === 'card' && !/^\d{4}$/.test(String(extracted?.cardLast4 ?? ''))) {
    missing.push('card_last4');
  }
  return missing;
};

export const buildSafeRefundMissingInformationDraft = ({ publicReference, missingFields }) => {
  const normalizedFields = REFUND_GPT_TRIAGE_MISSING_FIELDS.filter((field) => missingFields?.includes(field));
  const items = normalizedFields.map((field) => `- ${FIELD_LABELS[field]}`);
  const reference = cleanString(publicReference, 40);
  return {
    subject: reference
      ? `A quick detail check for your Bloomjoy refund request ${reference}`
      : 'A quick detail check for your Bloomjoy refund request',
    body: [
      'Thank you for reaching out. We want to review this carefully and need a few details before we can look for the transaction:',
      '',
      ...items,
      '',
      'Never send a full card number, expiration date, CVV, PIN, password, bank login, or account number.',
      '',
      'Once we have those details, a person on our team will continue the review.',
    ].join('\n'),
  };
};

export const detectRefundDraftRequestIntents = (body) =>
  REFUND_GPT_TRIAGE_MISSING_FIELDS.filter((field) =>
    REQUEST_INTENTS[field].some((pattern) => pattern.test(String(body ?? '')))
  );

const draftContainsUnsafeRequest = (body) =>
  /\b(?:full card|entire card|card number|expiration date|expiry date|cvv|cvc|security code|\bpin\b|password|bank login|account number|routing number)\b/i.test(body)
  && !/\b(?:never|do not|don't|please do not)\b[^.\n]{0,80}\b(?:full card|card number|expiration date|cvv|cvc|pin|password|bank login|account number|routing number)\b/i.test(body);

const draftContainsDecisionLanguage = (body) =>
  /\b(?:approved your refund|refund (?:has been|was|is) (?:sent|issued|processed|completed)|we will refund|you are eligible|transaction matched)\b/i.test(body);

const draftContainsUnnecessarySensitiveRequest = (body) =>
  /\b(?:photo id|driver'?s licen[cs]e|passport|social security|ssn|date of birth|home address|bank statement)\b/i.test(body);

export const validateRefundGptReviewedDraft = ({ subject, body, missingFields }) => {
  const errors = [];
  const normalizedSubject = typeof subject === 'string' ? subject.trim() : '';
  const normalizedBody = typeof body === 'string' ? body.trim() : '';
  const combined = `${normalizedSubject}\n${normalizedBody}`;
  const normalizedMissing = Array.isArray(missingFields)
    ? uniqueSorted(missingFields.filter((field) => MISSING_FIELD_SET.has(field)))
    : [];

  if (normalizedSubject.length < 1 || normalizedSubject.length > 180) errors.push('Draft subject is invalid.');
  if (normalizedBody.length < 1 || normalizedBody.length > 4000) errors.push('Draft body is invalid.');
  if (draftContainsUnsafeRequest(combined)) errors.push('Draft requests prohibited payment or credential data.');
  if (draftContainsUnnecessarySensitiveRequest(combined)) errors.push('Draft requests unnecessary identity data.');
  if (draftContainsDecisionLanguage(combined)) errors.push('Draft makes a refund decision or payment claim.');
  const requested = detectRefundDraftRequestIntents(normalizedBody);
  if (requested.some((field) => !normalizedMissing.includes(field))) {
    errors.push('Draft requests information that is not missing.');
  }

  return { ok: errors.length === 0, errors, requestedFields: requested };
};

export const validateRefundGptTriageSuggestion = (candidate, { sourceText = '' } = {}) => {
  const errors = [];
  if (!exactKeys(candidate, TOP_LEVEL_KEYS)) {
    return { ok: false, errors: ['Output must contain exactly the approved top-level fields.'] };
  }
  if (candidate.schemaVersion !== REFUND_GPT_TRIAGE_SCHEMA_VERSION) errors.push('Schema version is invalid.');
  if (!CLASSIFICATIONS.has(candidate.classification)) errors.push('Classification is invalid.');
  if (!CONFIDENCE_BANDS.has(candidate.confidenceBand)) errors.push('Confidence band is invalid.');
  if (!ROUTES.has(candidate.route)) errors.push('Route is invalid.');
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(candidate.language)) errors.push('Language tag is invalid.');
  if (typeof candidate.summary !== 'string' || candidate.summary.trim().length < 1 || candidate.summary.length > 600) {
    errors.push('Summary is required and must be 600 characters or fewer.');
  }
  if (!exactKeys(candidate.extracted, EXTRACTED_KEYS)) {
    errors.push('Extracted fields must contain exactly the approved schema.');
  } else {
    const extracted = candidate.extracted;
    if (!nullableStringValid(extracted.locationName, 160)) errors.push('Location is invalid.');
    if (!nullableStringValid(extracted.machineLabel, 160)) errors.push('Machine label is invalid.');
    if (extracted.incidentDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(extracted.incidentDate)) errors.push('Incident date is invalid.');
    if (extracted.incidentTime !== null && !/^\d{2}:\d{2}$/.test(extracted.incidentTime)) errors.push('Incident time is invalid.');
    if (!PAYMENT_METHODS.has(extracted.paymentMethod)) errors.push('Payment method is invalid.');
    if (extracted.amountCents !== null && (!Number.isInteger(extracted.amountCents) || extracted.amountCents < 1 || extracted.amountCents > 100000)) {
      errors.push('Amount is invalid.');
    }
    if (extracted.cardLast4 !== null && !/^\d{4}$/.test(extracted.cardLast4)) errors.push('Card last four is invalid.');
    if (extracted.walletUsed !== null && typeof extracted.walletUsed !== 'boolean') errors.push('Wallet indicator is invalid.');
  }
  if (!Array.isArray(candidate.missingFields) || candidate.missingFields.some((field) => !MISSING_FIELD_SET.has(field))) {
    errors.push('Missing fields contain an unsupported value.');
  }
  if (!Array.isArray(candidate.policyFlags) || candidate.policyFlags.some((flag) => !POLICY_FLAG_SET.has(flag))) {
    errors.push('Policy flags contain an unsupported value.');
  }

  if (exactKeys(candidate.extracted, EXTRACTED_KEYS) && Array.isArray(candidate.missingFields)) {
    const expectedMissing = uniqueSorted(deriveRefundGptMissingFields(candidate.extracted));
    const actualMissing = uniqueSorted(candidate.missingFields);
    if (JSON.stringify(expectedMissing) !== JSON.stringify(actualMissing)) {
      errors.push('Missing fields do not match the extracted facts.');
    }
  }

  const deterministicFlags = detectRefundGptTriagePolicyFlags(sourceText, candidate.extracted?.amountCents);
  if (candidate.extracted?.walletUsed === true) deterministicFlags.push('wallet_payment');
  const providedFlags = Array.isArray(candidate.policyFlags) ? uniqueSorted(candidate.policyFlags) : [];
  if (deterministicFlags.some((flag) => !providedFlags.includes(flag))) {
    errors.push('A deterministic safety flag is missing.');
  }
  const restricted = providedFlags.length > 0;
  const mustUseHumanReview =
    restricted ||
    candidate.classification !== 'refund' ||
    candidate.confidenceBand === 'low' ||
    candidate.language !== 'en';
  if (mustUseHumanReview && candidate.route !== 'human_review') {
    errors.push('Policy-sensitive, uncertain, low-confidence, or non-English content requires human review.');
  }
  if (mustUseHumanReview && candidate.draft !== null) {
    errors.push('Human-review output cannot include a suggested customer reply.');
  }

  if (candidate.route === 'draft_reply') {
    if (candidate.classification !== 'refund' || !['high', 'medium'].includes(candidate.confidenceBand)) {
      errors.push('A draft reply requires a high- or medium-confidence refund classification.');
    }
    if (!Array.isArray(candidate.missingFields) || candidate.missingFields.length === 0) {
      errors.push('A draft reply is allowed only when required purchase information is missing.');
    }
    if (!exactKeys(candidate.draft, DRAFT_KEYS)) {
      errors.push('Draft must contain exactly subject and body.');
    } else {
      const draftValidation = validateRefundGptReviewedDraft({
        subject: candidate.draft.subject,
        body: candidate.draft.body,
        missingFields: candidate.missingFields,
      });
      errors.push(...draftValidation.errors);
      if (
        Array.isArray(candidate.missingFields) &&
        JSON.stringify(uniqueSorted(draftValidation.requestedFields)) !==
          JSON.stringify(uniqueSorted(candidate.missingFields))
      ) {
        errors.push('Draft must ask for every missing field and no others.');
      }
    }
  } else if (candidate.draft !== null) {
    errors.push('Human-review output cannot include a draft.');
  }

  return {
    ok: errors.length === 0,
    errors,
    value: errors.length === 0 ? candidate : null,
  };
};
