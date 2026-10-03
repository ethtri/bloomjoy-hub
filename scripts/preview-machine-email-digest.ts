/** Local synthetic design preview only. No database, provider, or email calls. */
import { buildMachineDigestEmail } from "../supabase/functions/_shared/machine-email-digest.ts";
import {
  fixtureCase,
  fixtureId,
  fixtureMachine,
  fixtureProjection,
} from "../supabase/functions/_shared/machine-email-alert-fixtures.ts";
import { summarizeMachineEmail } from "../supabase/functions/_shared/machine-email-alert.ts";
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
  legacy: fixtureProjection(),
};
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
  Object.assign(m.digest, {
    requestAmountsAllowed: false,
    requestedAmountCents: null,
    requestedAmountKnownCount: 0,
    requestedAmountUnknownCount: m.digest.newRequestCount,
    previousRequestedAmountCents: null,
    previousRequestedAmountKnownCount: 0,
    previousRequestedAmountUnknownCount: m.digest.previousNewRequestCount,
  });
}
const links = machineEmailLinks();
const report: Record<string, unknown> = {};
for (const [name, variant] of Object.entries(variants)) {
  variant.summary = summarizeMachineEmail(variant.machines);
  const email = buildMachineDigestEmail({ projection: variant, links });
  await Deno.writeTextFile(`${directory}/${name}.html`, email.html);
  await Deno.writeTextFile(`${directory}/${name}.txt`, email.text);
  report[name] = {
    subject: email.subject,
    bytes: new TextEncoder().encode(email.html).length,
    itemCount: email.itemCount,
  };
}
console.log(JSON.stringify(report, null, 2));
