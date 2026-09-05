import {
  sendTransactionalEmail,
  type TransactionalEmailInput,
} from "./internal-email.ts";
import { resolveRefundPublicLabels } from "./refund-location.ts";
import { getRefundGmailMailboxIdentities } from "./refund-gmail.ts";
import {
  REFUND_DETERMINISTIC_FOLLOW_UP_VERSION,
  type RefundFollowUpReason,
  type RefundMissingField,
  sanitizeRefundMissingFields,
} from "./refund-deterministic-follow-up.ts";
import {
  type RefundBrandDetail,
  renderBloomjoyRefundEmail,
  renderBloomjoyRefundStoredText,
} from "./refund-email-brand.ts";
import {
  REFUND_CUSTOMER_SENDER_NAME,
  REFUND_MONITORED_REPLY_TO_EMAIL,
} from "./refund-customer-transport.ts";
import {
  sanitizeRefundCustomerLocale,
  type RefundCustomerLocale,
} from "./refund-language.ts";
import { refundCorrectionCopy } from "./refund-correction-copy.ts";
import { requireRefundCorrectionUrl, STORED_CORRECTION_LINK_MARKER } from "./refund-correction-delivery.ts";

export {
  REFUND_DETERMINISTIC_FOLLOW_UP_VERSION,
  type RefundMissingField,
  sanitizeRefundMissingFields,
} from "./refund-deterministic-follow-up.ts";

export type RefundCustomerMessageType =
  | "confirmation"
  | "more_info"
  | "reminder"
  | "no_safe_match"
  | "information_received"
  | "wallet_correction"
  | "wallet_correction_reminder"
  | "status_update"
  | "approved"
  | "denied"
  | "appeal_received"
  | "completed";

export type RefundCustomerEmailInput = {
  messageType: RefundCustomerMessageType;
  publicReference: string;
  customerName?: string | null;
  customerEmail: string;
  machineLabel?: string | null;
  locationName?: string | null;
  refundAmountCents?: number | null;
  paymentMethod?: string | null;
  decisionReason?: string | null;
  missingFields?: RefundMissingField[];
  followUpReason?: RefundFollowUpReason;
  statusUpdateReason?: "provider_delay" | "sla_at_risk";
  customerLocale?: RefundCustomerLocale | string | null;
  incidentLocalDateTime?: string | null;
  cardWalletUsed?: boolean;
  cardLast4?: string | null;
  managerCcEmails?: string[];
  managerRecipientOverlap?: boolean;
  managerRecipientCount?: number;
  statusUrl?: string | null;
  correctionUrl?: string | null;
  idempotencyKey?: string | null;
};

const refundMissingFieldRequest: Record<RefundMissingField, string> = {
  location_or_machine: "the machine or Bloomjoy location",
  incident_date: "the purchase date",
  incident_time: "the approximate purchase time, including AM or PM",
  payment_method: "whether you paid by card, Apple Pay, Google Pay, or cash",
  payment_interaction: "how you used the card or wallet",
  card_last4_source: "where you found the last four digits",
  wallet_provider: "the wallet provider, if you used a phone or watch wallet",
  wallet_device_kind: "whether you used a phone or watch",
  incident_time_source: "whether the time came from an alert or receipt, memory, or is unknown",
  nearby_attempt_count: "whether there was one nearby attempt or charge, more than one, or you are not sure",
  amount: "the exact amount charged",
  card_last4:
    "only the last four digits shown on the card charge (do not email wallet or device-card digits)",
  card_network: "the card type shown on the card or inside the wallet",
  zelle_payment_contact:
    "the email address or phone number connected to Zelle for this reimbursement",
};

const refundMissingFieldReplyLine: Record<RefundMissingField, string> = {
  location_or_machine: "Machine or location:",
  incident_date: "Purchase date (YYYY-MM-DD):",
  incident_time: "Approximate purchase time (include AM or PM):",
  payment_method: "Payment method (card, Apple Pay, Google Pay, or cash):",
  payment_interaction: "Payment interaction (tap card, insert or swipe, phone or watch wallet, or not sure):",
  card_last4_source: "Last-four source (physical card, wallet/device, bank record or alert, or not sure):",
  wallet_provider: "Wallet provider (Apple Pay, Google Wallet, other, or not sure):",
  wallet_device_kind: "Wallet device (phone, watch, or not sure):",
  incident_time_source: "Time source (alert or receipt, memory, or not sure):",
  nearby_attempt_count: "Nearby attempts or charges (one, more than one, or not sure):",
  amount: "Amount (for example, $7.25):",
  card_last4: "Card last four:",
  card_network: "Card type (Visa, Mastercard, Discover, American Express, or not sure):",
  zelle_payment_contact: "Zelle email or phone number:",
};

