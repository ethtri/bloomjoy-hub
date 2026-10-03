import {
  buildMachineEmail,
  parseMachineEmailProjection,
  sanitizeOperationalExcerpt,
  summarizeMachineEmail,
} from "./machine-email-alert.ts";
import { machineEmailLinks } from "./machine-email-alert-delivery.ts";
import {
  fixtureCase,
  fixtureDigest,
  fixtureId,
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
    const digest = ["daily", "weekly"].includes(projection.category);
    for (const m of projection.machines) {
      if (digest && m.includedInPerformanceScope) {
        assert(
          email.text.includes(m.machineLabel),
          "every selected machine retained",
        );
      }
      for (const c of m.refundCases) {
        assert(
          digest
            ? !email.text.includes(c.publicReference) &&
              !email.html.includes(c.publicReference)
            : email.text.includes(c.publicReference) &&
              email.html.includes(c.publicReference),
          "digest stays compact while immediate request preserves its case detail",
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
    !email.text.includes("Assigned refund work") &&
      !email.text.includes("BJ-021") &&
      !email.text.includes("Bloomjoy Enterprises"),
    "assigned backlog does not expand selected period content or company groups",
  );
  assert(
    !email.text.includes("Earlier requests still open") &&
      !email.text.includes("Gift card issued") && email.itemCount === 2,
    "two new period requests include the resolved one without rendering workflow detail",
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
Deno.test("digest intake amounts have exact counts, known/unknown semantics and independent access", () => {
  const base = fixtureProjection();
  for (
    const change of [
      { newRequestCount: 3, requestedAmountKnownCount: 3 },
      { requestedAmountKnownCount: 1, requestedAmountUnknownCount: 0 },
      { requestedAmountCents: -1 },
      { requestedAmountCents: null },
      { requestedAmountKnownCount: 0, requestedAmountUnknownCount: 2 },
      { requestAmountsAllowed: false },
      {
        previousRequestedAmountKnownCount: 0,
        previousRequestedAmountUnknownCount: 0,
      },
      { previousRequestedAmountCents: -1 },
      { accountId: "not-a-canonical-id" },
      { accountName: "" },
    ]
  ) {
    const unsafe = structuredClone(base);
    Object.assign(unsafe.machines[0].digest!, change);
    rejects(unsafe);
  }
  const partial = structuredClone(base);
  Object.assign(partial.machines[0].digest!, {
    requestedAmountCents: 900,
    requestedAmountKnownCount: 1,
    requestedAmountUnknownCount: 1,
  });
  assert(
    parseMachineEmailProjection(partial).machines[0].digest
      ?.requestedAmountCents === 900,
    "known subtotal remains separate from the unknown request",
  );
  const unknown = structuredClone(base);
  Object.assign(unknown.machines[0].digest!, {
    requestedAmountCents: null,
    requestedAmountKnownCount: 0,
    requestedAmountUnknownCount: 2,
  });
  parseMachineEmailProjection(unknown);
  const zero = structuredClone(base);
  zero.machines[1].digest!.requestedAmountCents = null;
  rejects(zero);
  const identity = structuredClone(base);
  identity.machines[1].digest!.accountId =
    identity.machines[0].digest!.accountId;
  rejects(identity);
  const event = fixtureVariants()["new-refund"];
  event.machines[0].digest = fixtureDigest();
  rejects(event);
});
Deno.test("compact company, fleet and machine amounts use period intake rather than reversals or prepared payment", () => {
  const p = fixtureVariants()["daily-companies"];
  // These amounts intentionally differ: requested $26, accounting impact $35,
  // and the current prepared case amount can change after initial intake.
  p.machines[0].refundCases[0].amountCents = 999900;
  const email = buildMachineEmail({ projection: p, links });
  for (
    const expected of [
      "$996.00",
      "$26.00",
      "$420.00",
      "$18.00",
      "$336.00",
      "$8.00",
      "$240.00",
      "TGPaci",
      "Bloomjoy NC",
      "Bloomjoy Enterprises",
    ]
  ) {
    assert(
      email.text.includes(expected) && email.html.includes(expected),
      "company and fleet rollups have text/HTML parity",
    );
  }
  assert(
    email.itemCount === 3 && !email.text.includes("$35.00") &&
      !email.text.includes("$9,999.00") &&
      !email.text.includes("RF-SYNTHETIC") &&
      !email.text.includes("Cup stopped"),
    "requested period figures never become adjusted or prepared money",
  );
  assert(
    /<th\b[^>]*scope="col"/.test(email.html),
    "data tables label their column headers",
  );
});
Deno.test("existing v1 jobs stay compact with unavailable request amounts and no invented company", () => {
  const p = fixtureProjection();
  for (const m of p.machines) {
    delete m.digest;
    for (const c of m.refundCases) c.amountCents = 999900;
  }
  const parsed = parseMachineEmailProjection(p);
  assert(
    parsed.machines.every((m) => m.digest === undefined),
    "absent legacy metadata stays absent",
  );
  const email = buildMachineEmail({ projection: parsed, links });
  assert(
    email.itemCount === 2 && email.text.includes("Unavailable") &&
      !email.text.includes("$9,999.00") && !email.text.includes("TGPaci") &&
      !email.text.includes("Bloomjoy NC") &&
      !email.text.includes("Earlier requests"),
    "legacy delivery never guesses company, opening amounts or expands old backlog",
  );
});
Deno.test("unknown requested amounts never turn into zero or silently complete a known subtotal", () => {
  const p = fixtureProjection();
  Object.assign(p.machines[0].digest!, {
    requestedAmountCents: null,
    requestedAmountKnownCount: 0,
    requestedAmountUnknownCount: 2,
  });
  const unknown = buildMachineEmail({ projection: p, links });
  assert(
    /^Refunds requested: Unavailable · 2 new requests$/m.test(unknown.text),
    "another machine's zero-request amount cannot turn two unknown requests into a zero total",
  );
  Object.assign(p.machines[0].digest!, {
    requestedAmountCents: 900,
    requestedAmountKnownCount: 1,
    requestedAmountUnknownCount: 1,
  });
  const partial = buildMachineEmail({ projection: p, links });
  assert(
    /^Refunds requested: \$9\.00 known · 2 new requests · 1 amount unavailable$/m
      .test(partial.text),
    "known requested dollars stay explicitly partial while both requests count",
  );
});
Deno.test("technician digest counts remain visible without sales or requested money outside access", () => {
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
    refundCases: [
      fixtureCase(1, {
        canOpenCase: false,
        amountCents: null,
        currencyCode: null,
      }),
    ],
    digest: fixtureDigest({
      requestAmountsAllowed: false,
      requestedAmountCents: null,
      requestedAmountKnownCount: 0,
      requestedAmountUnknownCount: 1,
      previousRequestedAmountCents: null,
      previousRequestedAmountKnownCount: 0,
      previousRequestedAmountUnknownCount: 1,
    }),
  })];
  p.summary = summarizeMachineEmail(p.machines);
  const email = buildMachineEmail({ projection: p, links });
  assert(
    email.itemCount === 1 && !/\$\d/.test(email.text) &&
      !email.text.includes("/portal/reports") &&
      !email.text.includes("/refunds?case="),
    "counts do not grant financial or destination access",
  );
  p.machines[0].digest!.requestedAmountCents = 1000;
  rejects(p);
});
Deno.test("weekly comparisons use the same known machines and avoid percentages from zero or missing baselines", () => {
  const p = fixtureVariants()["weekly-companies"];
  const all = buildMachineEmail({ projection: p, links });
  assert(
    all.text.includes("1.6% higher"),
    "$996 versus$980 reported sales comparison",
  );
  p.machines[1].previousGrossSalesCents = null;
  const partial = buildMachineEmail({ projection: p, links });
  assert(
    partial.text.includes("2.9%") &&
      (partial.text.includes("2 comparable machines") ||
        partial.text.includes("2 of 3")),
    "comparison is$660 versus$680 across two machines, not full current sales versus partial baseline",
  );
  for (const m of p.machines) m.previousGrossSalesCents = 0;
  const zero = buildMachineEmail({ projection: p, links });
  assert(
    !zero.text.includes("Infinity") && !zero.text.includes("NaN") &&
      !/\d+(?:\.\d+)?%/.test(zero.text),
    "zero baseline does not produce percentage growth",
  );
  for (const m of p.machines) m.previousGrossSalesCents = null;
  const missing = buildMachineEmail({ projection: p, links });
  assert(
    !/\d+(?:\.\d+)?%/.test(missing.text),
    "missing prior data does not become zero sales",
  );
});
Deno.test("digest report links carry supported dates and exact single-machine scope", () => {
  const p = fixtureVariants()["weekly-companies"];
  const email = buildMachineEmail({ projection: p, links });
  const urls = [...email.text.matchAll(/https:\/\/[^\s]+/g)].map((match) =>
    new URL(match[0])
  );
  const reports = urls.filter((url) => url.pathname === "/portal/reports");
  assert(
    reports.length > 0 &&
      reports.every((url) =>
        url.searchParams.get("from") === p.dateFrom &&
        url.searchParams.get("to") === p.dateTo
      ),
    "period preserved by primary and machine report links",
  );
  const machineLinks = [...email.html.matchAll(/href="([^"]+)"/g)]
    .map((match) => new URL(match[1].replaceAll("&amp;", "&")))
    .filter((url) =>
      url.pathname === "/portal/reports" && url.searchParams.has("machine")
    );
  assert(
    machineLinks.some((url) =>
      url.searchParams.get("machine") === fixtureId(101)
    ) &&
      machineLinks.every((url) =>
        url.searchParams.get("from") === p.dateFrom &&
        url.searchParams.get("to") === p.dateTo
      ),
    "existing single-machine query contract preserves the period",
  );
  assert(
    reports.every((url) => !url.searchParams.has("machines")),
    "no unsupported multi-machine query",
  );
});
Deno.test("mixed machine-local daily and weekly periods stay visible beside the affected row and in its report link", () => {
  for (const weekly of [false, true]) {
    const p =
      fixtureVariants()[weekly ? "weekly-companies" : "daily-companies"];
    p.dateFrom = weekly ? "2026-09-21" : "2026-10-02";
    p.dateTo = weekly ? "2026-09-27" : "2026-10-02";
    p.observedAt = "2026-10-03T15:00:00Z";
    for (const m of p.machines) {
      m.dateFrom = p.dateFrom;
      m.dateTo = p.dateTo;
    }
    const shifted = p.machines[0];
    shifted.timezone = "Pacific/Kiritimati";
    shifted.dateFrom = weekly ? "2026-09-28" : "2026-10-03";
    shifted.dateTo = weekly ? "2026-10-04" : "2026-10-03";
    for (const c of shifted.refundCases) {
      c.receivedAt = "2026-10-02T12:00:00Z";
      c.incidentAt = c.receivedAt;
    }
    const email = buildMachineEmail({ projection: p, links });
    const expectedDate = weekly ? /September 28.*October 4/ : /Oct(?:ober)? 3/;
    assert(
      expectedDate.test(email.text) && expectedDate.test(email.html),
      "a different machine period is explicit in both versions, not silently covered by the recipient date heading",
    );
    const rows = [
      ...email.html.matchAll(/<tr\b[^>]*>(?:(?!<tr\b)[\s\S])*?<\/tr>/g),
    ];
    const row = rows.find((match) =>
      match[0].includes(`machine=${shifted.machineId}`)
    )?.[0] ?? "";
    assert(
      expectedDate.test(row),
      "the actual period is attached to the affected machine row",
    );
    const urls = [...email.html.matchAll(/href="([^"]+)"/g)]
      .map((match) => new URL(match[1].replaceAll("&amp;", "&")));
    const machineLink = urls.find((url) =>
      url.searchParams.get("machine") === shifted.machineId
    );
    assert(
      machineLink?.searchParams.get("from") === shifted.dateFrom &&
        machineLink?.searchParams.get("to") === shifted.dateTo,
      "machine report opens its actual reporting period",
    );
    const primary = urls.find((url) =>
      url.pathname === "/portal/reports" && !url.searchParams.has("machine")
    );
    assert(
      primary?.searchParams.get("from") === p.dateFrom &&
        primary?.searchParams.get("to") === p.dateTo,
      "primary report retains the recipient reporting period",
    );
  }
});
Deno.test("technician privacy and escaped narratives cannot turn into hidden financial data or HTML", () => {
  const p = fixtureProjection();
  p.managerOpenCases = null;
  p.managerCaseMachines = [];
  p.category = "new-refund";
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
Deno.test("immediate case detail keeps unknown date/reason explicit without inventing request timestamps", () => {
  const p = fixtureVariants()["new-refund"];
  p.machines[0].refundCases[0].receivedAt = null;
  p.machines[0].refundCases[0].incidentAt = null;
  p.machines[0].refundCases[0].issueCategory = null;
  const email = buildMachineEmail({ projection: p, links });
  assert(
    email.text.includes("Request date unavailable") &&
      email.text.includes("Customer selected: not recorded"),
    "unknown explicit",
  );
});
Deno.test("SQL-bounded Unicode comments and labels retain strict code-point limits", () => {
  const p = fixtureVariants()["new-refund"];
  p.machines[0].refundCases[0].commentExcerpt = "🍭".repeat(280);
  p.machines[0].machineLabel = "🍬".repeat(240);
  const email = buildMachineEmail({ projection: p, links });
  assert(
    email.text.includes("🍭".repeat(280)) &&
      email.html.includes("🍬".repeat(240)),
    "SQL-valid non-BMP characters do not block the digest",
  );
  for (const comment of ["🍭".repeat(281), "a".repeat(281)]) {
    const tooLong = structuredClone(p);
    tooLong.machines[0].refundCases[0].commentExcerpt = comment;
    rejects(tooLong);
  }
  const tooLongLabel = structuredClone(p);
  tooLongLabel.machines[0].machineLabel = "🍬".repeat(241);
  rejects(tooLongLabel);
  const foreign = structuredClone(p);
  Object.assign(foreign.machines[0].refundCases[0], {
    rawCustomerComment: "unsupported private data",
  });
  rejects(foreign);
});
Deno.test("excerpt redaction and truncation preserve complete Unicode characters", () => {
  const result = sanitizeOperationalExcerpt("a".repeat(279) + "🍭" + "🍬");
  assert(
    result === "a".repeat(279) + "🍭" && Array.from(result!).length === 280,
    "clipping never splits a surrogate pair",
  );
  const redacted = sanitizeOperationalExcerpt(
    "🍭 private@example.test https://example.test/private ending in 1234",
  );
  assert(
    redacted?.startsWith("🍭") && !redacted.includes("private@example.test") &&
      !redacted.includes("https://") && !redacted.includes("1234"),
    "Unicode handling does not bypass redaction",
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
Deno.test("weekly uses reported snapshot comparisons and many requests do not expand into case narratives", () => {
  const variants = fixtureVariants();
  const weekly = buildMachineEmail({ projection: variants.weekly, links });
  assert(
    /previous week|last week/.test(weekly.text) &&
      !weekly.text.includes("previous complete week"),
    "coverage not overstated",
  );
  const email = buildMachineEmail({
    projection: variants["daily-long"],
    links,
  });
  assert(
    email.itemCount === 40 && !email.text.includes("RF-SYNTHETIC-49") &&
      !email.text.includes("The product did not come out"),
    "all40 requests count without a long case body",
  );
  assert(
    new TextEncoder().encode(email.html).length < 20_000,
    "many requests remain a compact digest",
  );
});
