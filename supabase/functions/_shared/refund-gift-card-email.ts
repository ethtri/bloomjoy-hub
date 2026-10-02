export type RefundGiftCardEmailInput = {
  customerName?: string | null;
  /** Integer cents. The caller must use the assigned card's server-authorized value. */
  value: number;
  currency: string;
  code: string;
  expiresAt: string;
  eligibleLocations: string[];
  redemptionInstructions: string;
  customerLocale?: string | null;
};

const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export const renderRefundGiftCardEmail = (input: RefundGiftCardEmailInput) => {
  if (!Number.isSafeInteger(input.value) || input.value <= 0 || !/^[A-Z]{3}$/.test(input.currency) ||
      !input.code.trim() || !Number.isFinite(Date.parse(input.expiresAt)) ||
      !input.eligibleLocations.length || !input.eligibleLocations.every((item) => item.trim()) ||
      !input.redemptionInstructions.trim()) throw new Error('Gift card email requires the assigned card and complete redemption terms.');
  const locale = input.customerLocale === 'es' ? 'es-US' : 'en-US';
  const amount = new Intl.NumberFormat(locale, { style: 'currency', currency: input.currency }).format(input.value / 100);
  const expiry = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(new Date(input.expiresAt));
  const bilingual = (spanish: string, english: string) => input.customerLocale === 'es' ? `${spanish}\n\n${english}` : english;
  const display = (value: string) => escapeHtml(value).replaceAll('\n', '<br>');
  const greeting = bilingual(input.customerName?.trim() ? `Hola ${input.customerName.trim()},` : 'Hola,', input.customerName?.trim() ? `Hi ${input.customerName.trim()},` : 'Hi there,');
  const acknowledgement = bilingual('Lamentamos que tu visita no saliera como esperabas. Aquí tienes un detalle dulce para la próxima.', 'We’re sorry your visit didn’t go as planned. Here’s a little sweetness for your next one.');
  const locations = bilingual(`Úsala en ${input.eligibleLocations.join(', ')}.`, `Use at ${input.eligibleLocations.join(', ')}.`);
  const terms = bilingual(`Vence ${expiry}. Un solo uso; el valor que no uses no queda como saldo.`, `Expires ${expiry}. One use only; any unused value is not kept as a balance.`);
  const reply = bilingual('¿Necesitas ayuda para usar tu tarjeta? Responde a este correo y te ayudaremos con la misma solicitud.', 'Need a hand using your gift card? Reply to this email and we’ll help with this same request.');
  const redemptionTranslations: Record<string, string> = {
    'On the machine’s touchscreen, choose ‘Enter coupon/code’ and enter your code.': 'En la pantalla táctil de la máquina, elige “Enter coupon/code” e introduce tu código.',
    'Enter your code on the gift card screen at the machine.': 'Introduce tu código en la pantalla de tarjeta regalo de la máquina.',
  };
  const instructions = redemptionTranslations[input.redemptionInstructions]
    ? bilingual(redemptionTranslations[input.redemptionInstructions], input.redemptionInstructions)
    : input.redemptionInstructions;
  const signoff = bilingual('Con cariño,\nEl equipo de Bloomjoy Sweets', 'Warmly,\nThe Bloomjoy Sweets Team');
  const subject = input.customerLocale === 'es' ? `Tu tarjeta regalo Bloomjoy de ${amount} / Your Bloomjoy gift card` : `A little sweetness for you: your ${amount} Bloomjoy gift card`;
  const text = [greeting, acknowledgement, bilingual(`Tarjeta regalo Bloomjoy de ${amount}`, `${amount} Bloomjoy gift card`), bilingual(`Tu código: ${input.code}`, `Your code: ${input.code}`),
    instructions, locations, terms, reply, signoff].join('\n\n');
  const html = `<!doctype html><html lang="${input.customerLocale === 'es' ? 'es' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#fbf4ec;color:#382b35;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your ${escapeHtml(amount)} gift card and everything you need for your next Bloomjoy visit.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fbf4ec;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:580px;background:#fffdfa;border:1px solid #ead7d1;border-radius:20px;">
<tr><td style="padding:16px 24px;background:#b83d64;color:#fff8f1;border-radius:20px 20px 0 0;font:700 13px/20px 'Trebuchet MS',Verdana,sans-serif;letter-spacing:1px;">BLOOMJOY SWEETS</td></tr>
<tr><td style="padding:28px 24px;font:15px/24px 'Trebuchet MS',Verdana,sans-serif;">
<h1 style="margin:0 0 22px;font:700 30px/38px Georgia,serif;color:#4d2738;">${display(bilingual('Un detalle dulce para ti', 'A little sweetness for you'))}</h1>
<p style="margin:0 0 12px;">${display(greeting)}</p><p style="margin:0 0 24px;">${display(acknowledgement)}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff3ef;border:1px solid #efd9d3;border-radius:14px;"><tr><td align="center" style="padding:24px 12px;">
<p style="margin:0;color:#9b3155;font-size:13px;">${display(bilingual('TU TARJETA REGALO BLOOMJOY', 'YOUR BLOOMJOY GIFT CARD'))}</p>
<p style="margin:10px 0;font:700 38px/44px Georgia,serif;color:#4d2738;">${escapeHtml(amount)}</p>
<p style="margin:0 0 8px;font-size:13px;">${display(bilingual('Tu código de un solo uso', 'Your one-use code'))}</p>
<p style="margin:0;font:700 25px/34px Consolas,monospace;overflow-wrap:anywhere;word-break:break-word;color:#4d2738;">${escapeHtml(input.code)}</p>
</td></tr></table>
<h2 style="margin:24px 0 8px;font-size:18px;line-height:26px;color:#4d2738;">${display(bilingual('Lista para tu próxima visita', 'Ready for your next visit'))}</h2>
<p style="margin:0 0 16px;">${display(instructions)}</p>
<p style="margin:0 0 8px;">${display(locations)}</p><p style="margin:0 0 24px;font-size:13px;line-height:21px;color:#684f61;">${display(terms)}</p>
<p style="margin:0 0 22px;">${display(reply)}</p><p style="margin:0;color:#684f61;">${display(signoff)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
};
