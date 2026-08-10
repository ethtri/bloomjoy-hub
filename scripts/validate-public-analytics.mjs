import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertIncludes = (source, expected, message) => {
  assert(source.includes(expected), message);
};

const vite = await createServer({
  appType: "custom",
  logLevel: "error",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
});

try {
  const analytics = await vite.ssrLoadModule("/src/lib/analytics.ts");

  assert(analytics.isValidGaMeasurementId("G-AB12CD34"), "Valid GA4 ID was rejected");
  assert(!analytics.isValidGaMeasurementId("UA-123-1"), "Legacy UA ID was accepted");
  assert(!analytics.isValidGaMeasurementId("G-secret value"), "Malformed GA4 ID was accepted");

  assert(analytics.isPublicAnalyticsPath("/"), "Homepage should be a public analytics route");
  assert(
    analytics.isPublicAnalyticsPath("/resources/business-playbook/example"),
    "Business Playbook articles should be public analytics routes"
  );
  assert(
    analytics.isPublicAnalyticsPath("/solutions/food-trucks"),
    "Solution pages should be public analytics routes"
  );
  for (const route of [
    "/resources/business-playbook/food-truck-mobile-setup-guide",
    "/resources/business-playbook/mobile-setup-fit-checker",
    "/resources/business-playbook/food-truck-dessert-add-ons",
    "/resources/business-playbook/food-truck-catering-dessert-menu",
  ]) {
    assert(analytics.isPublicAnalyticsPath(route), `${route} should be a public analytics route`);
  }
  assert(!analytics.isPublicAnalyticsPath("/portal"), "Portal must not initialize public analytics");
  assert(
    !analytics.isPublicAnalyticsPath("/refunds/request"),
    "Customer refund intake must not initialize public analytics"
  );

  const sanitized = analytics.sanitizeAnalyticsProperties({
    cta: "request_quote",
    email: "buyer@example.test",
    has_rent: true,
    href: "/contact?email=buyer%40example.test#form",
    machine_signal: "commercial",
    message: "private message",
    monthly_total: 100,
    name: "Private Name",
    phone: "555-0100",
    quantity: 12,
    result_band: "needs-confirmation",
    route: "/contact?type=quote&interest=mini",
    scenario_type: "event",
    source_page: "https://www.bloomjoyusa.com/resources?campaign=private",
    user_id: "private-user-id",
  });

  assert(
    JSON.stringify(sanitized) ===
      JSON.stringify({
        cta: "request_quote",
        has_rent: true,
        href: "/contact",
        machine_signal: "commercial",
        result_band: "needs-confirmation",
        route: "/contact",
        scenario_type: "event",
        source_page: "/resources",
      }),
    `Analytics sanitization mismatch: ${JSON.stringify(sanitized)}`
  );

  assert(
    analytics.getBuyerCtaClassification("/contact?type=quote") === "request_quote",
    "Quote destination was not classified"
  );
  assert(
    analytics.getMachineAnalyticsContext("/machines/mini?source=test") === "mini",
    "Machine context was not normalized"
  );

  const [
    analyticsSource,
    businessPlaybookAnalyticsSource,
    consentSource,
    appSource,
    cartSource,
    contactSource,
    plusSource,
    privacySource,
    envExample,
  ] =
    await Promise.all([
      readFile("src/lib/analytics.ts", "utf8"),
      readFile("src/lib/businessPlaybookAnalytics.ts", "utf8"),
      readFile("src/components/analytics/AnalyticsConsent.tsx", "utf8"),
      readFile("src/App.tsx", "utf8"),
      readFile("src/pages/Cart.tsx", "utf8"),
      readFile("src/pages/Contact.tsx", "utf8"),
      readFile("src/pages/Plus.tsx", "utf8"),
      readFile("src/pages/Privacy.tsx", "utf8"),
      readFile(".env.example", "utf8"),
    ]);

  assertIncludes(
    analyticsSource,
    "getAnalyticsConsent() !== 'granted'",
    "GA4 must remain disabled before explicit consent"
  );
  assertIncludes(
    analyticsSource,
    "allow_google_signals: false",
    "GA4 Google signals must stay disabled"
  );
  assertIncludes(
    analyticsSource,
    "allow_ad_personalization_signals: false",
    "GA4 ad-personalization signals must stay disabled"
  );
  assertIncludes(
    analyticsSource,
    "send_page_view: false",
    "Automatic GA4 page views must stay disabled for SPA de-duplication"
  );
  assertIncludes(
    analyticsSource,
    "document.getElementById(GA_SCRIPT_ID)",
    "GA4 loader must guard against duplicate scripts"
  );
  assertIncludes(
    appSource,
    "<PublicAnalyticsRouteTracker />",
    "Public route tracking is not mounted"
  );
  assertIncludes(
    appSource,
    "<AnalyticsConsentBanner />",
    "Public analytics consent choice is not mounted"
  );
  assertIncludes(
    consentSource,
    "No thanks",
    "Analytics consent choice is missing a decline action"
  );
  assertIncludes(
    consentSource,
    "Allow analytics",
    "Analytics consent choice is missing an allow action"
  );
  for (const eventName of ["lead_form_start", "lead_form_submit", "lead_form_error"]) {
    assertIncludes(contactSource, eventName, `Contact form is missing ${eventName}`);
  }
  for (const eventName of [
    "view_mobile_setup_fit_checker",
    "update_mobile_setup_fit_checker",
    "planner_start",
    "planner_complete",
  ]) {
    assertIncludes(
      businessPlaybookAnalyticsSource,
      eventName,
      `Mobile buyer analytics is missing ${eventName}`
    );
    assertIncludes(
      analyticsSource,
      `'${eventName}'`,
      `The public provider allowlist is missing ${eventName}`
    );
  }
  assert(
    !cartSource.includes("checkoutStatus === 'success'"),
    "Cart analytics must not trust an unverified checkout=success query"
  );
  assertIncludes(
    cartSource,
    "status.paymentStatus === 'paid' && isStorefrontOrder",
    "Cart success must require a verified paid storefront order"
  );
  assertIncludes(
    cartSource,
    "trackEvent('purchase_completed'",
    "Verified storefront checkout completion is not instrumented"
  );
  assert(
    !plusSource.includes("checkoutStatus === 'success'"),
    "Plus analytics must not trust an unverified checkout=success query"
  );
  assertIncludes(
    plusSource,
    "status.paymentStatus === 'paid' && status.orderType === 'plus_subscription'",
    "Plus success must require a verified paid subscription"
  );
  assertIncludes(
    plusSource,
    "trackEvent('plus_subscription_activated')",
    "Verified Plus activation is not instrumented"
  );
  assertIncludes(
    privacySource,
    "Website analytics",
    "Privacy notice is missing the analytics disclosure"
  );
  assertIncludes(
    envExample,
    "VITE_GA_MEASUREMENT_ID=",
    "Public GA4 environment configuration is undocumented"
  );

  console.log("Public analytics validation passed: provider guard, route scope, event privacy, and lifecycle instrumentation are present.");
} finally {
  await vite.close();
}
