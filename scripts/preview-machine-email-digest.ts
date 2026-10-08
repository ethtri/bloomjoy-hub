/** Local synthetic design preview only. No database, provider, or email calls. */
import {
  fixtureCase,
  fixtureId,
  fixtureMachine,
  fixtureProjection,
  fixtureSalesMetrics,
} from "../supabase/functions/_shared/machine-email-alert-fixtures.ts";
import {
  buildMachineEmail,
  summarizeMachineEmail,
} from "../supabase/functions/_shared/machine-email-alert.ts";
import { machineEmailLinks } from "../supabase/functions/_shared/machine-email-alert-delivery.ts";

const directory = "output/playwright/email-digest-redesign";
await Deno.mkdir(directory, { recursive: true });
const companies = ["Bloomjoy Enterprises", "Bloomjoy NC", "TGPaci"];
const details = [
  ["Harbor Mall", "BJ-014 · North entrance", 42000, 1000, 1],
  ["Midtown", "BJ-021 · Station foyer", 54400, 1000, 1],
  ["Pine Square", "BJ-032 · Ground floor", 52800, 1800, 2],
  ["West Arcade", "BJ-061 · Upper level", 35000, 0, 0],
  ["Westfield Center", "BJ-072 · Food court", 31000, 1000, 1],
  ["Riverwalk", "BJ-083 · Main entrance", 22000, 0, 0],
] as const;
const projection = fixtureProjection();
projection.dateFrom = projection.dateTo = "2026-10-02";
projection.managerOpenCases = null;
projection.managerCaseMachines = [];
const machines = details.map((
  [name, location, sales, requested, requests],
  i,
) => ({
  ...fixtureMachine(i + 101, {
    machineLabel: name,
    locationName: location,
    dateFrom: projection.dateFrom,
    dateTo: projection.dateTo,
    grossSalesCents: sales,
    refundAmountCents: 0,
    netSalesCents: sales,
    previousGrossSalesCents: sales - 3000,
    refundCases: Array.from(
      { length: requests },
      (_, caseIndex) =>
        fixtureCase(1000 + i * 10 + caseIndex, {
          receivedAt: "2026-10-02T19:00:00Z",
          incidentAt: "2026-10-02T18:50:00Z",
        }),
    ),
  }),
  digest: {
    accountId: fixtureId(600 + Math.floor(i / 2)),
    accountName: companies[Math.floor(i / 2)],
    newRequestCount: requests,
    requestAmountsAllowed: true,
    requestedAmountCents: requested as number | null,
    requestedAmountKnownCount: requests as number,
    requestedAmountUnknownCount: 0,
    previousNewRequestCount: 2,
    previousRequestedAmountCents: 2000,
    previousRequestedAmountKnownCount: 2,
    previousRequestedAmountUnknownCount: 0,
  },
}));
projection.machines = machines;
projection.summary = summarizeMachineEmail(machines);
const variants = {
  daily: projection,
  weekly: structuredClone(projection),
  partial: structuredClone(projection),
  technician: structuredClone(projection),
  "technician-request": structuredClone(projection),
  legacy: fixtureProjection(),
  "sales-evidence": structuredClone(projection),
  "oct7-reproduction": structuredClone(projection),
};
const evidence = variants["sales-evidence"];
const states = [
  fixtureSalesMetrics(null),
  fixtureSalesMetrics(null, {
    importedSalesComponentCount: 2,
    componentCount: 2,
    salesExTax: {
      state: "unavailable",
      knownSubtotal: null,
      unresolvedCount: 2,
      reason: "normalization_unresolved",
    },
    transactions: {
      state: "reported",
      knownSubtotal: 7,
      unresolvedCount: 0,
      reason: "reported_snapshot",
    },
  }),
  fixtureSalesMetrics(800, {
    importedSalesComponentCount: 2,
    componentCount: 2,
    salesExTax: {
      state: "partial",
      knownSubtotal: 800,
      unresolvedCount: 1,
      reason: "normalization_unresolved",
    },
  }),
  fixtureSalesMetrics(0, { sourceCoverage: "verified_complete" }),
];
evidence.machines = states.map((salesMetrics, i) => ({
  ...machines[i],
  machineLabel: [
    "No recorded sales",
    "Unresolved card tax / amount basis",
    "Partial cash and card sales",
    "Verified zero sales",
  ][i],
  salesMetrics,
  previousSalesMetrics: fixtureSalesMetrics(null),
  grossSalesCents: null,
  netSalesCents: null,
  refundAmountCents: null,
}));
const oct7 = variants["oct7-reproduction"];
oct7.dateFrom = oct7.dateTo = "2026-10-07";
oct7.machines = Array.from({ length: 41 }, (_, i) => {
  const amount = i < 16 ? (i === 15 ? 4627 : 4100) : null;
  return {
    ...machines[0],
    machineId: fixtureId(2000 + i),
    machineLabel: `Sample machine ${String(i + 1).padStart(2, "0")}`,
    dateFrom: oct7.dateFrom,
    dateTo: oct7.dateTo,
    grossSalesCents: amount,
    refundAmountCents: amount === null ? null : 0,
    netSalesCents: amount,
    refundCases: [],
    salesMetrics: fixtureSalesMetrics(amount),
    previousSalesMetrics: fixtureSalesMetrics(null),
    digest: {
      ...machines[0].digest,
      newRequestCount: 0,
      requestedAmountCents: 0,
      requestedAmountKnownCount: 0,
    },
  };
});
variants.weekly.category = "weekly";
variants.weekly.dateFrom = "2026-09-21";
variants.weekly.dateTo = "2026-09-27";
for (const m of variants.weekly.machines) {
  m.dateFrom = variants.weekly.dateFrom;
  m.dateTo = variants.weekly.dateTo;
  for (const request of m.refundCases) {
    request.receivedAt = "2026-09-24T19:00:00Z";
    request.incidentAt = request.receivedAt;
  }
}
const partial = variants.partial.machines as typeof machines;
partial[4].digest.requestedAmountKnownCount = 0;
partial[4].digest.requestedAmountUnknownCount = 1;
partial[4].digest.requestedAmountCents = null;
Object.assign(partial[5], {
  grossSalesCents: null,
  refundAmountCents: null,
  netSalesCents: null,
  transactionCount: null,
  previousGrossSalesCents: null,
  salesComplete: false,
  coverageStatus: "unavailable",
});
for (const m of variants.technician.machines as typeof machines) {
  Object.assign(m, {
    reportingAllowed: false,
    salesComplete: false,
    coverageStatus: "unavailable",
    grossSalesCents: null,
    refundAmountCents: null,
    netSalesCents: null,
    transactionCount: null,
    previousGrossSalesCents: null,
  });
  for (const c of m.refundCases) {
    Object.assign(c, {
      amountCents: null,
      currencyCode: null,
      canOpenCase: true,
      needsDecision: false,
    });
  }
}
const request = variants["technician-request"];
request.category = "new-refund";
request.machines = [structuredClone(variants.technician.machines[0])];
delete request.machines[0].digest;
Object.assign(request.machines[0].refundCases[0], {
  requestedAmountCents: 1000,
  nextAction: "View the request in Bloomjoy Hub.",
});
const links = machineEmailLinks();
const report: Record<string, unknown> = {};
for (const [name, variant] of Object.entries(variants)) {
  variant.summary = summarizeMachineEmail(variant.machines);
  const email = buildMachineEmail({ projection: variant, links });
  await Deno.writeTextFile(`${directory}/${name}.html`, email.html);
  await Deno.writeTextFile(`${directory}/${name}.txt`, email.text);
  report[name] = {
    subject: email.subject,
    bytes: new TextEncoder().encode(email.html).length,
    itemCount: email.itemCount,
  };
}
console.log(JSON.stringify(report, null, 2));
