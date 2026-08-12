export type RefundManagerTotpErrorCode =
  | "configuration_missing"
  | "factor_required"
  | "factor_ambiguous"
  | "invalid_code"
  | "session_invalid"
  | "verification_failed"
  | "enrollment_closed";

export class RefundManagerTotpError extends Error {
  readonly status: number;
  readonly code: RefundManagerTotpErrorCode;

  constructor(message: string, status: number, code: RefundManagerTotpErrorCode) {
    super(message);
    this.name = "RefundManagerTotpError";
    this.status = status;
    this.code = code;
  }
}

type FetchLike = typeof fetch;

type AuthFactor = {
  id?: unknown;
  factor_type?: unknown;
  status?: unknown;
};

type AuthUserResponse = {
  factors?: AuthFactor[];
};

type AuthSessionResponse = {
  access_token?: unknown;
};

const factorBindingDomain = "bloomjoy-refund-manager-totp-factor-v1\0";

export const refundManagerTotpFactorBindingHash = async (factorId: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${factorBindingDomain}${factorId}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
};

const safeJson = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    const value = await response.json();
    return value && typeof value === "object"
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

const authRequest = async ({
  supabaseUrl,
  supabaseAnonKey,
  accessToken,
  path,
  method = "GET",
  body,
  fetchImpl = fetch,
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  path: string;
  method?: "GET" | "POST" | "DELETE";
  body?: Record<string, unknown>;
  fetchImpl?: FetchLike;
}) => {
  const response = await fetchImpl(`${supabaseUrl}/auth/v1${path}`, {
    method,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { response, data: await safeJson(response) };
};

const listFactors = async ({
  supabaseUrl,
  supabaseAnonKey,
  accessToken,
  fetchImpl,
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}) => {
  const { response, data } = await authRequest({
    supabaseUrl,
    supabaseAnonKey,
    accessToken,
    path: "/user",
    fetchImpl,
  });
  if (!response.ok) {
    throw new RefundManagerTotpError(
      "Your sign-in session expired. Sign in again before authorizing this action.",
      401,
      "session_invalid",
    );
  }
  return Array.isArray((data as AuthUserResponse).factors)
    ? (data as AuthUserResponse).factors ?? []
    : [];
};

const onlyTotpFactorId = (
  factors: AuthFactor[],
  status: "verified" | "unverified",
) => {
  const matches = factors.filter((factor) =>
    factor.factor_type === "totp" &&
    factor.status === status &&
    typeof factor.id === "string" &&
    factor.id.length > 0
  );
  if (matches.length === 0) {
    throw new RefundManagerTotpError(
      status === "verified"
        ? "A verified authenticator is required. Ask the owner to schedule a supervised enrollment session."
        : "No supervised authenticator enrollment is waiting for verification.",
      409,
      "factor_required",
    );
  }
  if (matches.length !== 1) {
    throw new RefundManagerTotpError(
      "Authenticator setup needs owner review before official actions can continue.",
      409,
      "factor_ambiguous",
    );
  }
  return matches[0].id as string;
};

export const removeRefundManagerTotpFactor = async ({
  supabaseUrl,
  supabaseAnonKey,
  accessToken,
  factorId,
  fetchImpl,
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  factorId: string;
  fetchImpl?: FetchLike;
}) => {
  const removal = await authRequest({
    supabaseUrl,
    supabaseAnonKey,
    accessToken,
    path: `/factors/${encodeURIComponent(factorId)}`,
    method: "DELETE",
    fetchImpl,
  });
  if (!removal.response.ok) {
    throw new RefundManagerTotpError(
      "The authenticator setup could not be removed. Ask the owner to review the account factors.",
      409,
      "verification_failed",
    );
  }
};

export const bestEffortCompensateRefundManagerTotpEnrollment = async ({
  supabaseUrl,
  supabaseAnonKey,
  verifiedAccessToken,
  factorId,
  factorBindingHash,
  compensateDurableState,
  fetchImpl,
}: {
  supabaseUrl: string | undefined;
  supabaseAnonKey: string | undefined;
  verifiedAccessToken: string;
  factorId: string;
  factorBindingHash: string;
  compensateDurableState: (factorBindingHash: string) => Promise<void>;
  fetchImpl?: FetchLike;
}) => {
  let durableCompensated = false;
  let factorRemoved = false;
  try {
    await compensateDurableState(factorBindingHash);
    durableCompensated = true;
  } catch {
    // The active durable row remains the true gate and is checked at consumption.
  }
  if (supabaseUrl && supabaseAnonKey) {
    try {
      await removeRefundManagerTotpFactor({
        supabaseUrl,
        supabaseAnonKey,
        accessToken: verifiedAccessToken,
        factorId,
        fetchImpl,
      });
      factorRemoved = true;
    } catch {
      // A remaining Auth factor is not sufficient without its durable approval.
    }
  }
  return { durableCompensated, factorRemoved };
};

const verifyFactor = async ({
  supabaseUrl,
  supabaseAnonKey,
  accessToken,
  factorId,
  code,
  fetchImpl,
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  factorId: string;
  code: string;
  fetchImpl?: FetchLike;
}) => {
  const challenge = await authRequest({
    supabaseUrl,
    supabaseAnonKey,
    accessToken,
    path: `/factors/${encodeURIComponent(factorId)}/challenge`,
    method: "POST",
    body: {},
    fetchImpl,
  });
  const challengeId = typeof challenge.data.id === "string"
    ? challenge.data.id
    : "";
  if (!challenge.response.ok || !challengeId) {
    throw new RefundManagerTotpError(
      "The authenticator challenge could not be started. Review the action and try again.",
      409,
      "verification_failed",
    );
  }

  const verification = await authRequest({
    supabaseUrl,
    supabaseAnonKey,
    accessToken,
    path: `/factors/${encodeURIComponent(factorId)}/verify`,
    method: "POST",
    body: { challenge_id: challengeId, code },
    fetchImpl,
  });
  const verifiedAccessToken = typeof (verification.data as AuthSessionResponse).access_token ===
      "string"
    ? (verification.data as AuthSessionResponse).access_token as string
    : "";
  if (!verification.response.ok || !verifiedAccessToken) {
    throw new RefundManagerTotpError(
      "That code was not accepted. Use the current six-digit code from your authenticator.",
      400,
      "invalid_code",
    );
  }
  return verifiedAccessToken;
};

export const verifyRefundManagerTotp = async ({
  supabaseUrl,
  supabaseAnonKey,
  accessToken,
  code,
  fetchImpl,
}: {
  supabaseUrl: string | undefined;
  supabaseAnonKey: string | undefined;
  accessToken: string;
  code: string;
  fetchImpl?: FetchLike;
}) => {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new RefundManagerTotpError(
      "Manager authenticator verification is not configured.",
      500,
      "configuration_missing",
    );
  }
  if (!/^\d{6}$/.test(code)) {
    throw new RefundManagerTotpError(
      "Enter the current six-digit code from your authenticator.",
      400,
      "invalid_code",
    );
  }

  const factors = await listFactors({
    supabaseUrl,
    supabaseAnonKey,
    accessToken,
    fetchImpl,
  });
  const factorId = onlyTotpFactorId(factors, "verified");
  const factorBindingHash = await refundManagerTotpFactorBindingHash(factorId);
  const verifiedAccessToken = await verifyFactor({
    supabaseUrl,
    supabaseAnonKey,
    accessToken,
    factorId,
    code,
    fetchImpl,
  });
  return { accessToken: verifiedAccessToken, factorBindingHash };
};

export const beginRefundManagerTotpEnrollment = async ({
  supabaseUrl,
  supabaseAnonKey,
  accessToken,
  fetchImpl,
}: {
  supabaseUrl: string | undefined;
  supabaseAnonKey: string | undefined;
  accessToken: string;
  fetchImpl?: FetchLike;
}) => {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new RefundManagerTotpError(
      "Manager authenticator enrollment is not configured.",
      500,
      "configuration_missing",
    );
  }
  const factors = await listFactors({
    supabaseUrl,
    supabaseAnonKey,
    accessToken,
    fetchImpl,
  });
  if (factors.some((factor) =>
    factor.factor_type === "totp" && factor.status === "verified"
  )) {
    throw new RefundManagerTotpError(
      "A verified authenticator is already enrolled for this account.",
      409,
      "factor_ambiguous",
    );
  }
  const unfinishedFactorIds = factors
    .filter((factor) =>
      factor.factor_type === "totp" &&
      factor.status === "unverified" &&
      typeof factor.id === "string" &&
      factor.id.length > 0
    )
    .map((factor) => factor.id as string);
  if (unfinishedFactorIds.length > 1) {
    throw new RefundManagerTotpError(
      "Authenticator setup needs owner review before enrollment can continue.",
      409,
      "factor_ambiguous",
    );
  }
  if (unfinishedFactorIds.length === 1) {
    await removeRefundManagerTotpFactor({
      supabaseUrl,
      supabaseAnonKey,
      accessToken,
      factorId: unfinishedFactorIds[0],
      fetchImpl,
    });
  }

  const enrollment = await authRequest({
    supabaseUrl,
    supabaseAnonKey,
    accessToken,
    path: "/factors",
    method: "POST",
    body: {
      factor_type: "totp",
      friendly_name: "Bloomjoy refund actions",
      issuer: "Bloomjoy",
    },
    fetchImpl,
  });
  const totp = enrollment.data.totp && typeof enrollment.data.totp === "object"
    ? enrollment.data.totp as Record<string, unknown>
    : {};
  const qrCode = typeof totp.qr_code === "string" ? totp.qr_code : "";
  if (!enrollment.response.ok || !qrCode) {
    throw new RefundManagerTotpError(
      "The owner-controlled enrollment window is closed.",
      403,
      "enrollment_closed",
    );
  }
  return {
    qrCode: qrCode.startsWith("data:image/")
      ? qrCode
      : `data:image/svg+xml;utf-8,${qrCode}`,
  };
};

