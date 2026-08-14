import {
  type GmailMessage,
  getGmailHeader,
  inspectRefundGmailParticipantSignals,
  parseEmailAddressList,
  type RefundGmailConfig,
  RefundGmailError,
  sha256Hex,
} from "../_shared/refund-gmail.ts";
import type { RefundFirstContactConfig } from "../_shared/refund-first-contact.ts";

export const REFUND_GMAIL_INTAKE_SHADOW_TRIGGER = "intake_shadow";
export const REFUND_GMAIL_INTAKE_SHADOW_MAX_THREADS = 1;
export const REFUND_GMAIL_INTAKE_SHADOW_LIST_LIMIT = 2;
export const REFUND_GMAIL_INTAKE_SHADOW_ZERO_DIGEST = "0".repeat(64);
export const REFUND_GMAIL_INTAKE_SHADOW_RETENTION_POLICY_VERSION =
  "refund_gmail_retention_v1";

const GMAIL_API_ROOT = "https://gmail.googleapis.com/gmail/v1/users/me";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const REQUEST_TIMEOUT_MS = 20_000;
const LABEL_ID_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;

export type RefundGmailIntakeShadowConfig = {
  active: true;
  shadowLabelId: string;
  ownerSenderDigest: string;
  runKeyDigest: string;
  startAt: Date;
  maxThreads: 1;
};

export class RefundGmailIntakeShadowError extends RefundGmailError {
  constructor(code: string) {
    super(code, "Refund Gmail intake-only shadow mode failed closed.");
    this.name = "RefundGmailIntakeShadowError";
  }
}

const fail = (code: string): never => {
  throw new RefundGmailIntakeShadowError(code);
};

const exactBoolean = (value: string | undefined) => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false" || normalized === "") return false;
  fail("gmail_intake_shadow_gate_invalid");
};