const refundMissingFieldRequestSpanish: Record<RefundMissingField, string> = {
  location_or_machine: "la máquina o ubicación de Bloomjoy",
  incident_date: "la fecha de compra",
  incident_time: "la hora aproximada de compra, incluyendo a. m. o p. m.",
  payment_method: "si pagó con tarjeta, Apple Pay, Google Pay o efectivo",
  payment_interaction: "cómo usó la tarjeta o billetera digital",
  card_last4_source: "dónde encontró los últimos cuatro dígitos",
  wallet_provider: "la billetera digital que usó",
  wallet_device_kind: "si usó un teléfono o un reloj",
  incident_time_source: "si la hora provino de una alerta o recibo, de memoria, o no está seguro",
  nearby_attempt_count: "si hubo un intento o cargo cercano, más de uno, o no está seguro",
  amount: "el monto exacto cobrado",
  card_last4: "solamente los últimos cuatro dígitos de la tarjeta física",
  card_network: "el tipo de tarjeta",
  zelle_payment_contact:
    "el correo electrónico o número de teléfono conectado a Zelle para este reembolso",
};

const refundMissingFieldReplyLineSpanish: Record<RefundMissingField, string> = {
  location_or_machine: "Máquina o ubicación:",
  incident_date: "Fecha de compra (AAAA-MM-DD):",
  incident_time: "Hora aproximada de compra (incluya a. m. o p. m.):",
  payment_method: "Método de pago:",
  payment_interaction: "Cómo usó la tarjeta o billetera digital:",
  card_last4_source: "Fuente de los últimos cuatro dígitos:",
  wallet_provider: "Billetera digital:",
  wallet_device_kind: "Dispositivo de la billetera (teléfono, reloj o no sé):",
  incident_time_source: "Fuente de la hora (alerta o recibo, memoria o no sé):",
  nearby_attempt_count: "Intentos o cargos cercanos (uno, más de uno o no sé):",
  amount: "Monto:",
  card_last4: "Últimos cuatro dígitos de la tarjeta:",
  card_network: "Tipo de tarjeta:",
  zelle_payment_contact: "Correo electrónico o número de teléfono de Zelle:",
};

export const describeRefundMissingFields = (value: unknown) =>
  sanitizeRefundMissingFields(value).map((field) =>
    refundMissingFieldRequest[field]
  );

const sanitizeText = (value: unknown, maxLength = 800) =>
  typeof value === "string" || typeof value === "number" ||
    typeof value === "boolean"
    ? String(value).trim().slice(0, maxLength)
    : "";

const REFUND_MANAGER_CC_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export const requireRefundManagerCcEmailsForSend = (
  managerCcEmails: string[] | undefined,
  customerEmail: string,
  managerRecipientOverlap = false,
  managerRecipientCount?: number,
) => {
  if (!Array.isArray(managerCcEmails)) {
    throw new Error(
      "Refund customer email requires at least one current mapped Machine Manager in CC.",
    );
  }

  const normalized = managerCcEmails.map((email) => email.trim().toLowerCase());
  const excluded = new Set([
    customerEmail.trim().toLowerCase(),
    ...getRefundGmailMailboxIdentities(),
  ]);
  if (
    !Number.isSafeInteger(managerRecipientCount) ||
    managerRecipientCount! < 1 ||
    managerRecipientCount! > 4 ||
    normalized.length + (managerRecipientOverlap ? 1 : 0) !==
      managerRecipientCount ||
    new Set(normalized).size !== normalized.length ||
    normalized.some((email) =>
      email.length > 320 ||
      !REFUND_MANAGER_CC_PATTERN.test(email) ||
      excluded.has(email)
    )
  ) {
    throw new Error(
      "Refund customer email requires at least one current mapped Machine Manager in CC.",
    );
  }

  return normalized;
};

export const getRefundReplyToEmail = () => {
  const configured = sanitizeText(Deno.env.get("REFUND_REPLY_TO_EMAIL"), 320)
    .toLowerCase();
  if (configured && configured !== REFUND_MONITORED_REPLY_TO_EMAIL) {
    throw new Error(
      "Refund customer replies must use the monitored support mailbox.",
    );
  }
  return REFUND_MONITORED_REPLY_TO_EMAIL;
};

export const sendRefundTransactionalEmail = async (
  input: Omit<TransactionalEmailInput, "replyTo" | "senderName">,
) =>
  await sendTransactionalEmail({
    ...input,
    replyTo: getRefundReplyToEmail(),
    senderName: REFUND_CUSTOMER_SENDER_NAME,
  });

export const sanitizeRefundMessageType = (
  value: unknown,
): RefundCustomerMessageType | null => {
  const normalized = sanitizeText(value, 80).toLowerCase();
  if (
    normalized === "confirmation" ||
    normalized === "more_info" ||
    normalized === "reminder" ||
    normalized === "no_safe_match" ||
    normalized === "information_received" ||
    normalized === "wallet_correction" ||
    normalized === "wallet_correction_reminder" ||
    normalized === "status_update" ||
    normalized === "approved" ||
    normalized === "denied" ||
    normalized === "appeal_received" ||
    normalized === "completed"
  ) {
    return normalized;
  }

  return null;
};

