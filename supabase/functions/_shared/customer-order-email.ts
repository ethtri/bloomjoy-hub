type OrderType = "sugar" | "blank_sticks" | "unknown";
type PricingTier = "plus_member" | "standard" | null;

type AddressSnapshot = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
};

type SugarMixSummary = {
  white_kg: number;
  blue_kg: number;
  orange_kg: number;
  red_kg: number;
  total_kg: number;
};

type BlankSticksSummary = {
  box_count: number;
  pieces_per_box: number;
  stick_size: string | null;
  address_type: string | null;
};

export type CustomerOrderEmailContext = {
  orderReference: string;
  orderPlacedAt: string;
  orderType: OrderType;
  paymentStatus: string | null;
  amountTotal: number | null;
  currency: string | null;
  pricingTier: PricingTier;
  unitPriceCents: number | null;
  shippingTotalCents: number;
  customerName: string | null;
  shippingName: string | null;
  shippingAddress: AddressSnapshot | null;
  receiptUrl: string | null;
  sugarMix: SugarMixSummary;
  blankSticks: BlankSticksSummary | null;
};

export type CustomerOrderEmailPayload = {
  subject: string;
  text: string;
  html: string;
};

type DetailRow = [string, string];

const SUPPORT_EMAIL = "info@bloomjoyusa.com";
const SUPPORT_URL = "https://www.bloomjoyusa.com/contact";

const COLORS = {
  background: "#fff7f9",
  card: "#ffffff",
  text: "#2f2430",
  muted: "#756877",
  border: "#f1d6de",
  accent: "#e96b8f",
  accentDark: "#c84a71",
  accentSoft: "#ffe6ee",
  successSoft: "#e7f7ef",
  successText: "#1f7a55",
  shadow: "0 18px 40px rgba(225, 107, 143, 0.12)",
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const normalizeString = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const formatCurrency = (amount: number | null | undefined, currency: string | null | undefined) => {
  if (typeof amount !== "number") return "n/a";

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
    }).format(amount / 100);
  } catch {
    return `${(currency || "usd").toUpperCase()} ${(amount / 100).toFixed(2)}`;
  }
};

const formatUnitPrice = (unitPriceCents: number | null | undefined) => {
  if (typeof unitPriceCents !== "number") return "n/a";
  return formatCurrency(unitPriceCents, "usd");
};

const formatPricingTier = (pricingTier: PricingTier) => {
  switch (pricingTier) {
    case "plus_member":
      return "Bloomjoy Plus";
    case "standard":
      return "Standard";
    default:
      return "n/a";
  }
};

const formatOrderType = (orderType: OrderType) => {
  switch (orderType) {
    case "sugar":
      return "Sugar";
    case "blank_sticks":
      return "Bloomjoy branded paper sticks";
    default:
      return "Order";
  }
};

const formatOrderTypeNoun = (orderType: OrderType) => {
  switch (orderType) {
    case "sugar":
      return "sugar";
    case "blank_sticks":
      return "branded paper sticks";
    default:
      return "order";
  }
};

const formatPaymentStatus = (paymentStatus: string | null | undefined) => {
  if (!paymentStatus) return "Pending";
  return paymentStatus.charAt(0).toUpperCase() + paymentStatus.slice(1);
};

const formatStickSize = (stickSize: string | null | undefined) => {
  switch (stickSize) {
    case "commercial_10x300":
      return "Commercial / Full Machine (10mm x 300mm)";
    case "mini_10x220":
      return "Mini Machine (10mm x 220mm)";
    default:
      return stickSize || "n/a";
  }
};

const formatAddressType = (addressType: string | null | undefined) => {
  switch (addressType) {
    case "business":
      return "Business";
    case "residential":
      return "Residential";
    default:
      return addressType || "n/a";
  }
};

const formatOrderDate = (value: string) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "n/a";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
  }).format(date);
};

const isNonEmptyString = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.length > 0;

