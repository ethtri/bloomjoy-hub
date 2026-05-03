const allowedProductionOrigins = new Set([
  "https://www.bloomjoyusa.com",
  "https://app.bloomjoyusa.com",
]);

const allowedLocalHosts = new Set(["localhost", "127.0.0.1"]);
const allowedLocalProtocols = new Set(["http:", "https:"]);
const allowedPreviewProtocol = "https:";
const vercelPreviewHostnameSuffix = ".vercel.app";
const enabledEnvValues = new Set(["1", "true", "yes", "on"]);
const previewOriginsEnvKey = "BLOOMJOY_ALLOWED_VERCEL_PREVIEW_ORIGINS";

/**
 * @typedef {Object} BrowserUrlValidationOptions
 * @property {string} [label]
 * @property {string | null} [fallbackUrl]
 * @property {boolean} [allowLocalUrls]
 * @property {boolean} [allowConfiguredPreviewOrigins]
 * @property {string[]} [allowedPreviewOrigins]
 *
 * @typedef {Object} BrowserUrlValidationSuccess
 * @property {true} ok
 * @property {string} url
 * @property {boolean} isProductionOrigin
 * @property {boolean} isLocalOrigin
 * @property {boolean} isPreviewOrigin
 *
 * @typedef {Object} BrowserUrlValidationFailure
 * @property {false} ok
 * @property {string} error
 *
 * @typedef {BrowserUrlValidationSuccess | BrowserUrlValidationFailure} BrowserUrlValidationResult
 */

export const allowedBrowserUrlOrigins = Object.freeze([
  ...allowedProductionOrigins,
  "http://localhost:<port>",
  "https://localhost:<port>",
  "http://127.0.0.1:<port>",
  "https://127.0.0.1:<port>",
  "configured https://<exact-vercel-preview>.vercel.app origins",
]);

const getRuntimeEnv = (key) => {
  try {
    if (typeof Deno !== "undefined") {
      return Deno.env.get(key) ?? null;
    }
  } catch {
    // Fall through to process.env for Node-based validation scripts.
  }

  if (typeof process !== "undefined" && process?.env) {
    return process.env[key] ?? null;
  }

  return null;
};

const isEnabledEnvValue = (value) =>
  enabledEnvValues.has(String(value ?? "").trim().toLowerCase());

const parseCommaSeparatedValues = (value) =>
  String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const normalizePreviewOrigin = (value) => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== allowedPreviewProtocol ||
      url.username ||
      url.password ||
      !hostname.endsWith(vercelPreviewHostnameSuffix)
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
};

export const getAllowedPreviewOrigins = (configuredOrigins) =>
  new Set(
    (configuredOrigins ?? parseCommaSeparatedValues(getRuntimeEnv(previewOriginsEnvKey)))
      .map(normalizePreviewOrigin)
      .filter(Boolean),
  );

const isLocalSupabaseRuntime = () => {
  const supabaseUrl = getRuntimeEnv("SUPABASE_URL");
  if (!supabaseUrl) return false;

  try {
    const url = new URL(supabaseUrl);
    return allowedLocalHosts.has(url.hostname);
  } catch {
    return false;
  }
};

export const areLocalBrowserUrlsAllowed = () =>
  isEnabledEnvValue(getRuntimeEnv("BLOOMJOY_ALLOW_LOCAL_REDIRECT_URLS")) ||
  isLocalSupabaseRuntime();

/**
 * @param {unknown} value
 * @param {BrowserUrlValidationOptions} [options]
 * @returns {BrowserUrlValidationResult}
 */
export const validateBrowserUrl = (
  value,
  {
    label = "URL",
    fallbackUrl = null,
    allowLocalUrls,
    allowConfiguredPreviewOrigins = false,
    allowedPreviewOrigins,
  } = {},
) => {
  const raw = typeof value === "string" ? value.trim() : "";
  const candidate = raw || fallbackUrl;
  const localUrlsAreAllowed =
    typeof allowLocalUrls === "boolean" ? allowLocalUrls : areLocalBrowserUrlsAllowed();
  const previewOrigins = allowedPreviewOrigins || allowConfiguredPreviewOrigins
    ? getAllowedPreviewOrigins(allowedPreviewOrigins)
    : new Set();
  const previewUrlsAreAllowed = previewOrigins.size > 0;
  const allowedOriginDescription = localUrlsAreAllowed
    ? previewUrlsAreAllowed
      ? "a Bloomjoy production, localhost/127.0.0.1, or configured Vercel preview origin"
      : "a Bloomjoy production or localhost/127.0.0.1 origin"
    : previewUrlsAreAllowed
      ? "a Bloomjoy production or configured Vercel preview origin"
      : "a Bloomjoy production origin";

  if (!candidate) {
    return {
      ok: false,
      error: `${label} is required.`,
    };
  }

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return {
      ok: false,
      error: `${label} must be an absolute URL using ${allowedOriginDescription}.`,
    };
  }

  if (url.username || url.password) {
    return {
      ok: false,
      error: `${label} must not include embedded credentials.`,
    };
  }

  const isProductionOrigin = allowedProductionOrigins.has(url.origin);
  const isLocalOrigin =
    localUrlsAreAllowed &&
    allowedLocalHosts.has(url.hostname) &&
    allowedLocalProtocols.has(url.protocol);
  const isPreviewOrigin = previewOrigins.has(url.origin);

  if (!isProductionOrigin && !isLocalOrigin && !isPreviewOrigin) {
    return {
      ok: false,
      error: `${label} must use ${allowedOriginDescription}.`,
    };
  }

  return {
    ok: true,
    url: url.toString(),
    isProductionOrigin,
    isLocalOrigin,
    isPreviewOrigin,
  };
};