const formatCurrency = (cents?: number | null) => {
  if (typeof cents !== "number") return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
};

const sanitizeRefundStatusUrl = (value: unknown) => {
  const candidate = sanitizeText(value, 700);
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    const approvedProductionHost = parsed.protocol === "https:" && [
      "app.bloomjoyusa.com",
      "www.bloomjoyusa.com",
    ].includes(parsed.hostname);
    const approvedLocalHost = parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(parsed.hostname);
    const token = parsed.hash.startsWith("#token=")
      ? parsed.hash.slice("#token=".length)
      : "";
    if (
      (!approvedProductionHost && !approvedLocalHost) ||
      parsed.pathname !== "/refunds/status" ||
      parsed.search ||
      !/^[A-Za-z0-9_-]{43}$/.test(token) ||
      parsed.username || parsed.password
    ) return "";
    return parsed.toString();
  } catch {
    return "";
  }
};

const storedStatusUrlPattern = /https?:\/\/(?:(?:app|www)\.bloomjoyusa\.com|localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?)\/refunds\/status#token=[A-Za-z0-9_-]{43}/gu;
const storedCorrectionUrlPattern = /https?:\/\/(?:(?:app|www)\.bloomjoyusa\.com|localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?)\/refunds\/correct#token=[A-Za-z0-9_-]{43}/gu;

export const redactRefundStatusLinksForStorage = (value: string) =>
  value.replace(storedStatusUrlPattern, "[Secure refund status link included at delivery]")
    .replace(storedCorrectionUrlPattern, STORED_CORRECTION_LINK_MARKER);

export const buildRefundStoredTextWithStatus = ({
  headline,
  text,
  statusUrl,
}: {
  headline: string;
  text: string;
  statusUrl?: string | null;
}) => {
  const approvedStatusUrl = sanitizeRefundStatusUrl(statusUrl);
  const deliveryText = approvedStatusUrl
    ? `${text.trim()}\n\nCheck refund status:\n${approvedStatusUrl}`
    : text;
  return {
    text: deliveryText,
    html: renderBloomjoyRefundStoredText({
      headline,
      text,
      primaryLink: approvedStatusUrl
        ? { label: "Check refund status", url: approvedStatusUrl }
        : null,
    }),
  };
};

const getSubject = (
  messageType: RefundCustomerMessageType,
  publicReference: string,
) => {
  switch (messageType) {
    case "more_info":
      return `A quick detail check for your Bloomjoy refund request ${publicReference}`;
    case "reminder":
      return `Still here to help with your Bloomjoy refund request ${publicReference}`;
    case "no_safe_match":
      return `A careful check of your Bloomjoy refund request ${publicReference}`;
    case "information_received":
      return `We added your information to Bloomjoy refund request ${publicReference}`;
    case "wallet_correction":
      return `Please check your mobile-wallet card details for refund request ${publicReference}`;
    case "wallet_correction_reminder":
      return `Reminder: check your mobile-wallet card details for ${publicReference}`;
    case "approved":
      return `Your Bloomjoy refund request ${publicReference} was approved`;
    case "denied":
      return `Update on your Bloomjoy refund request ${publicReference}`;
    case "appeal_received":
      return `We are reviewing your reply about ${publicReference}`;
    case "completed":
      return `Your Bloomjoy refund request ${publicReference} is complete`;
    case "status_update":
      return `We are still reviewing your Bloomjoy refund request ${publicReference}`;
    case "confirmation":
    default:
      return `We received your Bloomjoy refund request ${publicReference}`;
  }
};

const getHeadline = (messageType: RefundCustomerMessageType) => {
  switch (messageType) {
    case "more_info":
      return "One more detail to continue your refund review";
    case "reminder":
      return "We are still here to help";
    case "no_safe_match":
      return "We checked carefully";
    case "information_received":
      return "Thank you for the added details";
    case "wallet_correction":
    case "wallet_correction_reminder":
      return "One quick wallet detail check";
    case "approved":
      return "Your request was approved";
    case "denied":
      return "An update from our team";
    case "appeal_received":
      return "We received your reply";
    case "completed":
      return "Your refund step is complete";
    case "status_update":
      return "Your review is still moving";
    case "confirmation":
    default:
      return "We received your request";
  }
};

