import assert from "node:assert/strict";
import { validateBrowserUrl } from "../supabase/functions/_shared/browser-url-allowlist.mjs";

const allowedLocalUrls = [
  "http://localhost:8080/cart?checkout=success",
  "http://127.0.0.1:8080/portal/account?billing=return",
];

const allowedProductionUrls = [
  "https://www.bloomjoyusa.com/supplies?sticksCheckout=cancel",
  "https://app.bloomjoyusa.com/login",
];

const rejectedUrls = [
  "https://example.com/cart?checkout=success",
  "https://bloomjoyusa.com/login",
  "http://app.bloomjoyusa.com/login",
  "javascript:alert(1)",
  "https://www.bloomjoyusa.com.evil.test/cart",
  "https://user:pass@app.bloomjoyusa.com/login",
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

console.log("Edge URL allowlist checks passed");
