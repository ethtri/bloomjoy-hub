export type PublicIntakeEventScope = "submission" | "notification";
export type PublicIntakeKeyType = "ip" | "email" | "source" | "global";

type RpcResult<T> = {
  data: T | null;
  error: { message?: string; code?: string } | null;
};

export type PublicIntakeAbuseSupabaseClient = {
  rpc: <T = unknown>(
    functionName: string,
    params: Record<string, unknown>,
  ) => Promise<RpcResult<T>>;
};

export type PublicIntakeLimitRule = {
  eventScope: PublicIntakeEventScope;
  keyType: PublicIntakeKeyType;
  maxCount: number;
  windowSeconds: number;
};

export type PublicIntakeRateLimitResult = {
  allowed: boolean;
  failedOpen: boolean;
  reason?: {
    eventScope: PublicIntakeEventScope;
    keyType: PublicIntakeKeyType;
    maxCount: number;
    windowSeconds: number;
  };
};

export type PublicIntakeKeyHashes = Record<PublicIntakeKeyType, string>;

export const PUBLIC_INTAKE_DEDUPE_WINDOW_SECONDS = 30 * 60;
export const PUBLIC_INTAKE_MAX_REQUEST_BYTES = 20_000;

export const PUBLIC_INTAKE_SUBMISSION_LIMITS: PublicIntakeLimitRule[] = [
  {
    eventScope: "submission",
    keyType: "global",
    maxCount: 300,
    windowSeconds: 60 * 60,
  },
  {
    eventScope: "submission",
    keyType: "ip",
    maxCount: 30,
    windowSeconds: 60 * 60,
  },
  {
    eventScope: "submission",
    keyType: "email",
    maxCount: 5,
    windowSeconds: 60 * 60,
  },
  {
    eventScope: "submission",
    keyType: "source",
    maxCount: 200,
    windowSeconds: 60 * 60,
  },
];

export const PUBLIC_INTAKE_NOTIFICATION_LIMITS: PublicIntakeLimitRule[] = [
  {
    eventScope: "notification",
    keyType: "global",
    maxCount: 50,
    windowSeconds: 60 * 60,
  },
  {
    eventScope: "notification",
    keyType: "ip",
    maxCount: 10,
    windowSeconds: 60 * 60,
  },
  {
    eventScope: "notification",
    keyType: "email",
    maxCount: 3,
    windowSeconds: 60 * 60,
  },
  {
    eventScope: "notification",
    keyType: "source",
    maxCount: 50,
    windowSeconds: 60 * 60,
  },
];

const textEncoder = new TextEncoder();

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const normalizeHashValue = (value: string): string =>
  value.trim().toLowerCase();

export const getPublicIntakeWindowStart = (
  date: Date,
  windowSeconds: number,
): Date => {
  const epochSeconds = Math.floor(date.getTime() / 1000);
  const windowStartSeconds = Math.floor(epochSeconds / windowSeconds) *
    windowSeconds;
  return new Date(windowStartSeconds * 1000);
};

export const sanitizePublicIntakeSourcePage = (sourcePage: string): string => {
  const trimmed = sourcePage.trim();
  if (!trimmed) return "/contact";

  try {
    const url = new URL(trimmed, "https://bloomjoy.local");
    const normalizedPath = `${url.pathname || "/"}${url.search || ""}`;
    return normalizedPath.slice(0, 300);
  } catch {
    return trimmed.slice(0, 300);
  }
};

export const normalizePublicIntakeSource = (sourcePage: string): string => {
  const sanitized = sanitizePublicIntakeSourcePage(sourcePage);
  const path = sanitized.split("?")[0]?.toLowerCase() || "/contact";

  if (path === "/" || path === "/contact") return path;
  if (path.startsWith("/supplies")) return "/supplies";
  if (path.startsWith("/machines") || path.startsWith("/products")) {
    return "/machines";
  }
  if (path.startsWith("/plus")) return "/plus";
  if (path.startsWith("/resources")) return "/resources";
  if (path.startsWith("/about")) return "/about";

  return "unknown";
};