const getBodyParagraphs = ({
  messageType,
  refundAmountCents,
  paymentMethod,
  missingFields,
  followUpReason,
  statusUpdateReason,
  cardWalletUsed,
  cardLast4,
  decisionReason,
}: RefundCustomerEmailInput) => {
  const refundAmount = formatCurrency(refundAmountCents);
  const amountPhrase = refundAmount ? ` for ${refundAmount}` : "";
  const isCash = paymentMethod === "cash";
  const missingFieldRequests = describeRefundMissingFields(missingFields);
  const requestedDetails = missingFieldRequests.join("; ");
  const replyLines = sanitizeRefundMissingFields(missingFields)
    .map((field) => refundMissingFieldReplyLine[field])
    .join("\n");

  if (
    cardWalletUsed &&
    sanitizeRefundMissingFields(missingFields).includes("card_last4")
  ) {
    throw new Error(
      "Mobile-wallet last-four corrections must use the secure correction flow, not email.",
    );
  }

  switch (messageType) {
    case "more_info":
      if (missingFieldRequests.length === 0) {
        throw new Error(
          "A deterministic missing-field list is required for a more-information message.",
        );
      }
      return [
        "Thank you again for reaching out. We are sorry this needs another step, and we want to make sure we review the right transaction.",
        `Please reply with ${requestedDetails}.`,
        `For the fastest automatic update, copy these lines into your reply and fill in only the blanks:\n${replyLines}`,
        "Please do not send a full card number, security code, expiration date, PIN, password, or payment-screen screenshot. Once we receive the requested details, we will continue the review and keep ownership of the next step.",
      ];
    case "reminder":
      if (followUpReason === "no_safe_match") {
        if (isCash) {
          return [
            "We are checking in once because we still want to help with your refund request. There is no need to resend the information you already shared.",
            "We could not verify one matching cash purchase from the available records. If the machine, location, purchase date, approximate time, or amount needs a correction, please reply in this same conversation. If everything is correct, no action is needed from you and a person will continue the review.",
            "For your safety, please never send payment-account details, a PIN, password, or screenshot.",
          ];
        }
        return [
          "We are checking in once because we still want to help with your refund request. There is no need to resend the information you already shared.",
          "Please reply only if any detail shown below needs a correction, such as the machine or location, purchase date or approximate time, amount, or payment method. If everything is correct, no action is needed from you and a person will continue the review.",
          "For your safety, please never send a full card number, security code, expiration date, PIN, password, wallet digits, or screenshot.",
        ];
      }
      if (missingFieldRequests.length === 0) {
        throw new Error(
          "A deterministic missing-field list is required for a reminder message.",
        );
      }
      return [
        "We are checking in once because we still need the specific details below to continue the review. There is no need to resend anything else.",
        `When you have a moment, please reply with ${requestedDetails}.`,
        "For your safety, please never send a full card number, security code, expiration date, PIN, password, or payment-screen screenshot.",
      ];
    case "no_safe_match":
      if (isCash) {
        return [
          "Thank you for the details you shared. We could not verify one matching cash purchase from the available records yet. This does not mean you did anything wrong.",
          "Please reply only if the machine or location, purchase date, approximate time, or amount needs a correction. A person will continue the review if there still is not one clear record.",
          "Please do not send payment-account details, a PIN, password, or screenshot.",
        ];
      }
      return [
        "Thank you for the details you shared. We checked the available machine transaction records carefully, but we could not identify one transaction that we can safely match to your request yet. This does not mean you did anything wrong.",
        "Please reply only if any of the details shown below need a correction, such as the machine or location, purchase date or approximate time, amount, or payment method.",
        "Please do not send a full card number, security code, expiration date, PIN, password, or screenshot. We will take another careful look after any correction, and a person will review the case if there still is not one clear match.",
      ];
    case "information_received":
      return [
        "Thank you for sending the additional information. We added it to your refund request, so you do not need to resend it.",
        isCash
          ? "Our team will continue the review using the updated purchase details. This message confirms receipt only. It is not yet a refund decision and is not a promise that a payment has been completed."
          : "Our team will check the updated details against the available transaction records. This message confirms receipt only. It is not yet a refund decision and is not a promise that a payment has been completed.",
      ];
    case "wallet_correction":
    case "wallet_correction_reminder":
      return [
        "A mobile wallet such as Apple Pay or Google Pay can show different last four digits than the physical card. That may be why we could not confidently match your purchase yet.",
        "Use the secure link in this email to enter only the last four digits shown for the card inside your mobile wallet and your approximate purchase time.",
        "Please do not send a full card number, security code, expiration date, wallet password, or screenshot. We will automatically check the corrected details against the machine transactions.",
      ];
    case "approved":
      return [
        `Good news: our team approved your refund request${amountPhrase}.`,
        isCash
          ? "The next step is for our team to complete the refund using the payment method arranged with you."
          : "The next step is refund completion through our payment provider. We will send another update once that action is complete.",
        "Thanks for giving us the chance to make this right.",
      ];
    case "denied":
      if (!sanitizeRefundCustomerSafeDenialReason(decisionReason)) {
        throw new Error(
          "A customer-safe denial reason is required for a denial message.",
        );
      }
      return [
        "Thank you for giving us the chance to review this. We were not able to approve the refund.",
        `Here is the reason we can share: ${
          sanitizeRefundCustomerSafeDenialReason(decisionReason)
        }`,
        "If we missed or misunderstood something, please reply in this same conversation. We will reopen this request for another review, and your reply will never issue a payment automatically.",
        "We are sorry this visit was frustrating, and we appreciate you reaching out.",
      ];
    case "appeal_received":
      return [
        "Thank you for replying. We reopened this same refund request so a manager can review what you shared.",
        "You do not need to submit another form. This message confirms that your appeal was received; it is not a refund approval and cannot issue a payment automatically.",
        "We will keep the original request and conversation together and follow up after the review.",
      ];
    case "completed": {
      const maskedCard = sanitizeText(cardLast4, 4);
      if (isCash) {
        return [
          "Good news—your refund request was approved and completed.",
          `We issued your refund${amountPhrase} using the payment method arranged with you.`,
          "Thank you for letting us help make this right.",
        ];
      }
      return [
        "Nayax has approved your refund. Your bank may take up to 4 business days to show it on your account.",
        `The approved refund${amountPhrase}${
          /^\d{4}$/.test(maskedCard)
            ? ` to the card ending in ${maskedCard}`
            : ""
        } is now being returned through your card network. If it is not visible after 4 business days, reply to this email and include your reference below.`,
        "Thank you for letting us help make this right.",
      ];
    }
    case "status_update":
      if (statusUpdateReason === "provider_delay") {
        return [
          "We are still reviewing your request and have not forgotten about you.",
          "We are waiting for confirmation from the payment provider before taking another refund action. You do not need to submit another request or send your card details.",
          "A person is monitoring the case. We will contact you again when the result is confirmed or if we need one specific detail from you.",
        ];
      }
      if (statusUpdateReason === "sla_at_risk") {
        return [
          "We are still reviewing your request and have not forgotten about you.",
          "The review is taking longer than our usual target, so a person is now following it directly. You do not need to submit another request.",
          "We will contact you again when we have a confirmed next step or if we need one specific detail from you.",
        ];
      }
      return [
        "We are still reviewing your request and have not forgotten about you.",
        "Our team is checking the transaction and machine details with care. Our target is to complete refund reviews within 5 business days.",
      ];
    case "confirmation":
    default:
      return [
        "Thank you for reaching out. We are sorry the Bloomjoy experience did not go the way it should have, and we have opened a refund request for you.",
        isCash
          ? "Our team will review the purchase details and follow up as soon as we have the next step."
          : "Our team will review the transaction details and follow up as soon as we have the next step.",
        "Our target is to complete refund reviews within 5 business days.",
      ];
  }
};

