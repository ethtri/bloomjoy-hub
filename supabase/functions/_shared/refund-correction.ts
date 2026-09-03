// Shared customer-field contract. Provider, recipient, approval and payout
// execution fields are deliberately absent.
export const correctionFields = [
  'location_or_machine', 'incident_date', 'incident_time', 'payment_method',
  'payment_interaction', 'wallet_provider', 'amount', 'card_last4', 'card_network',
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
  expiresAt?: string;
  nextAction?: 'review' | 'recheck';
  locationChoices?: Array<{ key: string; label: string }>;
};

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
  wallet_provider: ['Mobile wallet', 'Billetera digital'],
  amount: ['Amount charged (USD)', 'Monto cobrado (USD)'],
  card_last4: ['Card last four digits', 'Últimos cuatro dígitos de la tarjeta'],
  card_network: ['Card type', 'Tipo de tarjeta'],
  zelle_payment_contact: ['Zelle email or phone', 'Correo o teléfono de Zelle'],
};
export const correctionChoices: Partial<Record<CorrectionField, Array<[string, string, string]>>> = {
  payment_method: [['card', 'Card or mobile wallet', 'Tarjeta o billetera digital'], ['cash', 'Cash', 'Efectivo']],
  payment_interaction: [['tap_card', 'Tapped a physical card', 'Acerqué la tarjeta física'], ['insert_or_swipe', 'Inserted or swiped a card', 'Inserté o deslicé la tarjeta'], ['phone_watch_wallet', 'Phone or watch wallet', 'Billetera del teléfono o reloj'], ['cash', 'Cash', 'Efectivo']],
  wallet_provider: [['apple_pay', 'Apple Pay', 'Apple Pay'], ['google_wallet', 'Google Wallet', 'Google Wallet'], ['other', 'Another wallet', 'Otra billetera']],
  card_network: [['visa', 'Visa', 'Visa'], ['mastercard', 'Mastercard', 'Mastercard'], ['discover', 'Discover', 'Discover'], ['american_express', 'American Express', 'American Express'], ['other_unknown', 'Other / not sure', 'Otro / no sé']],
};

export function requiredCorrectionFields(answers: CorrectionAnswers, context: CorrectionContext): CorrectionField[] {
  const required = new Set(context.requestedFields ?? []);
  const changed = (field: CorrectionField) => answers[field]?.disposition === 'changed' && answers[field]?.value !== context.values?.[field];
  const value = (field: CorrectionField) => answers[field]?.disposition === 'changed' ? answers[field]?.value : context.values?.[field];
  if (changed('payment_method') && value('payment_method') === 'card') required.add('payment_interaction');
  if ((changed('payment_method') || changed('payment_interaction')) && value('payment_method') === 'card') {
    required.add('card_last4');
    if (value('payment_interaction') === 'phone_watch_wallet') required.add('wallet_provider');
  }
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
    if (answer.confidence !== undefined && (field !== 'incident_time' || answer.disposition !== 'changed' ||
      !['exact','within_15_minutes','within_1_hour','rough'].includes(answer.confidence))) throw new Error('invalid_time_confidence');
    if (answer.disposition !== 'changed') {
      if (answer.value !== undefined || (answer.disposition === 'confirmed' && !values[field])) throw new Error(`invalid:${field}`);
      result[field] = { disposition: answer.disposition };
      continue;
    }
    if (typeof answer.value !== 'string' || !answer.value.trim() || answer.value.length > 160) throw new Error(`invalid:${field}`);
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
    if (field === 'zelle_payment_contact' && !/^(?:[^\s@]+@[^\s@]+\.[^\s@]+|\+?[\d ()-]{10,24})$/.test(value)) throw new Error(`invalid:${field}`);
    result[field] = field === 'incident_time' ? { disposition: 'changed', value, confidence: answer.confidence }
      : value === values[field] ? { disposition: 'confirmed' } : { disposition: 'changed', value };
  }
  return result;
}
