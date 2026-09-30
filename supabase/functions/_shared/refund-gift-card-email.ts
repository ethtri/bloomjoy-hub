export type RefundGiftCardEmailInput = {
  customerName?: string | null;
  /** Integer cents. The caller must use the assigned card's server-authorized value. */
  value: number;
  currency: string;
  code: string;
  expiresAt: string;
  eligibleLocations: string[];
  redemptionInstructions: string;
};

const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export const renderRefundGiftCardEmail = (input: RefundGiftCardEmailInput) => {
  if (!Number.isSafeInteger(input.value) || input.value <= 0 || !/^[A-Z]{3}$/.test(input.currency) ||
      !input.code.trim() || !Number.isFinite(Date.parse(input.expiresAt)) ||
      !input.eligibleLocations.length || !input.eligibleLocations.every((item) => item.trim()) ||
      !input.redemptionInstructions.trim()) throw new Error('Gift card email requires the assigned card and complete redemption terms.');
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: input.currency }).format(input.value / 100);
  const expiry = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(new Date(input.expiresAt));
  const greeting = input.customerName?.trim() ? `Hi ${input.customerName.trim()},` : 'Hi there,';
  const acknowledgement = 'We’re sorry your visit didn’t go as planned. Here’s a little sweetness for your next one.';
  const locations = `Use at ${input.eligibleLocations.join(', ')}.`;
  const terms = `Expires ${expiry}. One use only; any unused value is not kept as a balance.`;
  const reply = 'Need a hand using your gift card? Reply to this email and we’ll help with this same request.';
  const subject = `A little sweetness for you: your ${amount} Bloomjoy gift card`;
  const text = [greeting, acknowledgement, `${amount} Bloomjoy gift card`, `Your code: ${input.code}`,
    input.redemptionInstructions, locations, terms, reply, 'Warmly,\nThe Bloomjoy Sweets Team'].join('\n\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your Bloomjoy gift card</title></head>
<body style="margin:0;padding:0;background:#fbf4ec;color:#382b35;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your ${escapeHtml(amount)} gift card and everything you need for your next Bloomjoy visit.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fbf4ec;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:580px;background:#fffdfa;border:1px solid #ead7d1;border-radius:20px;">
<tr><td style="padding:16px 24px;background:#b83d64;color:#fff8f1;border-radius:20px 20px 0 0;font:700 13px/20px 'Trebuchet MS',Verdana,sans-serif;letter-spacing:1px;">BLOOMJOY SWEETS</td></tr>
<tr><td style="padding:28px 24px;font:15px/24px 'Trebuchet MS',Verdana,sans-serif;">
<h1 style="margin:0 0 22px;font:700 30px/38px Georgia,serif;color:#4d2738;">A little sweetness for you</h1>
<p style="margin:0 0 12px;">${escapeHtml(greeting)}</p><p style="margin:0 0 24px;">${escapeHtml(acknowledgement)}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff3ef;border:1px solid #efd9d3;border-radius:14px;"><tr><td align="center" style="padding:24px 12px;">
<p style="margin:0;color:#9b3155;font-size:13px;">YOUR BLOOMJOY GIFT CARD</p>
<p style="margin:10px 0;font:700 38px/44px Georgia,serif;color:#4d2738;">${escapeHtml(amount)}</p>
<p style="margin:0 0 8px;font-size:13px;">Your one-use code</p>
<p style="margin:0;font:700 25px/34px Consolas,monospace;overflow-wrap:anywhere;word-break:break-word;color:#4d2738;">${escapeHtml(input.code)}</p>
</td></tr></table>
<h2 style="margin:24px 0 8px;font-size:18px;line-height:26px;color:#4d2738;">Ready for your next visit</h2>
<p style="margin:0 0 16px;">${escapeHtml(input.redemptionInstructions).replaceAll('\n', '<br>')}</p>
<p style="margin:0 0 8px;">${escapeHtml(locations)}</p><p style="margin:0 0 24px;font-size:13px;line-height:21px;color:#684f61;">${escapeHtml(terms)}</p>
<p style="margin:0 0 22px;">${escapeHtml(reply)}</p><p style="margin:0;color:#684f61;">Warmly,<br><strong>The Bloomjoy Sweets Team</strong></p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
};