export const cancelRefundManagerTotpEnrollment = async ({
  supabaseUrl,
  supabaseAnonKey,
  accessToken,
  fetchImpl,
}: {
  supabaseUrl: string | undefined;
  supabaseAnonKey: string | undefined;
  accessToken: string;
  fetchImpl?: FetchLike;
}) => {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new RefundManagerTotpError(
      "Manager authenticator enrollment is not configured.",
      500,
      "configuration_missing",
    );
  }
  const factors = await listFactors({
    supabaseUrl,
    supabaseAnonKey,
    accessToken,
    fetchImpl,
  });
  const unfinishedFactorIds = factors
    .filter((factor) =>
      factor.factor_type === "totp" &&
      factor.status === "unverified" &&
      typeof factor.id === "string" &&
      factor.id.length > 0
    )
    .map((factor) => factor.id as string);
  if (unfinishedFactorIds.length === 0) return { cancelled: false };
  if (unfinishedFactorIds.length !== 1) {
    throw new RefundManagerTotpError(
      "Authenticator setup needs owner review before enrollment can be cancelled.",
      409,
      "factor_ambiguous",
    );
  }
  await removeRefundManagerTotpFactor({
    supabaseUrl,
    supabaseAnonKey,
    accessToken,
    factorId: unfinishedFactorIds[0],
    fetchImpl,
  });
  return { cancelled: true };
};

