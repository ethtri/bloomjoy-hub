import {
  buildMachineEmail,
  parseMachineEmailProjection,
  summarizeMachineEmail,
} from "./machine-email-alert.ts";
import { machineEmailLinks } from "./machine-email-alert-delivery.ts";
import {
  fixtureCase,
  fixtureMachine,
  fixtureProjection,
  fixtureVariants,
} from "./machine-email-alert-fixtures.ts";
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const rejects = (value: unknown) => {
  let rejected = false;
  try {
    parseMachineEmailProjection(value);
  } catch {
    rejected = true;
  }
  assert(rejected, "unsafe projection should be rejected");
};
const links = machineEmailLinks();

Deno.test("all production optional templates render complete synthetic projections", () => {
  for (const [name, projection] of Object.entries(fixtureVariants())) {
    const email = buildMachineEmail({ projection, links });
    assert(
      email.html.startsWith("<!doctype html>") && email.text.length > 100,
      `${name}: multipart content`,
    );
    assert(email.text.includes("/portal/notifications"), "preferences link");
    for (const m of projection.machines) {
      for (const c of m.refundCases) {
        assert(
          email.text.includes(c.publicReference) &&
            email.html.includes(c.publicReference),
          "every case retained",
        );
      }
    }
  }
});
Deno.test("followed scope reconciles without adding assigned-machine queue or missing sales", () => {
  const projection = fixtureProjection();
  assert(
    projection.summary.machineCount === 2 &&
      projection.summary.salesMachineCount === 1 &&
      projection.summary.grossSalesCents === 42000 &&
      projection.summary.netSalesCents === 40000,
    "same known scope",
  );
  assert(
    projection.summary.openCount === 1 &&
      projection.summary.decisionCount === 0,
    "extra assigned counts separate",
  );
  const email = buildMachineEmail({ projection, links });
  assert(
    email.text.includes("Assigned refund work") &&
      email.text.includes(
        "Additional assigned refund work: 1 open cases · 1 need your decision",
      ),
    "explicit additional scope",
  );
  assert(
    email.text.includes("Earlier requests still open") &&
      email.text.includes("Gift card issued"),
    "earlier backlog and period resolved retained",
  );
  assert(
    email.text.includes("Unavailable") &&
      !email.text.includes("paid transactions"),
    "missing not zero; correct transaction definition",
  );
});
Deno.test("wrong summary, duplicates, missing mandatory case and foreign fields fail closed", () => {
  const base = fixtureProjection();
  rejects({ ...base, summary: { ...base.summary, grossSalesCents: 43000 } });
  rejects({ ...base, rawProviderPayload: {} });
  const duplicate = structuredClone(base);
  duplicate.machines[0].refundCases.push(duplicate.machines[0].refundCases[0]);
  duplicate.summary = summarizeMachineEmail(duplicate.machines);
  rejects(duplicate);
  const missing = structuredClone(base);
  missing.machines.pop();
  missing.summary = summarizeMachineEmail(missing.machines);
  rejects(missing);
  const arithmetic = structuredClone(base);
  arithmetic.machines[0].netSalesCents = 42000;
  arithmetic.summary = summarizeMachineEmail(arithmetic.machines);
  rejects(arithmetic);
});
Deno.test("technician privacy and escaped narratives cannot turn into hidden financial data or HTML", () => {
  const p = fixtureProjection();
  p.managerOpenCases = null;
  p.managerCaseMachines = [];
  p.machines = [fixtureMachine(101, {
    reportingAllowed: false,
    salesComplete: false,
    coverageStatus: "unavailable",
    grossSalesCents: null,
    netSalesCents: null,
    refundAmountCents: null,
    transactionCount: null,
    previousGrossSalesCents: null,
    refundCases: [fixtureCase(1, {
      canOpenCase: false,
      amountCents: null,
      currencyCode: null,
      commentKind: "operational-summary",
      commentExcerpt:
        "<img src=x onerror=alert(1)> contact example@example.test or +1 415 555 0101",
    })],
  })];
  p.summary = summarizeMachineEmail(p.machines);
  const email = buildMachineEmail({ projection: p, links });
  assert(
    !email.html.includes("<img") && email.html.includes("&lt;img"),
    "HTML escaped",
  );
  assert(
    !email.text.includes("example@example.test") &&
      !email.text.includes("415 555"),
    "presentation redaction",
  );
  assert(
    !email.text.includes("/refunds?case=") &&
      !email.text.includes("/portal/reports"),
    "no unauthorized destination",
  );
  p.machines[0].grossSalesCents = 100;
  rejects(p);
});
Deno.test("legacy cases keep unknown date/reason explicit without inventing request timestamps", () => {
  const p = fixtureProjection();
  p.machines[2].refundCases[0].receivedAt = null;
  p.machines[2].refundCases[0].incidentAt = null;
  p.machines[2].refundCases[0].issueCategory = null;
  const email = buildMachineEmail({ projection: p, links });
  assert(
    email.text.includes("Request date unavailable") &&
      email.text.includes("Customer selected: not recorded"),
    "unknown explicit",
  );
});
Deno.test("quiet/offline evidence guards reject stale and inferred states", () => {
  const variants = fixtureVariants();
  const quiet = structuredClone(variants["sales-quiet"]);
  (quiet.signal as unknown as Record<string, unknown>).coverageVerified = false;
  rejects(quiet);
  const unauthorized = structuredClone(variants["sales-quiet"]);
  unauthorized.machines[0] = fixtureMachine(101, {
    reportingAllowed: false,
    grossSalesCents: null,
    refundAmountCents: null,
    netSalesCents: null,
    transactionCount: null,
    previousGrossSalesCents: null,
    refundCases: [],
  });
  unauthorized.summary = summarizeMachineEmail(unauthorized.machines);
  rejects(unauthorized);
  const offline = structuredClone(variants["device-offline"]);
  (offline.signal as unknown as Record<string, unknown>).providerField =
    "MachineStatusBit";
  rejects(offline);
  for (const field of ["IsOnline", "isOnline"]) {
    const undocumented = structuredClone(variants["device-offline"]);
    (undocumented.signal as unknown as Record<string, unknown>).providerField =
      field;
    rejects(undocumented);
  }
  const wholeDevice = structuredClone(variants["device-offline"]);
  (wholeDevice.signal as unknown as Record<string, unknown>).component =
    "Nayax payment device";
  rejects(wholeDevice);
  const wrongBaseline = structuredClone(variants["device-offline"]);
  (wrongBaseline.signal as unknown as Record<string, unknown>)
    .priorOnlineObservedAt = "2026-10-02T14:50:00Z";
  rejects(wrongBaseline);
  const missingBaseline = structuredClone(variants["device-offline"]);
  delete (missingBaseline.signal as unknown as Record<string, unknown>)
    .priorOnlineObservedAt;
  rejects(missingBaseline);
  const stale = structuredClone(variants["device-offline"]);
  stale.observedAt = "2026-10-02T15:07:00Z";
  rejects(stale);
  assert(
    buildMachineEmail({ projection: variants["sales-quiet"], links }).subject
      .includes("Cash sales"),
    "cash-only subject",
  );
  assert(
    buildMachineEmail({ projection: variants["device-offline"], links }).subject
      .includes("Nayax connection disconnected"),
    "documented connection-specific subject",
  );
  const connection = buildMachineEmail({
    projection: variants["device-offline"],
    links,
  });
  assert(
    connection.text.includes("Nayax MQTT connection") &&
      connection.text.includes(
        "Payment processing and dispensing status are not established",
      ),
    "precise component and practical limits",
  );
});
Deno.test("weekly uses reported snapshot wording and 40-case email remains complete below common clipping size", () => {
  const variants = fixtureVariants();
  const weekly = buildMachineEmail({ projection: variants.weekly, links });
  assert(
    weekly.text.includes("previous week’s reported sales") &&
      !weekly.text.includes("previous complete week"),
    "coverage not overstated",
  );
  const email = buildMachineEmail({
    projection: variants["daily-long"],
    links,
  });
  assert(
    email.itemCount === 40 && email.text.includes("RF-SYNTHETIC-49"),
    "no eight-case cap",
  );
  assert(
    new TextEncoder().encode(email.html).length < 100_000,
    "40-case fixture below HTML clipping threshold",
  );
});