const formatAddressLines = (address: AddressSnapshot | null | undefined): string[] => {
  if (!address) {
    return ["Shipping details will be confirmed separately."];
  }

  const streetLine = [address.line1, address.line2].filter(Boolean).join(", ");
  const localityLine = [address.city, address.state, address.postal_code].filter(Boolean).join(", ");
  const lines = [streetLine, localityLine, address.country].filter(isNonEmptyString);

  return lines.length ? lines : ["Shipping details will be confirmed separately."];
};

const buildOrderSpecificRows = (context: CustomerOrderEmailContext): DetailRow[] => {
  if (context.orderType === "blank_sticks") {
    return [
      ["Product", "Bloomjoy branded paper sticks"],
      ["Boxes", String(context.blankSticks?.box_count ?? "n/a")],
      ["Pieces per box", String(context.blankSticks?.pieces_per_box ?? "n/a")],
      ["Stick size", formatStickSize(context.blankSticks?.stick_size)],
      ["Address type", formatAddressType(context.blankSticks?.address_type)],
    ];
  }

  return [
    ["Product", "Premium cotton candy sugar"],
    ["White", `${context.sugarMix.white_kg} KG`],
    ["Blue", `${context.sugarMix.blue_kg} KG`],
    ["Orange", `${context.sugarMix.orange_kg} KG`],
    ["Red", `${context.sugarMix.red_kg} KG`],
    ["Total", `${context.sugarMix.total_kg} KG`],
  ];
};

const buildSummaryRows = (context: CustomerOrderEmailContext): DetailRow[] => [
  ["Order reference", context.orderReference],
  ["Order placed", formatOrderDate(context.orderPlacedAt)],
  ["Payment status", formatPaymentStatus(context.paymentStatus)],
  ["Pricing tier", formatPricingTier(context.pricingTier)],
  ["Unit price", formatUnitPrice(context.unitPriceCents)],
  ["Shipping total", formatCurrency(context.shippingTotalCents, context.currency)],
];

const buildRowTable = (
  rows: DetailRow[],
  valueStyle = "font-size:14px;line-height:22px;color:#2f2430;font-weight:600;word-break:break-word;"
) =>
  rows
    .map(
      ([label, value], index) => `
        <tr>
          <td style="padding:${index === 0 ? "0" : "12px"} 0 0 0;font-size:13px;line-height:20px;color:${COLORS.muted};vertical-align:top;">
            ${escapeHtml(label)}
          </td>
          <td style="padding:${index === 0 ? "0" : "12px"} 0 0 16px;${valueStyle}vertical-align:top;text-align:right;">
            ${escapeHtml(value)}
          </td>
        </tr>
      `
    )
    .join("");

const buildAddressHtml = (lines: string[]) =>
  lines
    .map(
      (line) => `
        <div style="font-size:14px;line-height:22px;color:${COLORS.text};">
          ${escapeHtml(line)}
        </div>
      `
    )
    .join("");

const buildTextOrderSpecificLines = (context: CustomerOrderEmailContext) =>
  buildOrderSpecificRows(context).map(([label, value]) => `- ${label}: ${value}`);