const getSpanishBodyParagraphs = ({
  messageType,
  paymentMethod,
  missingFields,
  statusUpdateReason,
}: RefundCustomerEmailInput) => {
  const isCash = paymentMethod === "cash";
  const requestedFields = sanitizeRefundMissingFields(missingFields);
  const requestedDetails = requestedFields
    .map((field) => refundMissingFieldRequestSpanish[field])
    .join("; ");
  const replyLines = requestedFields
    .map((field) => refundMissingFieldReplyLineSpanish[field])
    .join("\n");
  switch (messageType) {
    case "more_info":
    case "reminder":
      return [
        requestedDetails
          ? `Responda en esta misma conversación solamente con ${requestedDetails}.`
          : "Necesitamos un dato más para continuar la revisión.",
        replyLines
          ? `Copie esta línea en su respuesta y complete solamente el espacio solicitado:\n${replyLines}`
          : "Responda solamente con la información solicitada.",
        "Por su seguridad, no envíe el número completo de su tarjeta, código de seguridad, fecha de vencimiento, PIN, contraseña ni capturas de pantalla.",
      ];
    case "no_safe_match":
      return [
        isCash
          ? "Todavía no pudimos verificar un registro claro de la compra en efectivo. Esto no significa que usted haya hecho algo incorrecto."
          : "Todavía no pudimos identificar con seguridad una sola transacción para su solicitud. Esto no significa que usted haya hecho algo incorrecto.",
        "Responda solamente si necesita corregir la máquina o ubicación, la fecha, la hora aproximada, el monto o el método de pago. Si todo está correcto, una persona continuará la revisión.",
      ];
    case "information_received":
      return [
        "Recibimos la información adicional y la agregamos a la misma solicitud. No necesita enviarla otra vez.",
        "Este mensaje confirma la recepción solamente; todavía no es una decisión ni confirma que se haya enviado un pago.",
      ];
    case "approved":
      return [
        "Nuestro equipo aprobó su solicitud de reembolso.",
        "Le enviaremos otra actualización cuando el paso de pago esté confirmado.",
      ];
    case "denied":
      return [
        "No pudimos aprobar la solicitud con la información disponible.",
        "Si faltó o entendimos mal algún dato, responda en esta misma conversación. Revisaremos nuevamente la misma solicitud; su respuesta no enviará un pago automáticamente.",
      ];
    case "completed":
      return [
        isCash
          ? "Su solicitud fue aprobada y el paso de reembolso fue completado mediante el método acordado con usted."
          : "El proveedor de pago aprobó el reembolso. Su banco puede tardar hasta 4 días hábiles en mostrarlo.",
        "Si necesita ayuda, responda a este correo e incluya la referencia que aparece abajo.",
      ];
    case "status_update":
      if (statusUpdateReason === "provider_delay") {
        return [
          "Seguimos revisando su solicitud y no la hemos olvidado.",
          "Estamos esperando una confirmación del proveedor de pago antes de realizar otra acción. No necesita enviar otra solicitud ni compartir datos de su tarjeta.",
          "Una persona está supervisando el caso y le escribiremos cuando tengamos un resultado confirmado.",
        ];
      }
      return [
        "Seguimos revisando su solicitud y no la hemos olvidado.",
        "No necesita enviar otra solicitud. Una persona le escribirá cuando tengamos el siguiente paso confirmado o si necesitamos un dato específico.",
      ];
    case "confirmation":
    default:
      return [
        "Recibimos su solicitud de reembolso y lamentamos que la experiencia no haya salido como esperaba.",
        isCash
          ? "Nuestro equipo revisará los datos de la compra y le escribirá con el siguiente paso."
          : "Nuestro equipo revisará los datos de la transacción y le escribirá con el siguiente paso.",
        "Nuestro objetivo es completar la revisión dentro de 5 días hábiles.",
      ];
  }
};