const requireExactEnvBoolean = (
  readEnv: (name: string) => string | undefined,
  name: string,
  expected: boolean,
) => {
  const value = exactBoolean(readEnv(name));
  if (value !== expected) fail("gmail_intake_shadow_hard_off_invalid");
};

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export const constantTimeDigestEqual = (left: string, right: string) => {
  if (!DIGEST_PATTERN.test(left) || !DIGEST_PATTERN.test(right)) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

export const validateRefundGmailIntakeShadowRuntime = async ({
  intake,
  config,
  firstContact,
  runKey,
}: {
  intake: RefundGmailIntakeShadowConfig;
  config: RefundGmailConfig | null;
  firstContact: RefundFirstContactConfig;
  runKey: string;
}) => {
  if (
    !config || firstContact.mode !== "shadow" ||
    firstContact.shouldClaim !== true || firstContact.shouldSend !== false ||
    firstContact.errorCode !== null ||
    !constantTimeDigestEqual(await sha256Hex(runKey), intake.runKeyDigest)
  ) {
    fail("gmail_intake_shadow_pure_preflight_failed");
  }
  return config;
};

export const validateRefundGmailIntakeShadowThread = async ({
  messages,
  config,
  intake,
  nowMs = Date.now(),
}: {
  messages: GmailMessage[];
  config: RefundGmailConfig;
  intake: RefundGmailIntakeShadowConfig;
  nowMs?: number;
}) => {
  if (messages.length !== 2 || !Number.isFinite(nowMs)) {
    fail("gmail_intake_shadow_thread_shape_invalid");
  }
  let ownerInbound: { email: string; receivedAtMs: number } | null = null;
  let mailboxAcknowledgement: { receivedAtMs: number; to: string[] } | null =
    null;
  for (const message of messages) {
    const signals = inspectRefundGmailParticipantSignals({
      message,
      mailboxIdentities: config.mailboxIdentities,
    });
    const messageTime = Number(message.internalDate ?? 0);
    const bccEmails = parseEmailAddressList(
      getGmailHeader(message.payload?.headers, "Bcc"),
    );
    if (
      !signals.mailboxOrigin && !signals.providerSentEvidence &&
      signals.participantTrust === "direct_human" &&
      !signals.isAutomated && Boolean(signals.from.email) &&
      Number.isFinite(messageTime) &&
      messageTime >= config.startAt.getTime() &&
      messageTime <= nowMs + 30 * 1000 &&
      signals.toEmails.length === 1 &&
      signals.toEmails[0] === config.mailbox &&
      signals.ccEmails.length === 0 && bccEmails.length === 0 &&
      constantTimeDigestEqual(
        await sha256Hex(signals.from.email.trim().toLowerCase()),
        intake.ownerSenderDigest,
      )
    ) {
      if (ownerInbound) fail("gmail_intake_shadow_thread_shape_invalid");
      ownerInbound = {
        email: signals.from.email,
        receivedAtMs: messageTime,
      };
      continue;
    }
    if (
      signals.mailboxOrigin && signals.providerSentEvidence &&
      Number.isFinite(messageTime) && messageTime > 0 &&
      messageTime <= nowMs + 30 * 1000 &&
      signals.toEmails.length === 1 &&
      signals.ccEmails.length === 0 && bccEmails.length === 0
    ) {
      if (mailboxAcknowledgement) {
        fail("gmail_intake_shadow_thread_shape_invalid");
      }
      mailboxAcknowledgement = {
        receivedAtMs: messageTime,
        to: signals.toEmails,
      };
      continue;
    }
    fail("gmail_intake_shadow_thread_shape_invalid");
  }
  if (
    !ownerInbound || !mailboxAcknowledgement ||
    mailboxAcknowledgement.receivedAtMs <= ownerInbound.receivedAtMs ||
    mailboxAcknowledgement.to[0] !== ownerInbound.email
  ) {
    fail("gmail_intake_shadow_thread_shape_invalid");
  }
  return {
    customerInboundMessages: 1,
    providerSentMailboxMessages: 1,
    mailboxAcknowledgementObserved: true,
  };
};

export const isRefundGmailIntakeShadowRunKey = (
  runKey: string,
  trigger: string,
) =>
  trigger === REFUND_GMAIL_INTAKE_SHADOW_TRIGGER &&
  /^owner-intake-shadow:[a-f0-9]{64}$/.test(runKey);

export const resolveRefundGmailIntakeShadowConfig = ({
  trigger,
  readEnv = (name: string) => Deno.env.get(name),
  nowMs = Date.now(),
}: {
  trigger: string;
  readEnv?: (name: string) => string | undefined;
  nowMs?: number;
}): RefundGmailIntakeShadowConfig | null => {
  const intakeEnabled = exactBoolean(readEnv("REFUND_GMAIL_INTAKE_ENABLED"));
  if (trigger !== REFUND_GMAIL_INTAKE_SHADOW_TRIGGER) {
    if (intakeEnabled) fail("gmail_intake_shadow_trigger_required");
    return null;
  }
  if (!intakeEnabled) fail("gmail_intake_shadow_disabled");
  if (exactBoolean(readEnv("REFUND_GMAIL_ENABLED"))) {
    fail("gmail_delivery_gate_must_remain_disabled");
  }
  if (
    (readEnv("REFUND_GMAIL_FIRST_CONTACT_MODE") ?? "").trim().toLowerCase() !==
      "shadow"
  ) {
    fail("gmail_intake_shadow_mode_required");
  }

  const startAtValue = (readEnv("GMAIL_REFUND_START_AT") ?? "").trim();
  const startAt = new Date(startAtValue);
  if (
    !startAtValue || !Number.isFinite(startAt.getTime()) ||
    !Number.isFinite(nowMs) ||
    startAt.getTime() < nowMs - 15 * 60 * 1000 ||
    startAt.getTime() > nowMs + 30 * 1000
  ) {
    fail("gmail_intake_shadow_start_required");
  }
  if ((readEnv("GMAIL_REFUND_MAX_THREADS_PER_RUN") ?? "").trim() !== "1") {
    fail("gmail_intake_shadow_max_threads_invalid");
  }

  requireExactEnvBoolean(readEnv, "REFUND_GMAIL_RETENTION_ENABLED", false);
  for (
    const name of [
      "REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED",
      "REFUND_AUTOMATION_ENABLED",
      "REFUND_MANAGER_AGING_NOTICES_ENABLED",
      "REFUND_GMAIL_ATTACHMENT_SCANNER_ENABLED",
      "REFUND_GPT_TRIAGE_ENABLED",
      "NAYAX_REFUND_EXECUTION_ENABLED",
      "NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED",
      "NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO",
    ]
  ) {
    requireExactEnvBoolean(readEnv, name, false);
  }
  requireExactEnvBoolean(readEnv, "NAYAX_REFUND_EXECUTION_DRY_RUN", true);
  requireExactEnvBoolean(readEnv, "NAYAX_REFUND_EXECUTION_KILL_SWITCH", true);
  if (
    (readEnv("REFUND_GMAIL_RETENTION_POLICY_VERSION") ?? "").trim() !==
      REFUND_GMAIL_INTAKE_SHADOW_RETENTION_POLICY_VERSION
  ) {
    fail("gmail_intake_shadow_retention_policy_invalid");
  }

  const productionLabel = (readEnv("GMAIL_REFUND_LABEL_ID") ?? "").trim();
  const shadowLabelId = (readEnv("GMAIL_REFUND_INTAKE_SHADOW_LABEL_ID") ?? "")
    .trim();
  if (
    !LABEL_ID_PATTERN.test(productionLabel) ||
    !LABEL_ID_PATTERN.test(shadowLabelId) ||
    shadowLabelId === productionLabel
  ) {
    fail("gmail_intake_shadow_label_invalid");
  }

  const ownerSenderDigest = (
    readEnv("REFUND_GMAIL_INTAKE_SHADOW_OWNER_SENDER_SHA256") ?? ""
  ).trim().toLowerCase();
  const runKeyDigest = (
    readEnv("REFUND_GMAIL_INTAKE_SHADOW_RUN_KEY_SHA256") ?? ""
  ).trim().toLowerCase();
  if (
    !DIGEST_PATTERN.test(ownerSenderDigest) ||
    !DIGEST_PATTERN.test(runKeyDigest) ||
    ownerSenderDigest === REFUND_GMAIL_INTAKE_SHADOW_ZERO_DIGEST ||
    runKeyDigest === REFUND_GMAIL_INTAKE_SHADOW_ZERO_DIGEST
  ) {
    fail("gmail_intake_shadow_authorization_digest_invalid");
  }

  return {
    active: true,
    shadowLabelId,
    ownerSenderDigest,
    runKeyDigest,
    startAt,
    maxThreads: REFUND_GMAIL_INTAKE_SHADOW_MAX_THREADS,
  };
};

const parseJson = async (response: Response, code: string) => {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return fail(code);
  }
};

