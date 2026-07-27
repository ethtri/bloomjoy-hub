export const REFUND_WALLET_CORRECTION_TTL_HOURS = 48;
export const REFUND_WALLET_CORRECTION_MAX_LINKS = 2;

const opaqueTokenPattern = /^[A-Za-z0-9_-]{40,80}$/;
const textEncoder = new TextEncoder();

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
};

export const isRefundWalletCorrectionToken = (value: string) =>
  opaqueTokenPattern.test(value);

export const createRefundWalletCorrectionToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
};

export const hashRefundWalletCorrectionToken = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(`refund-wallet-correction:${value}`),
  );

  return bytesToHex(new Uint8Array(digest));
};

export const getRefundWalletCorrectionExpiry = (now = new Date()) =>
  new Date(
    now.getTime() + REFUND_WALLET_CORRECTION_TTL_HOURS * 60 * 60 * 1000,
  );
