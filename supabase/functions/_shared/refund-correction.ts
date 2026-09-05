// Shared customer-field contract. Provider, recipient, approval and payout
// execution fields are deliberately absent.
export const correctionFields = [
  'location_or_machine', 'incident_date', 'incident_time', 'payment_method',
  'payment_interaction', 'wallet_provider', 'amount', 'card_last4', 'card_network',
  'card_last4_source', 'wallet_device_kind', 'incident_time_source', 'nearby_attempt_count',
  'zelle_payment_contact',
] as const;
export type CorrectionField = typeof correctionFields[number];
export type CorrectionAnswer = { disposition: 'changed' | 'confirmed' | 'cannot_provide'; value?: string; confidence?: 'exact' | 'within_15_minutes' | 'within_1_hour' | 'rough' };
export type CorrectionAnswers = Partial<Record<CorrectionField, CorrectionAnswer>>;
export type CorrectionContext = {
  state: 'ready' | 'received' | 'unavailable';
  publicReference?: string;
  version?: number;
  locale?: 'en' | 'es';
  requestedFields?: CorrectionField[];
  allowedFields?: CorrectionField[];
  values?: Partial<Record<CorrectionField, string>>;
  timezone?: string;
  incidentTimeConfidence?: CorrectionAnswer['confidence'];
  expiresAt?: string;
  nextAction?: 'review' | 'recheck';
  locationChoices?: Array<{ key: string; label: string }>;
};

export function correctionRefreshInterval(current: CorrectionContext | undefined, received: CorrectionContext | null, fetchFailureCount: number): number | false {
  if (current?.state === 'unavailable') return false;
  const saved = current?.state === 'received' ? current : received;
  return saved?.nextAction === 'recheck' ? Math.min(30000, 5000 * 2 ** Math.min(fetchFailureCount, 3)) : false;
}

