const allowedProductionOrigins = new Set([
  "https://www.bloomjoyusa.com",
  "https://app.bloomjoyusa.com",
]);

const allowedLocalHosts = new Set(["localhost", "127.0.0.1"]);
const allowedLocalProtocols = new Set(["http:", "https:"]);
const enabledEnvValues = new Set(["1", "true", "yes", "on"]);

/**
 * @typedef {Object} BrowserUrlValidationOptions
 * @property {string} [label]
 * @property {string | null} [fallbackUrl]
 * @property {boolean} [allowLocalUrls]
 *
 * @typedef {Object} BrowserUrlValidationSuccess
 * @property {true} ok
 * @property {string} url
 * @property {boolean} isProductionOrigin
 * @property {boolean} isLocalOrigin
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
]);

const getDenoEnv = (key) => {
  if (typeof Deno === "undefined") return null;

  try {
    return Deno.env.get(key) ?? null;
  } catch {
    return null;
  }
};

const isEnabledEnvValue = (value) =>
  enabledEnvValues.has(String(value ?? "").trim().toLowerCase());

const isLocalSupabaseRuntime = () => {
  const supabaseUrl = getDenoEnv("SUPABASE_URL");
  if (!supabaseUrl) return false;

  try {
    const url = new URL(supabaseUrl);
    return allowedLocalHosts.has(url.hostname);
  } catch {
    return false;
  }
};

export const areLocalBrowserUrlsAllowed = () =>
  isEnabledEnvValue(getDenoEnv("BLOOMJOY_ALLOW_LOCAL_REDIRECT_URLS")) ||
  isLocalSupabaseRuntime();

/**
 * @param {unknown} value
 * @param {BrowserUrlValidationOptions} [options]
 * @returns {BrowserUrlValidationResult}
 */
export const validateBrowserUrl = (
  value,
  { label = "URL", fallbackUrl = null, allowLocalUrls } = {},
) => {
  const raw = typeof value === "string" ? value.trim() : "";
  const candidate = raw || fallbackUrl;
  const localUrlsAreAllowed =
    typeof allowLocalUrls === "boolean" ? allowLocalUrls : areLocalBrowserUrlsAllowed();
  const allowedOriginDescription = localUrlsAreAllowed
    ? "a Bloomjoy production or localhost/127.0.0.1 origin"
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

  if (!isProductionOrigin && !isLocalOrigin) {
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
  };
};