export const buildCustomerOrderEmail = (
  context: CustomerOrderEmailContext
): CustomerOrderEmailPayload => {
  const recipientName = normalizeString(context.shippingName) ||
    normalizeString(context.customerName) ||
    "there";
  const addressLines = formatAddressLines(context.shippingAddress);
  const orderSpecificRows = buildOrderSpecificRows(context);
  const summaryRows = buildSummaryRows(context);
  const totalCharged = formatCurrency(context.amountTotal, context.currency);
  const orderTypeLabel = formatOrderType(context.orderType);
  const orderTypeNoun = formatOrderTypeNoun(context.orderType);
  const paymentStatus = formatPaymentStatus(context.paymentStatus);
  const previewText = `Your Bloomjoy ${orderTypeNoun} order is confirmed.`;

  const subject =
    context.orderType === "blank_sticks"
      ? "Your Bloomjoy branded paper sticks order is confirmed"
      : context.orderType === "sugar"
        ? "Your Bloomjoy sugar order is confirmed"
        : "Your Bloomjoy order is confirmed";

  const text = [
    `Hi ${recipientName},`,
    "",
    `Thank you for your Bloomjoy ${orderTypeNoun} order. We have received your order and recorded the details below.`,
    "",
    "Order summary",
    `- Order reference: ${context.orderReference}`,
    `- Order placed: ${formatOrderDate(context.orderPlacedAt)}`,
    `- Payment status: ${paymentStatus}`,
    `- Total charged: ${totalCharged}`,
    `- Pricing tier: ${formatPricingTier(context.pricingTier)}`,
    `- Unit price: ${formatUnitPrice(context.unitPriceCents)}`,
    `- Shipping total: ${formatCurrency(context.shippingTotalCents, context.currency)}`,
    "",
    `${orderTypeLabel} details`,
    ...buildTextOrderSpecificLines(context),
    "",
    "Ship to",
    ...addressLines.map((line) => `- ${line}`),
    "",
    context.receiptUrl
      ? `View your payment receipt: ${context.receiptUrl}`
      : "Stripe may send a separate payment receipt depending on your payment method.",
    "",
    `Need help? Reply to this email or contact ${SUPPORT_EMAIL}. Please include your order reference.`,
    `Support page: ${SUPPORT_URL}`,
  ].join("\n");

  const receiptBlock = context.receiptUrl
    ? `
      <tr>
        <td style="padding:0 0 16px 0;">
          <a
            href="${escapeHtml(context.receiptUrl)}"
            style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 20px;border-radius:999px;"
          >
            View payment receipt
          </a>
        </td>
      </tr>
      <tr>
        <td style="font-size:13px;line-height:21px;color:${COLORS.muted};">
          Keep this email for your records. Your payment receipt is also available using the link above.
        </td>
      </tr>
    `
    : `
      <tr>
        <td style="font-size:13px;line-height:21px;color:${COLORS.muted};">
          Stripe may send a separate payment receipt depending on your payment method. If you need another copy, reply to this email and we can help.
        </td>
      </tr>
    `;

  const html = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(subject)}</title>
      </head>
      <body style="margin:0;padding:0;background:${COLORS.background};font-family:Arial, Helvetica, sans-serif;color:${COLORS.text};">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
          ${escapeHtml(previewText)}
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.background};margin:0;padding:24px 0;">
          <tr>
            <td align="center" style="padding:24px 16px;">
              <table
                role="presentation"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                style="max-width:640px;background:${COLORS.card};border-radius:28px;overflow:hidden;box-shadow:${COLORS.shadow};"
              >
                <tr>
                  <td style="padding:0;background:linear-gradient(135deg, ${COLORS.accent} 0%, #f59ab3 100%);">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:32px 32px 26px 32px;">
                          <div style="font-size:12px;line-height:18px;letter-spacing:1.6px;text-transform:uppercase;color:#fff4f8;font-weight:700;">
                            Bloomjoy order confirmation
                          </div>
                          <div style="padding:10px 0 0 0;font-size:30px;line-height:38px;color:#ffffff;font-weight:800;">
                            Your ${escapeHtml(orderTypeNoun)} order is confirmed
                          </div>
                          <div style="padding:12px 0 0 0;font-size:15px;line-height:24px;color:#fff7fa;">
                            We have received your order and saved the fulfillment details below.
                          </div>
                          <div style="padding:18px 0 0 0;">
                            <span style="display:inline-block;max-width:100%;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.32);border-radius:999px;padding:8px 14px;font-size:12px;line-height:16px;color:#ffffff;font-weight:700;word-break:break-word;">
                              Order reference: ${escapeHtml(context.orderReference)}
                            </span>
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:0 0 18px 0;font-size:15px;line-height:24px;color:${COLORS.text};">
                          Hi ${escapeHtml(recipientName)},<br />
                          Thank you for your Bloomjoy ${escapeHtml(orderTypeNoun)} order. We have recorded your payment and saved the fulfillment details below.
                        </td>
                      </tr>
                    </table>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COLORS.border};border-radius:22px;background:${COLORS.accentSoft};">
                      <tr>
                        <td style="padding:24px 24px 22px 24px;">
                          <div style="font-size:13px;line-height:20px;color:${COLORS.muted};text-transform:uppercase;letter-spacing:1px;font-weight:700;">
                            Total charged
                          </div>
                          <div style="padding:8px 0 0 0;font-size:34px;line-height:40px;color:${COLORS.text};font-weight:800;">
                            ${escapeHtml(totalCharged)}
                          </div>
                          <div style="padding:12px 0 0 0;">
                            <span style="display:inline-block;background:${COLORS.successSoft};color:${COLORS.successText};border-radius:999px;padding:7px 12px;font-size:12px;line-height:16px;font-weight:700;">
                              ${escapeHtml(paymentStatus)}
                            </span>
                            <span style="display:inline-block;margin-left:8px;background:#ffffff;color:${COLORS.text};border-radius:999px;padding:7px 12px;font-size:12px;line-height:16px;font-weight:700;border:1px solid ${COLORS.border};">
                              ${escapeHtml(formatPricingTier(context.pricingTier))}
                            </span>
                          </div>
                        </td>
                      </tr>
                    </table>

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding-top:20px;">
                      <tr>
                        <td style="padding:0 0 20px 0;">
                          <div style="font-size:18px;line-height:26px;color:${COLORS.text};font-weight:800;">
                            Order summary
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td style="border:1px solid ${COLORS.border};border-radius:20px;padding:22px 24px;background:#ffffff;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                            ${buildRowTable(summaryRows)}
                          </table>
                        </td>
                      </tr>
                    </table>

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding-top:20px;">
                      <tr>
                        <td style="padding:0 0 20px 0;">
                          <div style="font-size:18px;line-height:26px;color:${COLORS.text};font-weight:800;">
                            ${escapeHtml(orderTypeLabel)} details
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td style="border:1px solid ${COLORS.border};border-radius:20px;padding:22px 24px;background:#ffffff;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                            ${buildRowTable(orderSpecificRows)}
                          </table>
                        </td>
                      </tr>
                    </table>

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding-top:20px;">
                      <tr>
                        <td style="padding:0 0 20px 0;">
                          <div style="font-size:18px;line-height:26px;color:${COLORS.text};font-weight:800;">
                            Shipping details
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td style="border:1px solid ${COLORS.border};border-radius:20px;padding:22px 24px;background:#ffffff;">
                          <div style="font-size:14px;line-height:22px;color:${COLORS.muted};padding-bottom:8px;">
                            Ship to
                          </div>
                          <div style="font-size:16px;line-height:24px;color:${COLORS.text};font-weight:700;padding-bottom:8px;">
                            ${escapeHtml(normalizeString(context.shippingName) || normalizeString(context.customerName) || "Bloomjoy customer")}
                          </div>
                          ${buildAddressHtml(addressLines)}
                        </td>
                      </tr>
                    </table>

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding-top:20px;">
                      <tr>
                        <td style="border:1px solid ${COLORS.border};border-radius:20px;padding:22px 24px;background:#ffffff;">
                          <div style="font-size:18px;line-height:26px;color:${COLORS.text};font-weight:800;padding-bottom:12px;">
                            Need anything else?
                          </div>
                          <div style="font-size:14px;line-height:22px;color:${COLORS.muted};padding-bottom:16px;">
                            Reply to this email or contact Bloomjoy support if you need to update shipping details or have fulfillment questions.
                          </div>
                          ${receiptBlock}
                          <div style="padding-top:16px;font-size:13px;line-height:21px;color:${COLORS.muted};">
                            Support: <a href="mailto:${SUPPORT_EMAIL}" style="color:${COLORS.accentDark};text-decoration:none;">${SUPPORT_EMAIL}</a>
                            <span style="color:${COLORS.border};padding:0 6px;">|</span>
                            <a href="${SUPPORT_URL}" style="color:${COLORS.accentDark};text-decoration:none;">Contact page</a>
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return {
    subject,
    text,
    html,
  };
};