export const verifyRefundManagerTotpEnrollment = async ({
  supabaseUrl,
  supabaseAnonKey,
  accessToken,
  code,
  fetchImpl,
}: {
  supabaseUrl: string | undefined;
  supabaseAnonKey: string | undefined;
  accessToken: string;
  code: string;
  fetchImpl?: FetchLike;
}) => {
  if (!supabaseUrl || !supabaseAnonKey || !/^\d{6}$/.test(code)) {
    throw new RefundManagerTotpError(
      "Enter the current six-digit code from the newly enrolled authenticator.",
      400,
      "invalid_code",
    );
  }
  const factors = await listFactors({
    supabaseUrl,
    supabaseAnonKey,
    accessToken,
    fetchImpl,
  });
  if (factors.some((factor) =>
    factor.factor_type === "totp" && factor.status === "verified"
  )) {
    throw new RefundManagerTotpError(
      "A verified authenticator is already enrolled for this account.",
      409,
      "factor_ambiguous",
    );
  }
  const factorId = onlyTotpFactorId(factors, "unverified");
  const factorBindingHash = await refundManagerTotpFactorBindingHash(factorId);
  const verifiedAccessToken = await verifyFactor({
    supabaseUrl,
    supabaseAnonKey,
    accessToken,
    factorId,
    code,
    fetchImpl,
  });
  return {
    accessToken: verifiedAccessToken,
    factorId,
    factorBindingHash,
  };
};
