export const REFUND_QR_CLAIM_TTL_MINUTES = 30;

const opaqueTokenPattern = /^[A-Za-z0-9_-]{32,80}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

export const isRefundQrOpaqueToken = (value: string) =>
  opaqueTokenPattern.test(value) && !uuidPattern.test(value);

export const createRefundQrClaimToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
};

export const hashRefundQrClaimToken = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(`refund-qr-claim:${value}`),
  );

  return bytesToHex(new Uint8Array(digest));
};
