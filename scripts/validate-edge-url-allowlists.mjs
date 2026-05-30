import assert from "node:assert/strict";
import { validateAccessInvitePreflight } from "../src/lib/accessInviteLoginUrls.mjs";
import { validateBrowserUrl } from "../supabase/functions/_shared/browser-url-allowlist.mjs";

const allowedLocalUrls = [
  "http://localhost:8080/cart?checkout=success",
  "http://127.0.0.1:8080/portal/account?billing=return",
];

const allowedProductionUrls = [
  "https://www.bloomjoyusa.com/supplies?sticksCheckout=cancel",
  "https://app.bloomjoyusa.com/login",
];

const allowedPreviewOrigin = "https://bloomjoy-hub-git-cp-uat-challenge-bloomjoy.vercel.app";
const allowedPreviewUrls = [
  `${allowedPreviewOrigin}/login?intent=technician&email=qa%40example.com`,
];

const rejectedUrls = [
  "https://example.com/cart?checkout=success",
  "https://bloomjoyusa.com/login",
  "http://app.bloomjoyusa.com/login",
  "javascript:alert(1)",
  "https://www.bloomjoyusa.com.evil.test/cart",
  "https://user:pass@app.bloomjoyusa.com/login",
  "https://bloomjoy-hub-git-unconfigured-bloomjoy.vercel.app/login",
];

for (const url of allowedProductionUrls) {
  const result = validateBrowserUrl(url, { label: "test URL" });
  assert.equal(result.ok, true, `${url} should be allowed`);
}

for (const url of allowedLocalUrls) {
  const result = validateBrowserUrl(url, {
    label: "test URL",
    allowLocalUrls: true,
  });
  assert.equal(result.ok, true, `${url} should be allowed in local/dev mode`);
}

for (const url of allowedLocalUrls) {
  const result = validateBrowserUrl(url, { label: "test URL" });
  assert.equal(result.ok, false, `${url} should be rejected by default`);
  assert.match(result.error, /Bloomjoy production origin/);
}

for (const url of allowedPreviewUrls) {
  process.env.BLOOMJOY_ALLOWED_VERCEL_PREVIEW_ORIGINS = allowedPreviewOrigin;
  const result = validateBrowserUrl(url, {
    label: "test URL",
    allowConfiguredPreviewOrigins: true,
  });
  assert.equal(result.ok, true, `${url} should be allowed for opted-in access-invite preview origin`);
  assert.equal(result.isPreviewOrigin, true, `${url} should be marked as preview origin`);
}

for (const url of allowedPreviewUrls) {
  const result = validateBrowserUrl(url, { label: "test URL" });
  assert.equal(result.ok, false, `${url} should be rejected by default checkout-style validation`);
  assert.match(result.error, /Bloomjoy production origin/);
}

const rejectedPreviewBypass = validateBrowserUrl("https://example.com/login", {
  label: "test URL",
  allowedPreviewOrigins: ["https://example.com"],
});
assert.equal(
  rejectedPreviewBypass.ok,
  false,
  "configured preview origins must be exact Vercel preview origins",
);

for (const url of rejectedUrls) {
  const result = validateBrowserUrl(url, { label: "test URL" });
  assert.equal(result.ok, false, `${url} should be rejected`);
  assert.match(result.error, /Bloomjoy production|embedded credentials/);
}

const fallbackResult = validateBrowserUrl("", {
  label: "login URL",
  fallbackUrl: "https://app.bloomjoyusa.com/login",
});
assert.equal(fallbackResult.ok, true, "empty invite login URL should use the safe fallback");
assert.equal(fallbackResult.url, "https://app.bloomjoyusa.com/login");

const rejectedFallbackBypass = validateBrowserUrl("https://example.com/login", {
  label: "login URL",
  fallbackUrl: "https://app.bloomjoyusa.com/login",
});
assert.equal(
  rejectedFallbackBypass.ok,
  false,
  "explicit external invite login URL should not fall back silently",
);

const makeLocation = (origin) => {
  const url = new URL(origin);
  return {
    origin: url.origin,
    hostname: url.hostname,
    protocol: url.protocol,
  };
};

const allowedClientInviteOrigins = [
  "https://app.bloomjoyusa.com",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  allowedPreviewOrigin,
];

for (const origin of allowedClientInviteOrigins) {
  const result = validateAccessInvitePreflight(
    "technician",
    "QA@Example.com",
    makeLocation(origin),
  );
  assert.equal(result.ok, true, `${origin} should build an access invite login URL`);
  assert.equal(
    result.loginUrl,
    `${origin}/login?intent=technician&email=qa%40example.com`,
    `${origin} should preserve the exact allowed invite origin, login route, intent, and email`,
  );
}

const defaultClientInviteResult = validateAccessInvitePreflight(
  "corporate_partner",
  "partner@example.com",
  null,
);
assert.equal(defaultClientInviteResult.ok, true, "non-browser invite helper should use app origin");
assert.equal(
  defaultClientInviteResult.loginUrl,
  "https://app.bloomjoyusa.com/login?intent=corporate_partner&email=partner%40example.com",
);

const machineManagerInviteResult = validateAccessInvitePreflight(
  "machine_manager",
  "Manager@Example.com",
  makeLocation("https://app.bloomjoyusa.com"),
);
assert.equal(machineManagerInviteResult.ok, true, "Machine Manager invite URLs should be allowed");
assert.equal(
  machineManagerInviteResult.loginUrl,
  "https://app.bloomjoyusa.com/login?intent=machine_manager&email=manager%40example.com",
);

const rejectedClientInviteOrigins = [
  "https://www.bloomjoyusa.com",
  "http://app.bloomjoyusa.com",
  "https://example.com",
  "http://bloomjoy-hub-git-cp-uat-challenge-bloomjoy.vercel.app",
  "https://bloomjoy-hub-git-cp-uat-challenge-bloomjoy.vercel.app.evil.test",
];

for (const origin of rejectedClientInviteOrigins) {
  const result = validateAccessInvitePreflight(
    "technician",
    "qa@example.com",
    makeLocation(origin),
  );
  assert.equal(result.ok, false, `${origin} should be rejected for access invite login URLs`);
}

const rejectedSpoofedClientLocation = validateAccessInvitePreflight(
  "technician",
  "qa@example.com",
  {
    origin: "https://example.com",
    hostname: "localhost",
    protocol: "https:",
  },
);
assert.equal(
  rejectedSpoofedClientLocation.ok,
  false,
  "invite helper should reject mismatched origin and hostname inputs",
);

const rejectedClientInviteEmail = validateAccessInvitePreflight(
  "technician",
  "not-an-email",
  makeLocation("http://localhost:8080"),
);
assert.equal(rejectedClientInviteEmail.ok, false, "invite helper should reject invalid emails");

console.log("Edge URL allowlist checks passed");
