import type { RefundCustomerLifecycle, RefundCustomerStatusCopy } from './refundCustomerStatus';

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
    detail = unknownDate ? 'Nayax confirma que se completó el reembolso aprobado. No está disponible la fecha exacta de procesamiento.' : 'Nayax aprobó su reembolso. Su banco puede tardar hasta 4 días hábiles en reflejarlo en su cuenta.';
    const message = lifecycle.messageState.state;
    detail += message === 'delivered' ? ' Se confirmó la entrega del correo con la actualización.'
      : ['sent', 'accepted'].includes(message) ? ' Se envió el correo con la actualización; aún no se confirmó su entrega.'
      : ['queued', 'claimed', 'pending'].includes(message) ? ' Estamos enviando el correo con la actualización.'
      : ' Nuestro equipo está revisando el envío del correo con la actualización.';
    nextExpectation = unknownDate ? 'No necesita una nueva solicitud. Responda al correo de Bloomjoy si el abono no aparece.' : 'Si el abono no aparece después de 4 días hábiles, responda al correo de Bloomjoy para recibir ayuda.';
  } else if (stage === 'denied') {
    title = 'Revisión terminada'; detail = 'No pudimos aprobar esta solicitud de reembolso.';
    nextExpectation = 'Responda al correo de Bloomjoy si omitimos o entendimos mal algún dato. Mantendremos la misma solicitud para revisarla.';
  } else if (stage === 'unable_to_complete') {
    title = 'No pudimos completar el reembolso'; detail = 'Se revisó la solicitud, pero Bloomjoy no pudo completar un pago con la información disponible.';
    nextExpectation = 'Responda al correo existente de Bloomjoy si tiene información nueva. No envíe otro formulario.';
  }
  return { ...english, title, detail, nextExpectation };
}
