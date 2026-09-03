export type RefundCustomerLocale = "en" | "es";

const spanishSignals = [
  "ayuda",
  "cobro",
  "cobraron",
  "dinero",
  "efectivo",
  "funciono",
  "funcionó",
  "maquina",
  "máquina",
  "pague",
  "pagué",
  "pago",
  "producto",
  "reembolso",
  "recibi",
  "recibí",
  "salio",
  "salió",
  "tarjeta",
];

const normalize = (value: unknown, maximum = 2500) =>
  typeof value === "string"
    ? value.trim().toLocaleLowerCase("es").slice(0, maximum)
    : "";

export const sanitizeRefundCustomerLocale = (
  value: unknown,
): RefundCustomerLocale => normalize(value, 20).startsWith("es") ? "es" : "en";

export const refundCustomerLocaleFromIntakeMeta = (
  value: unknown,
): RefundCustomerLocale => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "en";
  return sanitizeRefundCustomerLocale(
    (value as Record<string, unknown>).customer_locale,
  );
};

export const inferRefundCustomerLocale = ({
  explicitLocale,
  acceptLanguage,
  customerText,
}: {
  explicitLocale?: unknown;
  acceptLanguage?: unknown;
  customerText?: unknown;
}): RefundCustomerLocale => {
  const explicit = normalize(explicitLocale, 20);
  if (explicit === "es" || explicit.startsWith("es-")) return "es";
  if (explicit === "en" || explicit.startsWith("en-")) return "en";

  const accepted = normalize(acceptLanguage, 160);
  if (/^(?:es)(?:[-;,]|$)/u.test(accepted)) return "es";

  const text = normalize(customerText);
  if (!text) return "en";
  const matches = spanishSignals.filter((signal) =>
    new RegExp(`(?:^|[^\\p{L}])${signal}(?:$|[^\\p{L}])`, "iu").test(text)
  );
  const hasSpanishPunctuation = /[¿¡]/u.test(text);
  return matches.length >= 2 || (matches.length >= 1 && hasSpanishPunctuation)
    ? "es"
    : "en";
};
