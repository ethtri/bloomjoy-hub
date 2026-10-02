import type { RefundCustomerLifecycle, RefundCustomerStatusCopy } from './refundCustomerStatus.ts';
import { getRefundCompletionContactPresentation } from './refundCompletionContact.ts';

const spanishCompletionContactDetails: Record<string, string> = {
  'The refund is confirmed, but no customer completion update is recorded.': 'El reembolso está confirmado, pero aún no consta un correo con la actualización final.',
  'The refund is confirmed and its saved customer update is queued or sending.': 'El reembolso está confirmado y el correo con la actualización está en cola o enviándose.',
  'The email provider accepted the saved customer update. Inbox delivery is not confirmed.': 'El proveedor de correo aceptó la actualización. Aún no se ha confirmado la entrega en su bandeja de entrada.',
  'A provider callback confirms delivery of the saved customer update.': 'El proveedor confirmó la entrega del correo con la actualización.',
  'The saved customer update has a definite send failure.': 'No se pudo enviar el correo con la actualización.',
  'The saved customer update may have reached the provider, but its send outcome is not confirmed.': 'Es posible que la actualización haya llegado al proveedor, pero aún no se ha confirmado el resultado del envío.',
  'The email provider reported that the saved customer update bounced.': 'El proveedor informó que el correo con la actualización fue devuelto.',
  'The email provider reported a complaint for the saved customer update.': 'El proveedor informó de una queja sobre el correo con la actualización.',
};

export function spanishRefundStatusCopy(lifecycle: RefundCustomerLifecycle, english: RefundCustomerStatusCopy): RefundCustomerStatusCopy {
  const stage = lifecycle.stage;
  let title = 'Solicitud recibida';
  let detail = 'Recibimos su solicitud de reembolso y estamos revisando los datos de compra.';
  let nextExpectation = 'Compararemos sus datos con los registros de pago de la máquina. No necesita otro formulario.';
  if (stage === 'waiting_on_customer') {
    const zelle = lifecycle.customerAction.requestedFields.includes('zelle_payment_contact');
    title = zelle ? 'Esperando sus datos de pago' : 'Esperando su respuesta';
    detail = zelle ? 'Necesitamos el correo electrónico o teléfono asociado a Zelle para su reembolso aprobado.' : 'Necesitamos un dato más de la compra para identificar su transacción.';
    nextExpectation = zelle ? 'Responda al correo existente de Bloomjoy solo con ese dato de Zelle. No necesita otro formulario.' : 'Responda al correo existente de Bloomjoy. No necesita otro formulario.';
  } else if (stage === 'needs_transaction_selection' || stage === 'transaction_confirmed') {
    title = 'Revisando su compra'; detail = 'Estamos comparando su solicitud con los registros de pago de la máquina.';
    nextExpectation = 'Un gerente de Bloomjoy revisará la compra encontrada. No necesita hacer nada.';
  } else if (stage === 'awaiting_payout') {
    const missing = lifecycle.reasonCode === 'payout_destination_missing';
    title = missing ? 'Esperando los datos de pago' : 'Preparando su reembolso';
    detail = missing ? 'Necesitamos un destino de pago aprobado antes de enviar el reembolso.' : 'Un gerente de Bloomjoy está preparando el reembolso aprobado.';
    nextExpectation = missing ? 'Responda al correo existente de Bloomjoy. No necesita otro formulario.' : 'No necesita hacer nada.';
  } else if (stage === 'refund_initiated') {
    title = 'Reembolso iniciado'; detail = 'Bloomjoy envió la solicitud de reembolso de la compra confirmada.';
    nextExpectation = 'Estamos confirmando el resultado. No envíe otra solicitud.';
  } else if (['confirming_with_nayax', 'needs_refund_operations', 'integrity_hold'].includes(stage)) {
    title = 'Confirmando el reembolso'; detail = 'Bloomjoy está confirmando el resultado del reembolso de forma segura.';
    nextExpectation = 'No necesita volver a intentarlo ni contactar al proveedor de pagos. Nosotros nos encargamos de la siguiente revisión.';
  } else if (stage === 'refund_confirmed' || stage === 'customer_notified') {
    title = 'Reembolso confirmado';
    const unknownDate = lifecycle.reasonCode === 'settlement_time_unknown';
    detail = unknownDate ? 'Se completó el reembolso aprobado. No está disponible la fecha exacta de procesamiento.' : 'Se completó el reembolso aprobado.';
    const contact = getRefundCompletionContactPresentation(lifecycle);
    detail += ` ${spanishCompletionContactDetails[contact.detail]}`;
    nextExpectation = 'No necesita una nueva solicitud. Responda al correo de Bloomjoy si necesita ayuda con su reembolso.';
  } else if (stage === 'denied') {
    title = 'Revisión terminada'; detail = 'No pudimos aprobar esta solicitud de reembolso.';
    nextExpectation = 'Responda al correo de Bloomjoy si omitimos o entendimos mal algún dato. Mantendremos la misma solicitud para revisarla.';
  } else if (stage === 'unable_to_complete') {
    title = 'No pudimos completar el reembolso'; detail = 'Se revisó la solicitud, pero Bloomjoy no pudo completar un pago con la información disponible.';
    nextExpectation = 'Responda al correo existente de Bloomjoy si tiene información nueva. No envíe otro formulario.';
  }
  return { ...english, title, detail, nextExpectation };
}
