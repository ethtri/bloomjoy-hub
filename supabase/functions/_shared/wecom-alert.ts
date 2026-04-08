const WECOM_API_BASE_URL = "https://qyapi.weixin.qq.com/cgi-bin";
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const MAX_TEXT_CONTENT_LENGTH = 1800;
const TOKEN_RETRYABLE_ERROR_CODES = new Set([40014, 42001, 42007, 42009]);

let cachedAccessToken: { token: string; expiresAtMs: number } | null = null;
let hasWarnedMissingConfig = false;
let hasWarnedMissingRelayConfig = false;

const textEncoder = new TextEncoder();

type WeComConfig = {
  corpId: string;
  agentId: number;
  agentSecret: string;
  toUser: string;
};

type WeComRelayConfig = {
  url: string;
  hmacSecret: string;
};

type WeComApiResponse = {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
};

type WeComSendResponse = {
  ok: boolean;
  errCode: number;
  errMessage: string;
};

export type WeComAlertResult = {
  ok: boolean;
  skipped: boolean;
  message: string;
};

export type WeComAlertInput = {
  title: string;
  lines: string[];
  tag?: string;
};

const sanitize = (value: string | undefined | null) =>
  typeof value === "string" ? value.trim() : "";

const parseToUser = (value: string): string =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join("|");

const parseRelayUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

const hexEncode = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

const signRelayPayload = async (
  hmacSecret: string,
  timestamp: string,
  body: string
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(hmacSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(`${timestamp}.${body}`)
  );

  return hexEncode(signature);
};

const getRelayConfig = (): WeComRelayConfig | null => {
  const relayUrlRaw = sanitize(Deno.env.get("WECOM_RELAY_URL"));
  const relaySecret = sanitize(Deno.env.get("WECOM_RELAY_HMAC_SECRET"));

  if (!relayUrlRaw && !relaySecret) {
    return null;
  }

  if (!relayUrlRaw || !relaySecret) {
    if (!hasWarnedMissingRelayConfig) {
      console.warn(
        "WeCom relay is partially configured. Set both WECOM_RELAY_URL and WECOM_RELAY_HMAC_SECRET."
      );
      hasWarnedMissingRelayConfig = true;
    }
    return null;
  }

  const relayUrl = parseRelayUrl(relayUrlRaw);
  if (!relayUrl) {
    if (!hasWarnedMissingRelayConfig) {
      console.warn("WECOM_RELAY_URL must be a valid absolute http(s) URL.");
      hasWarnedMissingRelayConfig = true;
    }
    return null;
  }

  return {
    url: relayUrl,
    hmacSecret: relaySecret,
  };
};

const getDirectConfig = (): WeComConfig | null => {
  const corpId = sanitize(Deno.env.get("WECOM_CORP_ID"));
  const agentIdRaw = sanitize(Deno.env.get("WECOM_AGENT_ID"));
  const agentSecret = sanitize(Deno.env.get("WECOM_AGENT_SECRET"));
  const toUserRaw = sanitize(Deno.env.get("WECOM_ALERT_TO_USERIDS"));

  if (!corpId || !agentIdRaw || !agentSecret || !toUserRaw) {
    if (!hasWarnedMissingConfig) {
      console.warn(
        "WeCom alerting is disabled: missing one or more WECOM_* env vars."
      );
      hasWarnedMissingConfig = true;
    }
    return null;
  }

  const agentId = Number(agentIdRaw);
  if (!Number.isFinite(agentId)) {
    console.warn("WECOM_AGENT_ID must be a numeric value.");
    return null;
  }

  const toUser = parseToUser(toUserRaw);
  if (!toUser) {
    console.warn("WECOM_ALERT_TO_USERIDS did not contain any valid user IDs.");
    return null;
  }

  return {
    corpId,
    agentId,
    agentSecret,
    toUser,
  };
};

const buildContent = ({ title, lines, tag }: WeComAlertInput): string => {
  const header = tag ? `[${tag}] ${title}` : title;
  const content = [header, ...lines.filter(Boolean)].join("\n");

  if (content.length <= MAX_TEXT_CONTENT_LENGTH) {
    return content;
  }

  return `${content.slice(0, MAX_TEXT_CONTENT_LENGTH - 3)}...`;
};

const hasValidCachedToken = (): boolean =>
  !!cachedAccessToken &&
  Date.now() + ACCESS_TOKEN_REFRESH_BUFFER_MS < cachedAccessToken.expiresAtMs;

