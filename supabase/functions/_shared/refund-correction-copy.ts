import { correctionLabels, type CorrectionField } from './refund-correction.ts';

// Shared by the delivered email and manager preview; contains no capability.
export function refundCorrectionCopy(fields: CorrectionField[], reference: string, spanish: boolean) {
  const subject = spanish ? `Actualice su solicitud de reembolso de Bloomjoy ${reference}` : `Update your Bloomjoy refund request ${reference}`;
  const requested = fields.map((field) => correctionLabels[field][0]).join(', ');
  const english = [
    `Please check these details for your existing refund request: ${requested}.`,
    'Use the button below to update a detail, confirm it is correct, or tell us you are not sure. Your other details are already saved, and you do not need to start another request.',
    'We will review your response and recheck the purchase when needed. Updating details does not approve or complete a refund.',
  ];
  const paragraphs = spanish ? [
    `Revise estos datos de su solicitud de reembolso actual: ${fields.map((field) => correctionLabels[field][1]).join(', ')}.`,
    'Use el botón para corregir un dato, confirmar que es correcto o indicar que no está seguro. Sus otros datos ya están guardados; no necesita crear otra solicitud.',
    'Revisaremos su respuesta y la compra cuando sea necesario. Actualizar datos no aprueba ni completa un reembolso.',
    'English', ...english,
  ] : english;
  return { subject, paragraphs };
}