export const isCorrectionToken = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value);
export const hashCorrectionToken = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`refund-correction-v1:${value}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const correctionLabels: Record<CorrectionField, [string, string]> = {
  location_or_machine: ['Machine or location', 'Máquina o ubicación'],
  incident_date: ['Purchase date', 'Fecha de compra'],
  incident_time: ['Approximate purchase time', 'Hora aproximada de compra'],
  payment_method: ['Payment method', 'Método de pago'],
  payment_interaction: ['How you paid', 'Cómo pagó'],
  card_last4_source: ['Where the last four came from', 'De dónde salieron los últimos cuatro'],
  wallet_provider: ['Mobile wallet', 'Billetera digital'],
  wallet_device_kind: ['Wallet device', 'Dispositivo de la billetera'],
  incident_time_source: ['How you found the time', 'Cómo encontró la hora'],
  nearby_attempt_count: ['Nearby attempts or charges', 'Intentos o cargos cercanos'],
  amount: ['Amount charged (USD)', 'Monto cobrado (USD)'],
  card_last4: ['Card last four digits', 'Últimos cuatro dígitos de la tarjeta'],
  card_network: ['Card type', 'Tipo de tarjeta'],
  zelle_payment_contact: ['Zelle email or phone', 'Correo o teléfono de Zelle'],
};
export const correctionChoices: Partial<Record<CorrectionField, Array<[string, string, string]>>> = {
  payment_method: [['card', 'Card or mobile wallet', 'Tarjeta o billetera digital'], ['cash', 'Cash', 'Efectivo']],
  payment_interaction: [['tap_card', 'Tapped a physical card', 'Acerqué la tarjeta física'], ['insert_card', 'Inserted a physical card', 'Inserté la tarjeta física'], ['swipe_card', 'Swiped a physical card', 'Deslicé la tarjeta física'], ['insert_or_swipe', 'Inserted or swiped a card (not sure which)', 'Inserté o deslicé la tarjeta (no sé cuál)'], ['phone_watch_wallet', 'Phone or watch wallet', 'Billetera del teléfono o reloj'], ['cash', 'Cash', 'Efectivo']],
  card_last4_source: [['physical_card', 'Physical card', 'Tarjeta física'], ['wallet_device', 'Card shown for the wallet or device', 'Tarjeta mostrada para la billetera o dispositivo'], ['bank_record', 'Bank record or purchase alert', 'Registro bancario o alerta de compra'], ['unknown', 'Not sure', 'No sé']],
  wallet_provider: [['apple_pay', 'Apple Pay', 'Apple Pay'], ['google_wallet', 'Google Wallet', 'Google Wallet'], ['other', 'Another wallet', 'Otra billetera']],
  wallet_device_kind: [['phone', 'Phone', 'Teléfono'], ['watch', 'Watch', 'Reloj'], ['unknown', 'Not sure', 'No sé']],
  incident_time_source: [['transaction_alert_or_receipt', 'Purchase alert or receipt', 'Alerta de compra o recibo'], ['memory', 'From memory', 'De memoria'], ['unknown', 'Not sure', 'No sé']],
  nearby_attempt_count: [['one', 'One attempt or charge', 'Un intento o cargo'], ['multiple', 'More than one attempt or charge', 'Más de un intento o cargo'], ['unknown', 'Not sure', 'No sé']],
  card_network: [['visa', 'Visa', 'Visa'], ['mastercard', 'Mastercard', 'Mastercard'], ['discover', 'Discover', 'Discover'], ['american_express', 'American Express', 'American Express'], ['other_unknown', 'Other / not sure', 'Otro / no sé']],
};

export function updateCorrectionAnswer(prior: CorrectionAnswers, field: CorrectionField, answer: CorrectionAnswer, context: CorrectionContext): CorrectionAnswers {
  const next = { ...prior, [field]: answer };
  const value = (answers: CorrectionAnswers) => answers[field]?.disposition === 'changed' ? answers[field]?.value : context.values?.[field];
  if ((field === 'payment_method' || field === 'payment_interaction') && value(prior) !== value(next)) {
    for (const dependent of ['card_last4','card_last4_source','wallet_provider','wallet_device_kind','card_network'] as const) delete next[dependent];
    if (field === 'payment_method') delete next.payment_interaction;
  }
  return next;
}

export function requiredCorrectionFields(answers: CorrectionAnswers, context: CorrectionContext): CorrectionField[] {
  const required = new Set(context.requestedFields ?? []);
  const changed = (field: CorrectionField) => answers[field]?.disposition === 'changed' && answers[field]?.value !== context.values?.[field];
  const value = (field: CorrectionField) => answers[field]?.disposition === 'changed' ? answers[field]?.value : context.values?.[field];
  if (changed('location_or_machine') && value('location_or_machine')) {
    for (const field of ['incident_date', 'incident_time'] as const) {
      if (context.allowedFields?.includes(field)) required.add(field);
    }
  }
  if (value('payment_method') === 'cash') {
    for (const field of ['payment_interaction','card_last4','card_last4_source','card_network','wallet_provider','wallet_device_kind'] as const) required.delete(field);
  } else if (changed('payment_interaction') && ['tap_card','insert_card','swipe_card','insert_or_swipe'].includes(value('payment_interaction') ?? '')) {
    required.delete('wallet_provider');
    required.delete('wallet_device_kind');
  }
  if (changed('payment_method') && value('payment_method') === 'card') required.add('payment_interaction');
  if ((changed('payment_method') || changed('payment_interaction')) && value('payment_method') === 'card') {
    required.add('card_last4');
    required.add('card_last4_source');
    if (value('payment_interaction') === 'phone_watch_wallet') {
      required.add('wallet_provider');
      required.add('wallet_device_kind');
    }
  }
  if (changed('card_last4') && value('payment_method') === 'card' && context.allowedFields?.includes('card_last4_source')) required.add('card_last4_source');
  if (changed('incident_time') && context.allowedFields?.includes('incident_time_source')) required.add('incident_time_source');
  return [...required];
}

export function validateCorrectionAnswers(input: unknown, context: CorrectionContext): CorrectionAnswers {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_response');
  const answers = input as Record<string, unknown>;
  const allowed = context.allowedFields ?? [];
  const values = context.values ?? {};
  for (const field of requiredCorrectionFields(answers as CorrectionAnswers, context)) {
    if (!Object.hasOwn(answers, field)) throw new Error(`missing:${field}`);
  }
  const result: CorrectionAnswers = {};
  for (const [key, raw] of Object.entries(answers)) {
    const field = key as CorrectionField;
    if (!allowed.includes(field) || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('unsupported_field');
    const answer = raw as CorrectionAnswer;
    if (Object.keys(answer).some((key) => !['disposition', 'value', 'confidence'].includes(key)) ||
        !['changed', 'confirmed', 'cannot_provide'].includes(answer.disposition)) throw new Error('invalid_response');
    if (answer.confidence !== undefined && (field !== 'incident_time' || !['changed','confirmed'].includes(answer.disposition) ||
      !['exact','within_15_minutes','within_1_hour','rough'].includes(answer.confidence))) throw new Error('invalid_time_confidence');
    if (answer.disposition !== 'changed') {
      if (answer.value !== undefined || (answer.disposition === 'confirmed' && !values[field])) throw new Error(`invalid:${field}`);
      if (field === 'incident_time' && answer.disposition === 'confirmed' && !answer.confidence) throw new Error('time_confidence_required');
      result[field] = field === 'incident_time' && answer.disposition === 'confirmed'
        ? { disposition: 'confirmed', confidence: answer.confidence }
        : { disposition: answer.disposition };
      continue;
    }
    if (typeof answer.value !== 'string' || !answer.value.trim() || answer.value.length > (field === 'zelle_payment_contact' ? 320 : 160)) throw new Error(`invalid:${field}`);
    let value = answer.value.trim();
    if (field === 'amount') {
      value = value.replace(/^\$\s*/, '').replace(',', '.');
      if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(value) || Number(value) <= 0) throw new Error(`invalid:${field}`);
      value = Number(value).toFixed(2);
    }
    if (field === 'card_last4' && !/^\d{4}$/.test(value)) throw new Error(`invalid:${field}`);
    if (field === 'incident_date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) throw new Error(`invalid:${field}`);
    if (field === 'incident_time' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`invalid:${field}`);
    if (field === 'incident_time' && !answer.confidence) throw new Error('time_confidence_required');
    if (field === 'location_or_machine' && !context.locationChoices?.some((choice) => choice.key === value)) throw new Error('invalid_location');
    if (correctionChoices[field] && !correctionChoices[field]!.some(([key]) => key === value)) throw new Error(`invalid:${field}`);
    if (field === 'zelle_payment_contact' && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) && !/^\+?\d{10,15}$/.test(value.replace(/[\s().-]/g,''))) throw new Error(`invalid:${field}`);
    result[field] = field === 'incident_time' ? { disposition: 'changed', value, confidence: answer.confidence }
      : value === values[field] ? { disposition: 'confirmed' } : { disposition: 'changed', value };
  }
  return result;
}