const fetchAccessToken = async (config: WeComConfig): Promise<string> => {
  const params = new URLSearchParams({
    corpid: config.corpId,
    corpsecret: config.agentSecret,
  });

  const response = await fetch(`${WECOM_API_BASE_URL}/gettoken?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`WeCom gettoken request failed (${response.status}).`);
  }

  const payload = (await response.json()) as WeComApiResponse;
  const errCode = Number(payload.errcode ?? -1);
  if (errCode !== 0) {
    throw new Error(
      `WeCom gettoken failed (${errCode}): ${payload.errmsg ?? "Unknown error"}`
    );
  }

  const accessToken = sanitize(payload.access_token);
  const expiresIn = Number(payload.expires_in ?? 0);
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("WeCom gettoken response was missing token metadata.");
  }

  cachedAccessToken = {
    token: accessToken,
    expiresAtMs: Date.now() + expiresIn * 1000,
  };

  return accessToken;
};

const getAccessToken = async (
  config: WeComConfig,
  forceRefresh = false
): Promise<string> => {
  if (!forceRefresh && hasValidCachedToken() && cachedAccessToken) {
    return cachedAccessToken.token;
  }

  return fetchAccessToken(config);
};

const sendMessageWithToken = async (
  config: WeComConfig,
  accessToken: string,
  content: string
): Promise<WeComSendResponse> => {
  const response = await fetch(
    `${WECOM_API_BASE_URL}/message/send?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        touser: config.toUser,
        msgtype: "text",
        agentid: config.agentId,
        text: {
          content,
        },
        safe: 0,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`WeCom message send request failed (${response.status}).`);
  }

  const payload = (await response.json()) as WeComApiResponse;
  const errCode = Number(payload.errcode ?? -1);

  return {
    ok: errCode === 0,
    errCode,
    errMessage: payload.errmsg ?? "Unknown error",
  };
};

const sendAlertWithConfig = async (
  config: WeComConfig,
  input: WeComAlertInput
): Promise<void> => {
  const content = buildContent(input);

  let accessToken = await getAccessToken(config);
  let sendResult = await sendMessageWithToken(config, accessToken, content);

  if (!sendResult.ok && TOKEN_RETRYABLE_ERROR_CODES.has(sendResult.errCode)) {
    cachedAccessToken = null;
    accessToken = await getAccessToken(config, true);
    sendResult = await sendMessageWithToken(config, accessToken, content);
  }

  if (!sendResult.ok) {
    throw new Error(
      `WeCom message send failed (${sendResult.errCode}): ${sendResult.errMessage}`
    );
  }
};

const sendAlertViaRelay = async (
  relayConfig: WeComRelayConfig,
  input: WeComAlertInput
): Promise<void> => {
  const body = JSON.stringify(input);
  const timestamp = Date.now().toString();
  const signature = await signRelayPayload(
    relayConfig.hmacSecret,
    timestamp,
    body
  );

  const response = await fetch(relayConfig.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bloomjoy-Timestamp": timestamp,
      "X-Bloomjoy-Signature": signature,
    },
    body,
  });

  const responseText = await response.text();
  let responsePayload: { ok?: boolean; message?: string } | null = null;

  if (responseText) {
    try {
      responsePayload = JSON.parse(responseText) as {
        ok?: boolean;
        message?: string;
      };
    } catch {
      responsePayload = null;
    }
  }

  if (!response.ok) {
    throw new Error(
      responsePayload?.message
        ? `WeCom relay failed (${response.status}): ${responsePayload.message}`
        : `WeCom relay request failed (${response.status}).`
    );
  }

  if (responsePayload?.ok === false) {
    throw new Error(
      responsePayload.message || "WeCom relay reported an unknown failure."
    );
  }
};

export async function sendWeComAlert(input: WeComAlertInput): Promise<void> {
  const relayConfig = getRelayConfig();
  if (relayConfig) {
    await sendAlertViaRelay(relayConfig, input);
    return;
  }

  const directConfig = getDirectConfig();
  if (!directConfig) {
    throw new Error("WeCom alert configuration is missing.");
  }

  await sendAlertWithConfig(directConfig, input);
}

export async function sendWeComAlertResult(
  input: WeComAlertInput
): Promise<WeComAlertResult> {
  const relayConfig = getRelayConfig();
  const directConfig = relayConfig ? null : getDirectConfig();

  if (!relayConfig && !directConfig) {
    return {
      ok: false,
      skipped: true,
      message: "WeCom alert configuration is missing.",
    };
  }

  try {
    if (relayConfig) {
      await sendAlertViaRelay(relayConfig, input);
    } else if (directConfig) {
      await sendAlertWithConfig(directConfig, input);
    }
    return {
      ok: true,
      skipped: false,
      message: relayConfig ? "WeCom alert sent via relay." : "WeCom alert sent.",
    };
  } catch (error) {
    console.warn("WeCom alert send failed (non-blocking).", error);
    return {
      ok: false,
      skipped: false,
      message: error instanceof Error ? error.message : "Unknown WeCom alert failure.",
    };
  }
}

export async function sendWeComAlertSafe(input: WeComAlertInput): Promise<boolean> {
  const result = await sendWeComAlertResult(input);
  return result.ok;
}
