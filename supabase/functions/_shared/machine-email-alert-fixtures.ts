import {
  type MachineEmailCase,
  type MachineEmailDigest,
  type MachineEmailMachine,
  type MachineEmailProjection,
  summarizeMachineEmail,
} from "./machine-email-alert.ts";

/** Synthetic, local-only fixtures. No customer or production identity. */
export const fixtureId = (n: number) =>
  `12810000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const fixtureCase = (
  n = 1,
  overrides: Partial<MachineEmailCase> = {},
): MachineEmailCase => ({
  caseId: fixtureId(n),
  publicReference: `RF-SYNTHETIC-${n}`,
  receivedAt: "2026-10-01T19:00:00Z",
  incidentAt: "2026-10-01T18:50:00Z",
  issueCategory: "charged_no_product",
  commentExcerpt:
    "The cup stopped moving and no product came out. The display still showed the purchase screen.",
  commentRedacted: true,
  commentKind: "sanitized-narrative",
  isNew: true,
  isOpen: true,
  needsDecision: false,
  statusLabel: "Preparing request",
  nextAction:
    "Bloomjoy is preparing the purchase evidence. No decision is needed from you yet.",
  amountCents: 1000,
  currencyCode: "USD",
  canOpenCase: true,
  ...overrides,
});
export const fixtureDigest = (
  overrides: Partial<MachineEmailDigest> = {},
): MachineEmailDigest => ({
  accountId: fixtureId(501),
  accountName: "TGPaci",
  newRequestCount: 1,
  requestAmountsAllowed: true,
  requestedAmountCents: 1000,
  requestedAmountKnownCount: 1,
  requestedAmountUnknownCount: 0,
  previousNewRequestCount: 1,
  previousRequestedAmountCents: 800,
  previousRequestedAmountKnownCount: 1,
  previousRequestedAmountUnknownCount: 0,
  ...overrides,
});
export const fixtureMachine = (
  n = 101,
  overrides: Partial<MachineEmailMachine> = {},
): MachineEmailMachine => ({
  machineId: fixtureId(n),
  machineLabel: "BJ-014 · Harbor Mall",
  locationName: "North entrance",
  timezone: "America/Los_Angeles",
  dateFrom: "2026-10-01",
  dateTo: "2026-10-01",
  coverageStatus: "reported_snapshot",
  coverageNote:
    "Based on currently reported records; delayed imports may change totals.",
  reportingAllowed: true,
  includedInPerformanceScope: true,
  salesComplete: true,
  grossSalesCents: 42000,
  refundAmountCents: 2000,
  netSalesCents: 40000,
  transactionCount: 42,
  previousGrossSalesCents: 40000,
  refundCases: [fixtureCase()],
  ...overrides,
});
export function fixtureProjection(): MachineEmailProjection {
  const machines = [
    fixtureMachine(101, {
      digest: fixtureDigest({
        newRequestCount: 2,
        requestedAmountCents: 1800,
        requestedAmountKnownCount: 2,
      }),
      refundCases: [
        fixtureCase(1),
        fixtureCase(2, {
          isOpen: false,
          statusLabel: "Gift card issued",
          nextAction:
            "Gift card value has been issued. It is not deducted from these sales again.",
        }),
      ],
    }),
    fixtureMachine(102, {
      digest: fixtureDigest({
        accountId: fixtureId(502),
        accountName: "Bloomjoy NC",
        newRequestCount: 0,
        requestedAmountCents: 0,
        requestedAmountKnownCount: 0,
      }),
      machineLabel: "BJ-061 · West Arcade",
      locationName: "Upper level",
      salesComplete: false,
      coverageStatus: "unavailable",
      coverageNote:
        "No usable reported sales for this period. Refund information is current.",
      grossSalesCents: null,
      refundAmountCents: null,
      netSalesCents: null,
      transactionCount: null,
      previousGrossSalesCents: null,
      refundCases: [],
    }),
    fixtureMachine(103, {
      digest: fixtureDigest({
        accountId: fixtureId(503),
        accountName: "Bloomjoy Enterprises",
        newRequestCount: 0,
        requestedAmountCents: 0,
        requestedAmountKnownCount: 0,
      }),
      machineLabel: "BJ-021 · Midtown",
      locationName: "Station foyer",
      includedInPerformanceScope: false,
      salesComplete: false,
      coverageStatus: "unavailable",
      grossSalesCents: null,
      refundAmountCents: null,
      netSalesCents: null,
      transactionCount: null,
      previousGrossSalesCents: null,
      refundCases: [fixtureCase(3, {
        receivedAt: "2026-09-29T19:00:00Z",
        incidentAt: "2026-09-29T18:50:00Z",
        isNew: false,
        needsDecision: true,
        statusLabel: "Ready for your decision",
        nextAction:
          "Review the saved purchase evidence and approve or deny the prepared refund in Hub. No payment has been sent.",
      })],
    }),
  ];
  return {
    schemaVersion: "machine_email_alert_v1",
    category: "daily",
    userId: fixtureId(900),
    observedAt: "2026-10-02T15:00:00Z",
    dateFrom: "2026-10-01",
    dateTo: "2026-10-01",
    timezone: "America/Los_Angeles",
    reportCurrencyCode: "USD",
    machines,
    summary: summarizeMachineEmail(machines),
    managerOpenCases: {
      schemaVersion: "refund_manager_daily_digest_v3",
      observedAt: "2026-10-02T15:00:00Z",
      actionCount: 1,
      openCount: 1,
      items: [{
        caseId: fixtureId(3),
        publicReference: "RF-SYNTHETIC-3",
        amountCents: 1000,
        currencyCode: "USD",
        machineLabel: "BJ-021 · Midtown",
        locationName: "Station foyer",
        ageMinutes: 3600,
        actor: "manager",
        actionCode: "approve_or_deny_request",
        actionLabel: "Review and decide",
        recommendationKind: null,
        recommendationReasonCode: null,
        evidenceBasis: "card_exact_selected",
        preparationSummary: "The saved Nayax purchase matches this request.",
        paymentComplete: false,
        payloadRedacted: true,
      }],
      payloadRedacted: true,
    },
    managerCaseMachines: [{ caseId: fixtureId(3), machineId: fixtureId(103) }],
    signal: null,
    payloadRedacted: true,
  };
}
export function fixtureVariants(): Record<string, MachineEmailProjection> {
  const daily = fixtureProjection();
  const weekly = structuredClone(daily);
  weekly.category = "weekly";
  weekly.dateFrom = "2026-09-21";
  weekly.dateTo = "2026-09-27";
  for (const m of weekly.machines) {
    m.dateFrom = weekly.dateFrom;
    m.dateTo = weekly.dateTo;
    for (const c of m.refundCases) {
      c.receivedAt = c.isNew ? "2026-09-24T19:00:00Z" : "2026-09-20T19:00:00Z";
      c.incidentAt = c.receivedAt;
    }
  }
  const intake = structuredClone(daily);
  intake.category = "new-refund";
  intake.managerOpenCases = null;
  intake.managerCaseMachines = [];
  intake.machines = [fixtureMachine(101, {
    refundCases: [fixtureCase(1, {
      canOpenCase: true,
      amountCents: null,
      currencyCode: null,
      requestedAmountCents: 1000,
      commentKind: "sanitized-narrative",
      nextAction: "View the request in Bloomjoy Hub.",
    })],
  })];
  intake.summary = summarizeMachineEmail(intake.machines);
  const quiet = structuredClone(intake);
  quiet.category = "sales-quiet";
  quiet.machines[0].refundCases = [];
  quiet.summary = summarizeMachineEmail(quiet.machines);
  quiet.signal = {
    periodStart: "2026-10-01T07:00:00Z",
    periodEnd: "2026-10-02T07:00:00Z",
    timezone: "America/Los_Angeles",
    actualTransactions: 2,
    baselineTransactions: 12.5,
    baselinePeriods: 4,
    paymentScope: "cash",
    coverageVerified: true,
  };
  const offline = structuredClone(quiet);
  offline.category = "device-offline";
  offline.signal = {
    component: "Nayax MQTT connection",
    priorOnlineObservedAt: "2026-10-02T14:35:00Z",
    firstObservedAt: "2026-10-02T14:40:00Z",
    lastObservedAt: "2026-10-02T15:00:00Z",
    observationCount: 5,
    state: "offline",
    providerField: "MachineMQTTStatus",
    providerFieldValue: false,
  };
  const long = structuredClone(daily);
  long.managerOpenCases = null;
  long.managerCaseMachines = [];
  long.machines = [fixtureMachine(101, {
    digest: fixtureDigest({
      newRequestCount: 40,
      requestedAmountCents: 40000,
      requestedAmountKnownCount: 40,
    }),
    refundCases: Array.from({ length: 40 }, (_, i) =>
      fixtureCase(i + 10, {
        commentExcerpt:
          "The product did not come out after the screen said the payment was accepted. I waited and checked the collection area twice before submitting this request. The display remained on the same purchase screen and the next person reported the same symptom.",
      })),
  })];
  long.summary = summarizeMachineEmail(long.machines);
  const companies = structuredClone(daily);
  companies.managerOpenCases = null;
  companies.managerCaseMachines = [];
  companies.machines = [
    structuredClone(daily.machines[0]),
    fixtureMachine(104, {
      machineLabel: "BJ-021 · Midtown",
      locationName: "Station foyer",
      grossSalesCents: 33600,
      refundAmountCents: 1500,
      netSalesCents: 32100,
      transactionCount: 35,
      previousGrossSalesCents: 30000,
      refundCases: [fixtureCase(4)],
      digest: fixtureDigest({
        accountId: fixtureId(502),
        accountName: "Bloomjoy NC",
        requestedAmountCents: 800,
      }),
    }),
    fixtureMachine(105, {
      machineLabel: "BJ-032 · Pine Square",
      locationName: "Food court",
      grossSalesCents: 24000,
      refundAmountCents: 0,
      netSalesCents: 24000,
      transactionCount: 25,
      previousGrossSalesCents: 28000,
      refundCases: [],
      digest: fixtureDigest({
        accountId: fixtureId(503),
        accountName: "Bloomjoy Enterprises",
        newRequestCount: 0,
        requestedAmountCents: 0,
        requestedAmountKnownCount: 0,
        previousNewRequestCount: 0,
        previousRequestedAmountCents: 0,
        previousRequestedAmountKnownCount: 0,
      }),
    }),
  ];
  companies.summary = summarizeMachineEmail(companies.machines);
  const weeklyCompanies = structuredClone(companies);
  weeklyCompanies.category = "weekly";
  weeklyCompanies.dateFrom = weekly.dateFrom;
  weeklyCompanies.dateTo = weekly.dateTo;
  for (const m of weeklyCompanies.machines) {
    m.dateFrom = weekly.dateFrom;
    m.dateTo = weekly.dateTo;
    for (const c of m.refundCases) {
      c.receivedAt = "2026-09-24T19:00:00Z";
      c.incidentAt = c.receivedAt;
    }
  }
  return {
    daily,
    weekly,
    "new-refund": intake,
    "sales-quiet": quiet,
    "device-offline": offline,
    "daily-long": long,
    "daily-companies": companies,
    "weekly-companies": weeklyCompanies,
  };
}

export const fixtureReadyNotice = {
  schemaVersion: "refund_manager_ready_notice_v2",
  caseId: fixtureId(3),
  managerUserId: fixtureId(900),
  decisionFingerprint: "a".repeat(64),
  proofId: fixtureId(999),
  officialActionVersion: 1,
  deterministicFactVersion: 1,
  actionCode: "approve_or_deny_request",
  recommendationKind: null,
  recommendationReasonCode: null,
  evidenceBasis: "card_exact_selected",
  preparationSummary: "Saved purchase evidence supports a final decision.",
  publicReference: "RF-SYNTHETIC-3",
  amountCents: 1000,
  currencyCode: "USD",
  machineLabel: "BJ-021 · Midtown",
  locationName: "Station foyer",
  payloadRedacted: true,
} as const;
