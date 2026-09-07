import { correctionLabels, type CorrectionField } from './refund-correction.ts';

// A stable purpose for the exact scoped fields, not a claim that a customer
// supplied a wrong value or that a provider match has been found.
export function refundCorrectionReason(fields: readonly CorrectionField[], spanish: boolean) {
  if (fields.length === 1 && fields[0] === 'zelle_payment_contact') return spanish
    ? 'Necesitamos este correo o teléfono para enviar su reembolso de efectivo aprobado por Zelle.'
    : 'We need this email or phone number to send your approved cash reimbursement through Zelle.';
  const purchase = fields.some((field) => ['location_or_machine', 'incident_date', 'incident_time', 'incident_time_source', 'nearby_attempt_count', 'amount'].includes(field));
  const payment = fields.some((field) => ['payment_method', 'payment_interaction', 'wallet_provider', 'wallet_device_kind', 'card_last4', 'card_last4_source', 'card_network'].includes(field));
  if (purchase && payment) return spanish
    ? 'Estos datos nos ayudan a encontrar la compra correcta e identificar cómo pagó.'
    : 'These details help us find the right purchase and identify how you paid.';
  if (purchase) return spanish
    ? 'Estos datos nos ayudan a encontrar la compra correcta.'
    : 'These details help us find the right purchase.';
  if (payment) return spanish
    ? 'Estos datos nos ayudan a identificar cómo pagó la compra.'
    : 'These details help us identify how you paid for the purchase.';
  return '';
}

// Shared by the delivered email and manager preview; contains no capability.
export function refundCorrectionCopy(fields: CorrectionField[], reference: string, spanish: boolean) {
  const subject = spanish ? `Actualice su solicitud de reembolso de Bloomjoy ${reference}` : `Update your Bloomjoy refund request ${reference}`;
  const requested = fields.map((field) => correctionLabels[field][0]).join(', ');
  const english = [
    `Please check these details for your existing refund request: ${requested}.`,
    refundCorrectionReason(fields, false),
    'Use the button below to update a detail, confirm it is correct, or tell us you are not sure. Your other details are already saved, and you do not need to start another request.',
    'We will review your response and recheck the purchase when needed. Updating details does not approve or complete a refund.',
  ];
  const paragraphs = spanish ? [
    `Revise estos datos de su solicitud de reembolso actual: ${fields.map((field) => correctionLabels[field][1]).join(', ')}.`,
    refundCorrectionReason(fields, true),
    'Use el botón para corregir un dato, confirmar que es correcto o indicar que no está seguro. Sus otros datos ya están guardados; no necesita crear otra solicitud.',
    'Revisaremos su respuesta y la compra cuando sea necesario. Actualizar datos no aprueba ni completa un reembolso.',
    'English', ...english,
  ] : english;
  return { subject, paragraphs };
}