const refundDenialProhibitedPatterns = [
  /\b(?:internal|risk score|fraud score|nayax|provider error|api|token|secret|database|sql|stack trace)\b/iu,
  /(?:https?:\/\/|\/refunds\?case=)/iu,
  /\b(?:\d[ -]*?){12,19}\b/u,
];

export const sanitizeRefundCustomerSafeDenialReason = (value: unknown) => {
  const normalized = sanitizeText(value, 360).replace(/\s+/gu, " ");
  if (
    normalized.length < 8 ||
    refundDenialProhibitedPatterns.some((pattern) => pattern.test(normalized))
  ) {
    return "";
  }
  return /[.!?]$/u.test(normalized) ? normalized : `${normalized}.`;
};

export const buildRefundPurchaseCorrectionEmail = (input: RefundCustomerEmailInput) => {
  const fields = sanitizeRefundMissingFields(input.missingFields);
  if (!fields.length || !input.correctionUrl) throw new Error("A correction request needs specific fields and a scoped link.");
  const link = input.correctionUrl === STORED_CORRECTION_LINK_MARKER
    ? null : requireRefundCorrectionUrl(input.correctionUrl);
  const spanish = sanitizeRefundCustomerLocale(input.customerLocale) === "es";
  const reference = sanitizeText(input.publicReference, 80);
  const { subject, paragraphs } = refundCorrectionCopy(fields, reference, spanish);
  const label = spanish ? "Actualizar su solicitud / Update your refund request" : "Update your refund request";
  const replyLine = spanish
    ? "Puede responder a este correo si necesita ayuda. / You can reply to this email if you need help."
    : "You can reply to this email if you need help.";
  const safetyLine = spanish
    ? "No envíe números completos de tarjetas, códigos de seguridad ni contraseñas. / Never send full card numbers, security codes or passwords."
    : "Never send full card numbers, security codes or passwords.";
  const greeting = input.customerName ? `${spanish ? 'Hola' : 'Hi'} ${sanitizeText(input.customerName, 160)},` : spanish ? "Hola," : "Hi there,";
  return {
    subject,
    text: [greeting, ...paragraphs, `Reference: ${reference}`, label, link ?? STORED_CORRECTION_LINK_MARKER, replyLine, safetyLine, "Warmly,\nThe Bloomjoy Sweets Team"].join("\n\n"),
    html: renderBloomjoyRefundEmail({ preheader: subject, headline: spanish ? "Actualice su solicitud" : "Update your refund request", greeting, paragraphs,
      details: [{ label: "Reference", value: reference }], primaryLink: link ? { label, url: link } : null, replyLine, safetyLine }),
  };
};