export const getPublicIntakeClientIp = (req: Request): string => {
  const directHeader = req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    req.headers.get("fly-client-ip") ||
    "";
  const forwardedFor = req.headers.get("x-forwarded-for") || "";
  const candidate = directHeader || forwardedFor.split(",")[0] || "unknown";
  return candidate.trim() || "unknown";
};

export const hashPublicIntakeValue = async ({
  salt,
  purpose,
  value,
}: {
  salt: string;
  purpose: string;
  value: string;
}): Promise<string> => {
  const normalizedValue = normalizeHashValue(value);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(`${purpose}:${salt}:${normalizedValue}`),
  );
  return bytesToHex(new Uint8Array(digest));
};

export const buildPublicIntakeKeyHashes = async ({
  salt,
  ip,
  email,
  sourcePage,
}: {
  salt: string;
  ip: string;
  email: string;
  sourcePage: string;
}): Promise<PublicIntakeKeyHashes> => ({
  global: await hashPublicIntakeValue({
    salt,
    purpose: "public-intake:global",
    value: "lead-submission-intake",
  }),
  ip: await hashPublicIntakeValue({
    salt,
    purpose: "public-intake:ip",
    value: ip,
  }),
  email: await hashPublicIntakeValue({
    salt,
    purpose: "public-intake:email",
    value: email,
  }),
  source: await hashPublicIntakeValue({
    salt,
    purpose: "public-intake:source",
    value: normalizePublicIntakeSource(sourcePage),
  }),
});

export const buildPublicIntakeDedupeKey = async ({
  salt,
  submissionType,
  email,
  sourcePage,
  message,
  windowStartedAt,
}: {
  salt: string;
  submissionType: string;
  email: string;
  sourcePage: string;
  message: string;
  windowStartedAt: Date;
}): Promise<string> =>
  await hashPublicIntakeValue({
    salt,
    purpose: "public-intake:dedupe",
    value: [
      submissionType.trim().toLowerCase(),
      email.trim().toLowerCase(),
      normalizePublicIntakeSource(sourcePage),
      message.trim().replace(/\s+/g, " "),
      windowStartedAt.toISOString(),
    ].join("|"),
  });

const recordPublicIntakeRateLimitEvent = async (
  supabase: PublicIntakeAbuseSupabaseClient,
  rule: PublicIntakeLimitRule,
  keyHash: string,
): Promise<number | null> => {
  const { data, error } = await supabase.rpc<number>(
    "record_public_intake_rate_limit_event",
    {
      p_event_scope: rule.eventScope,
      p_key_type: rule.keyType,
      p_key_hash: keyHash,
      p_window_seconds: rule.windowSeconds,
    },
  );

  if (error) {
    console.warn("Public intake rate-limit check failed open.", {
      eventScope: rule.eventScope,
      keyType: rule.keyType,
      errorCode: error.code,
      errorMessage: error.message,
    });
    return null;
  }

  return typeof data === "number" ? data : null;
};

export const checkPublicIntakeRateLimits = async ({
  supabase,
  keyHashes,
  rules,
}: {
  supabase: PublicIntakeAbuseSupabaseClient;
  keyHashes: PublicIntakeKeyHashes;
  rules: PublicIntakeLimitRule[];
}): Promise<PublicIntakeRateLimitResult> => {
  let failedOpen = false;

  for (const rule of rules) {
    const count = await recordPublicIntakeRateLimitEvent(
      supabase,
      rule,
      keyHashes[rule.keyType],
    );

    if (count === null) {
      failedOpen = true;
      continue;
    }

    if (count > rule.maxCount) {
      return {
        allowed: false,
        failedOpen,
        reason: {
          eventScope: rule.eventScope,
          keyType: rule.keyType,
          maxCount: rule.maxCount,
          windowSeconds: rule.windowSeconds,
        },
      };
    }
  }

  return { allowed: true, failedOpen };
};