const providerFetch = async (
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  code: string,
) => {
  try {
    return await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return fail(code);
  }
};

export type RefundGmailIntakeShadowThreadRef = {
  id: string;
  historyId?: string;
};

export const preflightRefundGmailIntakeShadowLabel = async ({
  config,
  fetchImpl = fetch,
}: {
  config: RefundGmailConfig;
  fetchImpl?: typeof fetch;
}): Promise<{
  profileHistoryId: string | null;
  thread: RefundGmailIntakeShadowThreadRef;
}> => {
  const tokenResponse = await providerFetch(
    fetchImpl,
    GOOGLE_TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token",
      }),
    },
    "gmail_intake_shadow_oauth_failed",
  );
  const tokenPayload = await parseJson(
    tokenResponse,
    "gmail_intake_shadow_oauth_failed",
  );
  const accessToken = typeof tokenPayload.access_token === "string"
    ? tokenPayload.access_token
    : "";
  if (!tokenResponse.ok || !accessToken) {
    fail("gmail_intake_shadow_oauth_failed");
  }

  const providerGet = async (path: string, code: string) => {
    const response = await providerFetch(
      fetchImpl,
      `${GMAIL_API_ROOT}${path}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      code,
    );
    if (!response.ok) fail(code);
    return await parseJson(response, code);
  };

  const profile = await providerGet(
    "/profile",
    "gmail_intake_shadow_profile_failed",
  );
  if (
    typeof profile.emailAddress !== "string" ||
    profile.emailAddress.trim().toLowerCase() !== config.mailbox
  ) {
    fail("gmail_intake_shadow_mailbox_mismatch");
  }

  const params = new URLSearchParams({
    labelIds: config.labelId,
    q: `after:${Math.floor(config.startAt.getTime() / 1000)}`,
    maxResults: String(REFUND_GMAIL_INTAKE_SHADOW_LIST_LIMIT),
  });
  const page = await providerGet(
    `/threads?${params.toString()}`,
    "gmail_intake_shadow_label_list_failed",
  );
  const threads = Array.isArray(page.threads) ? page.threads : [];
  if (threads.length !== 1 || typeof page.nextPageToken === "string") {
    fail("gmail_intake_shadow_label_cardinality_invalid");
  }
  const threadRecord = threads[0] as Record<string, unknown>;
  const id = typeof threadRecord?.id === "string" ? threadRecord.id.trim() : "";
  if (!id || id.length > 255) {
    fail("gmail_intake_shadow_thread_invalid");
  }

  return {
    profileHistoryId: typeof profile.historyId === "string"
      ? profile.historyId.slice(0, 255)
      : null,
    thread: {
      id,
      ...(typeof threadRecord.historyId === "string"
        ? { historyId: threadRecord.historyId.slice(0, 255) }
        : {}),
    },
  };
};
