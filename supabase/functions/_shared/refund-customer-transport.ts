export const REFUND_CUSTOMER_SENDER_NAME = "Bloomjoy Refunds";
export const REFUND_CUSTOMER_FROM_EMAIL = "info@bloomjoysweets.com";
export const REFUND_MONITORED_REPLY_TO_EMAIL = "info@bloomjoysweets.com";

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export const extractConfiguredEmailAddress = (value: string) => {
  const normalized = value.trim();
  const bracketed = normalized.match(/<([^<>]+)>$/);
  const address = (bracketed?.[1] ?? normalized).trim().toLowerCase();
  if (!EMAIL_PATTERN.test(address) || /[\r\n]/.test(normalized)) {
    throw new Error("Configured email sender is invalid.");
  }
  return address;
};

export const requireRefundOfficialSender = (configuredSender: string) => {
  let address = "";
  try {
    address = extractConfiguredEmailAddress(configuredSender);
  } catch {
    throw new Error(
      "Refund customer email requires the approved Bloomjoy support sender.",
    );
  }
  if (address !== REFUND_CUSTOMER_FROM_EMAIL) {
    throw new Error(
      "Refund customer email requires the approved Bloomjoy support sender.",
    );
  }
  return address;
};

export const formatRefundCustomerSender = (configuredSender: string) =>
  `${REFUND_CUSTOMER_SENDER_NAME} <${
    requireRefundOfficialSender(configuredSender)
  }>`;