export const buildRefundCustomerEmail = (input: RefundCustomerEmailInput) => {
  if (input.correctionUrl) return buildRefundPurchaseCorrectionEmail(input);
  const publicReference = sanitizeText(input.publicReference, 80);
  const customerName = sanitizeText(input.customerName, 160);
  const { machineLabel, locationName } = resolveRefundPublicLabels({
    machineLabel: input.machineLabel,
    locationName: input.locationName,
  });
  const customerLocale = sanitizeRefundCustomerLocale(input.customerLocale);
  const baseSubject = getSubject(input.messageType, publicReference);
  const subject = customerLocale === "es" ? `[Español / English] ${baseSubject}` : baseSubject;
  const greeting = customerName ? `Hi ${customerName},` : "Hi there,";
  const englishParagraphs = getBodyParagraphs(input);
  const paragraphs = customerLocale === "es"
    ? [
      ...englishParagraphs,
      "Información en español",
      ...getSpanishBodyParagraphs(input),
    ]
    : englishParagraphs;
  const statusUrl = sanitizeRefundStatusUrl(input.statusUrl);
  const details = [`Reference: ${publicReference}`];
  if (machineLabel) details.push(`Machine: ${machineLabel}`);
  if (locationName) details.push(`Location: ${locationName}`);
  const refundAmount = formatCurrency(input.refundAmountCents);
  if (refundAmount) {
    const amountLabel =
      input.messageType === "approved" || input.messageType === "completed"
        ? "Refund amount"
        : "Reported amount";
    details.push(`${amountLabel}: ${refundAmount}`);
  }
  const incidentLocalDateTime = sanitizeText(input.incidentLocalDateTime, 40);
  if (incidentLocalDateTime) {
    details.push(`Reported purchase time: ${incidentLocalDateTime}`);
  }
  if (input.paymentMethod === "card") {
    details.push("Payment method: Card or mobile wallet");
  }
  if (input.paymentMethod === "cash") details.push("Payment method: Cash");

  const text = [
    greeting,
    "",
    ...paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...details,
    "",
    ...(statusUrl ? ["Check refund status:", statusUrl, ""] : []),
    "You can reply directly to this email if anything looks off.",
    "",
    "Warmly,",
    "The Bloomjoy Sweets Team",
  ].join("\n");
  const brandDetails: RefundBrandDetail[] = details.map((detail) => {
    const [label, ...valueParts] = detail.split(": ");
    return { label, value: valueParts.join(": ") };
  });
  const html = renderBloomjoyRefundEmail({
    preheader: subject,
    eyebrow: "Bloomjoy refund request",
    headline: getHeadline(input.messageType),
    greeting,
    paragraphs,
    details: brandDetails,
    primaryLink: statusUrl ? { label: "Check refund status", url: statusUrl } : null,
    replyLine: input.messageType === "denied"
      ? "Reply in this same conversation if we missed or misunderstood something."
      : "You can reply directly to this email if anything looks off.",
  });

  return { subject, text, html };
};

export const buildEditableRefundCustomerEmail = ({
  input,
  subject,
  body,
}: {
  input: RefundCustomerEmailInput;
  subject: string;
  body: string;
}) => {
  const publicReference = sanitizeText(input.publicReference, 80);
  const customerName = sanitizeText(input.customerName, 160);
  const { machineLabel, locationName } = resolveRefundPublicLabels({
    machineLabel: input.machineLabel,
    locationName: input.locationName,
  });
  const greeting = customerName ? `Hi ${customerName},` : "Hi there,";
  const safeSubjectBase = sanitizeText(subject, 180) ||
    getSubject(input.messageType, publicReference);
  const finalSubject =
    safeSubjectBase.toLowerCase().includes(publicReference.toLowerCase())
      ? safeSubjectBase
      : `${safeSubjectBase} - ${publicReference}`;
  const sanitizedBody = sanitizeText(body, 4000);
  const statusUrl = sanitizeRefundStatusUrl(input.statusUrl);
  const correctionUrl = input.correctionUrl === STORED_CORRECTION_LINK_MARKER
    ? null : input.correctionUrl ? requireRefundCorrectionUrl(input.correctionUrl) : null;
  const paragraphs = sanitizedBody
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const details = [`Reference: ${publicReference}`];
  if (machineLabel) details.push(`Machine: ${machineLabel}`);
  if (locationName) details.push(`Location: ${locationName}`);
  const refundAmount = formatCurrency(input.refundAmountCents);
  if (refundAmount) {
    const amountLabel = ["approved", "completed"].includes(input.messageType)
      ? "Refund amount"
      : "Reported amount";
    details.push(`${amountLabel}: ${refundAmount}`);
  }

  const text = [
    greeting,
    "",
    ...paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...details,
    "",
    ...(input.correctionUrl ? ["Update your refund request:", correctionUrl ?? STORED_CORRECTION_LINK_MARKER, ""]
      : statusUrl ? ["Check refund status:", statusUrl, ""] : []),
    "Please reply to this email if anything looks off. Replies go to our Bloomjoy support inbox.",
    "",
    "Warmly,",
    "The Bloomjoy Sweets Team",
  ].join("\n");

  const brandDetails: RefundBrandDetail[] = details.map((detail) => {
    const [label, ...valueParts] = detail.split(": ");
    return { label, value: valueParts.join(": ") };
  });
  const html = renderBloomjoyRefundEmail({
    preheader: finalSubject,
    eyebrow: "Bloomjoy refund request",
    headline: getHeadline(input.messageType),
    greeting,
    paragraphs,
    details: brandDetails,
    primaryLink: correctionUrl ? { label: "Update your refund request", url: correctionUrl }
      : !input.correctionUrl && statusUrl ? { label: "Check refund status", url: statusUrl } : null,
    replyLine:
      "Please reply to this email if anything looks off. Replies go to our Bloomjoy support inbox.",
  });

  return { subject: finalSubject, text, html };
};

