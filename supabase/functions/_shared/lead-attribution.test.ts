import { assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  formatLeadAttributionLines,
  normalizeLeadAttribution,
} from "./lead-attribution.ts";

Deno.test("lead attribution keeps only approved campaign and conversion fields", () => {
  const result = normalizeLeadAttribution(
    {
      version: 999,
      first_touch: {
        kind: "campaign",
        landing_path: "/machines/commercial-robotic-machine?utm_source=hidden#fragment",
        referrer_host: "www.google.com",
        utm_source: "approved_source",
        utm_medium: "paid-search",
        utm_campaign: "operator_launch_2026",
        gclid: "must-not-persist",
        arbitrary: "must-not-persist",
      },
      last_touch: {
        kind: "internal",
        landing_path: "/contact?name=hidden#fragment",
        internal_source_path: "/",
      },
      conversion: {
        planner_recommendation: "commercial",
        planner_band: "clear",
        exact_startup_cost: 12345,
      },
    },
    {
      sourcePage: "/resources/business-playbook/planner?private=ignored",
      machineInterest: "commercial",
    },
  );

  assertEquals(result, {
    version: 1,
    first_touch: {
      kind: "campaign",
      landing_path: "/machines/commercial-robotic-machine",
      referrer_host: "www.google.com",
      utm_source: "approved_source",
      utm_medium: "paid-search",
      utm_campaign: "operator_launch_2026",
    },
    last_touch: {
      kind: "internal",
      landing_path: "/contact",
      internal_source_path: "/",
    },
    conversion: {
      source_path: "/resources/business-playbook/planner",
      machine_interest: "Commercial Machine",
      planner_recommendation: "commercial",
      planner_band: "clear",
    },
  });
});

Deno.test("lead attribution drops likely PII, full URLs, click ids, and unsafe planner values", () => {
  const result = normalizeLeadAttribution(
    {
      first_touch: {
        kind: "campaign",
        landing_path: "/contact/customer@example.test",
        referrer_host: "https://search.example.test/path?q=private",
        utm_source: "customer@example.test",
        utm_medium: "+1 (555) 123-4567",
        utm_campaign: "safe-campaign",
        fbclid: "not-approved",
      },
      last_touch: {
        kind: "planner",
        landing_path: "/contact",
        internal_source_path: "/resources/business-playbook/payback-planner",
        planner_recommendation: "commercial",
        planner_band: "$12,345",
        exact_monthly_units: 250,
      },
      conversion: {
        planner_recommendation: "anything",
        planner_band: "42-month-payback",
      },
    },
    { sourcePage: "/contact", machineInterest: "unknown machine" },
  );

  assertEquals(result, {
    version: 1,
    last_touch: {
      kind: "planner",
      landing_path: "/contact",
      internal_source_path: "/resources/business-playbook/payback-planner",
      planner_recommendation: "commercial",
    },
    conversion: {
      source_path: "/contact",
      planner_recommendation: "commercial",
    },
  });
  assertFalse(JSON.stringify(result).includes("fbclid"));
  assertFalse(JSON.stringify(result).includes("12345"));
  assertFalse(JSON.stringify(result).includes("example.test"));
});

Deno.test("malformed attribution never blocks a valid lead context", () => {
  for (const value of [null, "bad", [], { first_touch: "bad" }]) {
    assertEquals(
      normalizeLeadAttribution(value, {
        sourcePage: "not-an-internal-path",
        machineInterest: "Mini Machine",
      }),
      {
        version: 1,
        conversion: {
          source_path: "/contact",
          machine_interest: "Mini Machine",
        },
      },
    );
  }
});

Deno.test("private application paths are excluded from lead attribution", () => {
  assertEquals(
    normalizeLeadAttribution(
      {
        first_touch: { kind: "direct", landing_path: "/portal/account" },
        last_touch: {
          kind: "internal",
          landing_path: "/contact",
          internal_source_path: "/admin/accounts",
        },
      },
      { sourcePage: "/contact", machineInterest: "Commercial Machine" },
    ),
    {
      version: 1,
      last_touch: { kind: "internal", landing_path: "/contact" },
      conversion: {
        source_path: "/contact",
        machine_interest: "Commercial Machine",
      },
    },
  );
});

Deno.test("notification lines contain only the normalized compact summary", () => {
  const attribution = normalizeLeadAttribution(
    {
      first_touch: {
        kind: "organic",
        landing_path: "/machines",
        referrer_host: "www.google.com",
      },
      last_touch: {
        kind: "planner",
        landing_path: "/contact",
        internal_source_path: "/resources/business-playbook/planner",
        planner_recommendation: "commercial",
        planner_band: "clear",
      },
    },
    { sourcePage: "/resources/business-playbook/planner", machineInterest: "Commercial Machine" },
  );
  const lines = formatLeadAttributionLines(attribution).join("\n");

  assertEquals(
    lines,
    [
      "",
      "Lead Attribution:",
      "- First touch: organic @ /machines | referrer=www.google.com",
      "- Last touch: planner @ /contact | source=/resources/business-playbook/planner | planner=commercial | band=clear",
      "- Conversion: source=/resources/business-playbook/planner | machine=Commercial Machine | planner=commercial | band=clear",
    ].join("\n"),
  );
});

Deno.test("legacy or malformed stored attribution cannot break notification retries", () => {
  assertEquals(formatLeadAttributionLines({}), []);
  assertEquals(formatLeadAttributionLines({ conversion: {} }), []);
  assertEquals(
    formatLeadAttributionLines({
      conversion: { source_path: "/contact/customer@example.test" },
    }),
    [],
  );
  assertEquals(
    formatLeadAttributionLines({
      first_touch: {
        kind: "campaign",
        landing_path: "/contact",
        utm_source: "customer@example.test",
      },
      conversion: {
        source_path: "/contact",
        machine_interest: "<script>not-a-machine</script>",
        planner_recommendation: "commercial\nInjected header",
        planner_band: "$12,345",
      },
    }),
    [
      "",
      "Lead Attribution:",
      "- First touch: campaign @ /contact",
      "- Last touch: unavailable",
      "- Conversion: source=/contact",
    ],
  );
});