export const sendRefundCustomerEmail = async (
  input: RefundCustomerEmailInput,
) => {
  const email = buildRefundCustomerEmail(input);
  const managerCcEmails = requireRefundManagerCcEmailsForSend(
    input.managerCcEmails,
    input.customerEmail,
    input.managerRecipientOverlap,
    input.managerRecipientCount,
  );
  const delivery = await sendRefundTransactionalEmail({
    to: [input.customerEmail],
    cc: managerCcEmails,
    subject: email.subject,
    text: email.text,
    html: email.html,
    idempotencyKey: input.idempotencyKey,
  });

  return { ...email, delivery };
};

export const buildBrandedRefundHtmlFromStoredText =
  renderBloomjoyRefundStoredText;

export type RefundWalletCorrectionEmailInput = {
  publicReference: string;
  customerName?: string | null;
  customerEmail: string;
  machineLabel?: string | null;
  locationName?: string | null;
  correctionUrl: string;
  reminder?: boolean;
  managerCcEmails?: string[];
  managerRecipientOverlap?: boolean;
  managerRecipientCount?: number;
  idempotencyKey?: string | null;
};

export const buildRefundWalletCorrectionEmail = (
  input: RefundWalletCorrectionEmailInput,
) => {
  const publicReference = sanitizeText(input.publicReference, 80);
  const customerName = sanitizeText(input.customerName, 160);
  const correctionUrl = sanitizeText(input.correctionUrl, 1200);
  const { machineLabel, locationName } = resolveRefundPublicLabels({
    machineLabel: input.machineLabel,
    locationName: input.locationName,
  });
  const greeting = customerName ? `Hi ${customerName},` : "Hi there,";
  const subject = input.reminder
    ? `Reminder: check your mobile-wallet card details for ${publicReference}`
    : `Please check your mobile-wallet card details for ${publicReference}`;
  const intro = input.reminder
    ? "This is the one reminder for the secure wallet-detail check on your refund request."
    : "A mobile wallet such as Apple Pay or Google Pay can show different last four digits than the physical card. That may be why we could not confidently match your purchase yet.";
  const details = [`Reference: ${publicReference}`];
  if (machineLabel) details.push(`Machine: ${machineLabel}`);
  if (locationName) details.push(`Location: ${locationName}`);

  const text = [
    greeting,
    "",
    intro,
    "",
    "Open the secure form below and enter only the last four digits shown for the card inside your mobile wallet, your approximate purchase time, and confirmation of the amount.",
    "",
    correctionUrl,
    "",
    "Please do not send a full card number, security code, expiration date, wallet password, or screenshot. The link expires in 48 hours and can be used once.",
    "",
    ...details,
    "",
    "After you submit it, our system will automatically check the corrected details against the machine transactions.",
    "",
    "Warmly,",
    "The Bloomjoy Sweets Team",
  ].join("\n");

  const brandDetails: RefundBrandDetail[] = details.map((detail) => {
    const [label, ...valueParts] = detail.split(": ");
    return { label, value: valueParts.join(": ") };
  });
  const html = renderBloomjoyRefundEmail({
    preheader: subject,
    eyebrow: "Bloomjoy refund request",
    headline: "One quick wallet detail check",
    greeting,
    paragraphs: [
      intro,
      "Enter only the virtual card's last four digits, your approximate purchase time, and confirmation of the amount.",
      "After you submit it, our system will automatically check the corrected details against the machine transactions.",
    ],
    details: brandDetails,
    primaryLink: { label: "Check my wallet details", url: correctionUrl },
    safetyLine:
      "Do not send a full card number, security code, expiration date, wallet password, or screenshot. This link expires in 48 hours and can be used once.",
  });

  return { subject, text, html };
};

export const sendRefundWalletCorrectionEmail = async (
  input: RefundWalletCorrectionEmailInput,
) => {
  const email = buildRefundWalletCorrectionEmail(input);
  const managerCcEmails = requireRefundManagerCcEmailsForSend(
    input.managerCcEmails,
    input.customerEmail,
    input.managerRecipientOverlap,
    input.managerRecipientCount,
  );
  const delivery = await sendRefundTransactionalEmail({
    to: [input.customerEmail],
    cc: managerCcEmails,
    subject: email.subject,
    text: email.text,
    html: email.html,
    idempotencyKey: input.idempotencyKey,
  });

  return { ...email, delivery };
};
