import { parseRefundManagerDailyDigestProjection } from "./refund-manager-digest.ts";

/** Recipient-scoped operational emails. No raw provider payload is accepted. */
export const MACHINE_EMAIL_ALERT_SCHEMA = "machine_email_alert_v1" as const;
export const machineEmailCategories = [
  "daily",
  "weekly",
  "new-refund",
  "sales-quiet",
  "device-offline",
] as const;
export type MachineEmailCategory = typeof machineEmailCategories[number];

export type MachineEmailCase = {
  caseId: string;
  publicReference: string;
  receivedAt: string | null;
  incidentAt: string | null;
  issueCategory: string | null;
  commentExcerpt: string | null;
  commentRedacted: true;
  commentKind?: "sanitized-narrative" | "operational-summary";
  isNew: boolean;
  isOpen: boolean;
  needsDecision: boolean;
  statusLabel: string;
  nextAction: string;
  amountCents: number | null;
  currencyCode: string | null;
  canOpenCase: boolean;
};
export type MachineEmailMachine = {
  machineId: string;
  machineLabel: string;
  locationName: string;
  timezone: string;
  dateFrom: string;
  dateTo: string;
  coverageStatus: "reported_snapshot" | "unavailable";
  coverageNote: string;
  reportingAllowed: boolean;
  includedInPerformanceScope: boolean;
  salesComplete: boolean;
  grossSalesCents: number | null;
  refundAmountCents: number | null;
  netSalesCents: number | null;
  transactionCount: number | null;
  previousGrossSalesCents: number | null;
  refundCases: MachineEmailCase[];
};
export type MachineEmailSummary = {
  machineCount: number;
  salesMachineCount: number;
  grossSalesCents: number | null;
  refundAmountCents: number | null;
  netSalesCents: number | null;
  transactionCount: number | null;
  newRequestCount: number;
  openCount: number;
  decisionCount: number;
};
export type QuietSalesSignal = {
  periodStart: string;
  periodEnd: string;
  timezone: string;
  actualTransactions: number;
  baselineTransactions: number;
  baselinePeriods: number;
  paymentScope: "all" | "cash" | "card";
  coverageVerified: true;
};
export type OfflineDeviceSignal = {
  component: string;
  firstObservedAt: string;
  lastObservedAt: string;
  observationCount: number;
  state: "offline";
  providerField: "MachineMQTTStatus";
  providerFieldValue: false;
};
export type MachineEmailProjection = {
  schemaVersion: typeof MACHINE_EMAIL_ALERT_SCHEMA;
  category: MachineEmailCategory;
  userId: string;
  observedAt: string;
  dateFrom: string;
  dateTo: string;
  timezone: string;
  machines: MachineEmailMachine[];
  reportCurrencyCode: "USD";
  summary: MachineEmailSummary;
  managerOpenCases: unknown | null;
  managerCaseMachines: { caseId: string; machineId: string }[];
  signal: QuietSalesSignal | OfflineDeviceSignal | null;
  payloadRedacted: true;
};

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("email_alert_projection_invalid");
  }
  return value as Record<string, unknown>;
};
const keys = (value: Record<string, unknown>, expected: string[]) => {
  const actual = Object.keys(value).sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, i) => key !== [...expected].sort()[i])
  ) {
    throw new Error("email_alert_projection_fields_invalid");
  }
};
const text = (value: unknown, limit = 240): string => {
  if (
    typeof value !== "string" || !value.trim() || value.length > limit ||
    Array.from(value).some((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    )
  ) {
    throw new Error("email_alert_projection_text_invalid");
  }
  return value;
};
const id = (value: unknown) => {
  const result = text(value);
  if (!uuid.test(result)) throw new Error("email_alert_projection_id_invalid");
  return result;
};
const integer = (value: unknown, signed = false): number => {
  if (!Number.isSafeInteger(value) || (!signed && (value as number) < 0)) {
    throw new Error("email_alert_projection_number_invalid");
  }
  return value as number;
};
const money = (value: unknown) => value === null ? null : integer(value, true);
const boolean = (value: unknown): boolean => {
  if (typeof value !== "boolean") {
    throw new Error("email_alert_projection_boolean_invalid");
  }
  return value;
};
const timestamp = (value: unknown): string => {
  const result = text(value, 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(result) ||
    !Number.isFinite(Date.parse(result))
  ) {
    throw new Error("email_alert_projection_time_invalid");
  }
  return result;
};
const date = (value: unknown) => {
  const result = text(value, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result
  ) {
    throw new Error("email_alert_projection_date_invalid");
  }
  return result;
};
const timezone = (value: unknown) => {
  const result = text(value, 80);
  try {
    new Intl.DateTimeFormat("en", { timeZone: result }).format(new Date());
  } catch {
    throw new Error("email_alert_projection_timezone_invalid");
  }
  return result;
};

/** An additional presentation guard, not a replacement for the authorized SQL projection. */
export const sanitizeOperationalExcerpt = (
  value: string | null,
): string | null => {
  if (value === null) return null;
  return value
    .replace(/https?:\/\/\S+|www\.\S+/gi, "[link removed]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]")
    .replace(/(?:\+?\d[\s().-]*){7,}/g, "[number removed]")
    .replace(
      /(?:last\s*(?:four|4)|ending\s*(?:in)?|card\s*(?:number|digits)?)\s*[:#-]?\s*\d{4}/gi,
      "[card details removed]",
    )
    .slice(0, 280);
};

function parseCase(value: unknown): MachineEmailCase {
  const row = object(value);
  keys(row, [
    "caseId",
    "publicReference",
    "receivedAt",
    "incidentAt",
    "issueCategory",
    "commentExcerpt",
    "commentRedacted",
    "isNew",
    "isOpen",
    "needsDecision",
    "statusLabel",
    "nextAction",
    "amountCents",
    "currencyCode",
    "canOpenCase",
    ...(row.commentKind === undefined ? [] : ["commentKind"]),
  ]);
  if (
    row.commentRedacted !== true ||
    (row.commentKind !== undefined &&
      !["sanitized-narrative", "operational-summary"].includes(
        String(row.commentKind),
      ))
  ) throw new Error("email_alert_comment_unredacted");
  const result: MachineEmailCase = {
    caseId: id(row.caseId),
    publicReference: text(row.publicReference, 100),
    receivedAt: row.receivedAt === null ? null : timestamp(row.receivedAt),
    incidentAt: row.incidentAt === null ? null : timestamp(row.incidentAt),
    issueCategory: row.issueCategory === null
      ? null
      : text(row.issueCategory, 100),
    commentExcerpt: row.commentExcerpt === null
      ? null
      : sanitizeOperationalExcerpt(text(row.commentExcerpt, 280)),
    commentRedacted: true,
    ...(row.commentKind === undefined
      ? {}
      : { commentKind: row.commentKind as MachineEmailCase["commentKind"] }),
    isNew: boolean(row.isNew),
    isOpen: boolean(row.isOpen),
    needsDecision: boolean(row.needsDecision),
    statusLabel: text(row.statusLabel, 100),
    nextAction: text(row.nextAction, 400),
    amountCents: money(row.amountCents),
    currencyCode: row.currencyCode === null ? null : text(row.currencyCode, 3),
    canOpenCase: boolean(row.canOpenCase),
  };
  if (result.currencyCode !== null && !/^[A-Z]{3}$/.test(result.currencyCode)) {
    throw new Error("email_alert_currency_invalid");
  }
  if (result.needsDecision && (!result.isOpen || !result.canOpenCase)) {
    throw new Error("email_alert_decision_scope_invalid");
  }
  if (!result.isNew && !result.isOpen) {
    throw new Error("email_alert_closed_backlog_invalid");
  }
  return result;
}

function parseMachine(value: unknown): MachineEmailMachine {
  const row = object(value);
  keys(row, [
    "machineId",
    "machineLabel",
    "locationName",
    "timezone",
    "dateFrom",
    "dateTo",
    "coverageStatus",
    "coverageNote",
    "reportingAllowed",
    "includedInPerformanceScope",
    "salesComplete",
    "grossSalesCents",
    "refundAmountCents",
    "netSalesCents",
    "transactionCount",
    "previousGrossSalesCents",
    "refundCases",
  ]);
  if (
    !["reported_snapshot", "unavailable"].includes(String(row.coverageStatus))
  ) throw new Error("email_alert_coverage_invalid");
  if (!Array.isArray(row.refundCases)) {
    throw new Error("email_alert_cases_invalid");
  }
  const machine: MachineEmailMachine = {
    machineId: id(row.machineId),
    machineLabel: text(row.machineLabel),
    locationName: text(row.locationName),
    timezone: timezone(row.timezone),
    reportingAllowed: boolean(row.reportingAllowed),
    salesComplete: boolean(row.salesComplete),
    dateFrom: date(row.dateFrom),
    dateTo: date(row.dateTo),
    coverageStatus: row.coverageStatus as MachineEmailMachine["coverageStatus"],
    coverageNote: text(row.coverageNote, 400),
    includedInPerformanceScope: boolean(row.includedInPerformanceScope),
    grossSalesCents: money(row.grossSalesCents),
    refundAmountCents: money(row.refundAmountCents),
    netSalesCents: money(row.netSalesCents),
    transactionCount: row.transactionCount === null
      ? null
      : integer(row.transactionCount),
    previousGrossSalesCents: money(row.previousGrossSalesCents),
    refundCases: row.refundCases.map(parseCase),
  };
  if (
    !machine.reportingAllowed &&
    [
      machine.grossSalesCents,
      machine.refundAmountCents,
      machine.netSalesCents,
      machine.transactionCount,
      machine.previousGrossSalesCents,
    ].some((v) => v !== null)
  ) {
    throw new Error("email_alert_financial_scope_invalid");
  }
  if (machine.dateFrom > machine.dateTo) {
    throw new Error("email_alert_period_invalid");
  }
  if (
    machine.grossSalesCents !== null && machine.refundAmountCents !== null &&
    machine.netSalesCents !== null &&
    machine.grossSalesCents - machine.refundAmountCents !==
      machine.netSalesCents
  ) {
    throw new Error("email_alert_machine_totals_invalid");
  }
  return machine;
}

export function summarizeMachineEmail(
  machines: MachineEmailMachine[],
): MachineEmailSummary {
  machines = machines.filter((m) => m.includedInPerformanceScope);
  const known = machines.filter((m) =>
    m.reportingAllowed && m.grossSalesCents !== null &&
    m.refundAmountCents !== null && m.netSalesCents !== null
  );
  const sum = (
    field:
      | "grossSalesCents"
      | "refundAmountCents"
      | "netSalesCents"
      | "transactionCount",
  ) =>
    known.length && known.every((m) => m[field] !== null)
      ? known.reduce((total, m) => total + m[field]!, 0)
      : null;
  const cases = machines.flatMap((m) => m.refundCases);
  return {
    machineCount: machines.length,
    salesMachineCount: known.length,
    grossSalesCents: sum("grossSalesCents"),
    refundAmountCents: sum("refundAmountCents"),
    netSalesCents: sum("netSalesCents"),
    transactionCount: sum("transactionCount"),
    newRequestCount: cases.filter((c) => c.isNew).length,
    openCount: cases.filter((c) => c.isOpen).length,
    decisionCount: cases.filter((c) => c.needsDecision).length,
  };
}

export function parseMachineEmailProjection(
  value: unknown,
): MachineEmailProjection {
  const row = object(value);
  keys(row, [
    "schemaVersion",
    "category",
    "userId",
    "observedAt",
    "dateFrom",
    "dateTo",
    "timezone",
    "reportCurrencyCode",
    "machines",
    "summary",
    "managerOpenCases",
    "managerCaseMachines",
    "signal",
    "payloadRedacted",
  ]);
  if (
    row.schemaVersion !== MACHINE_EMAIL_ALERT_SCHEMA ||
    row.payloadRedacted !== true ||
    !machineEmailCategories.includes(row.category as MachineEmailCategory) ||
    !Array.isArray(row.machines) || !row.machines.length
  ) {
    throw new Error("email_alert_projection_invalid");
  }
  const machines = row.machines.map(parseMachine);
  const cases = machines.flatMap((m) => m.refundCases);
  if (
    new Set(machines.map((m) => m.machineId)).size !== machines.length ||
    new Set(cases.map((c) => c.caseId)).size !== cases.length
  ) throw new Error("email_alert_duplicate_projection");
  const expected = summarizeMachineEmail(machines);
  const summary = object(row.summary);
  keys(summary, Object.keys(expected));
  if (Object.entries(expected).some(([key, value]) => summary[key] !== value)) {
    throw new Error("email_alert_summary_invalid");
  }
  // The SQL projection merges every mandatory manager item into its real machine.
  // Validate completeness against the independent canonical open-case projection.
  if (
    row.reportCurrencyCode !== "USD" || !Array.isArray(row.managerCaseMachines)
  ) throw new Error("email_alert_currency_or_mapping_invalid");
  const mappings = row.managerCaseMachines.map((raw) => {
    const mapping = object(raw);
    keys(mapping, ["caseId", "machineId"]);
    return { caseId: id(mapping.caseId), machineId: id(mapping.machineId) };
  });
  if (new Set(mappings.map((m) => m.caseId)).size !== mappings.length) {
    throw new Error("email_alert_manager_mapping_invalid");
  }
  if (row.managerOpenCases !== null) {
    const mandatory = parseRefundManagerDailyDigestProjection(
      row.managerOpenCases,
    );
    if (mappings.length !== mandatory.items.length) {
      throw new Error("email_alert_manager_coverage_invalid");
    }
    for (const raw of mandatory.items) {
      const item = object(raw);
      const projected = cases.find((c) => c.caseId === item.caseId);
      if (
        !projected?.isOpen || !projected.canOpenCase ||
        projected.needsDecision !== (item.actor === "manager")
      ) throw new Error("email_alert_manager_case_missing");
      const mapping = mappings.find((m) => m.caseId === item.caseId);
      if (
        !machines.find((m) => m.machineId === mapping?.machineId)?.refundCases
          .some((c) => c.caseId === item.caseId)
      ) throw new Error("email_alert_manager_mapping_invalid");
    }
  } else if (mappings.length) {
    throw new Error("email_alert_manager_mapping_invalid");
  }
  const projection: MachineEmailProjection = {
    schemaVersion: MACHINE_EMAIL_ALERT_SCHEMA,
    category: row.category as MachineEmailCategory,
    userId: id(row.userId),
    observedAt: timestamp(row.observedAt),
    dateFrom: date(row.dateFrom),
    dateTo: date(row.dateTo),
    timezone: timezone(row.timezone),
    machines,
    summary: expected,
    reportCurrencyCode: "USD",
    managerOpenCases: row.managerOpenCases,
    managerCaseMachines: mappings,
    signal: null,
    payloadRedacted: true,
  };
  if (projection.dateFrom > projection.dateTo) {
    throw new Error("email_alert_period_invalid");
  }
  if (projection.category === "sales-quiet") {
    if (machines.some((m) => !m.reportingAllowed)) {
      throw new Error("email_alert_quiet_financial_scope_invalid");
    }
    const signal = object(row.signal);
    keys(signal, [
      "periodStart",
      "periodEnd",
      "timezone",
      "actualTransactions",
      "baselineTransactions",
      "baselinePeriods",
      "paymentScope",
      "coverageVerified",
    ]);
    projection.signal = {
      periodStart: timestamp(signal.periodStart),
      periodEnd: timestamp(signal.periodEnd),
      timezone: timezone(signal.timezone),
      actualTransactions: integer(signal.actualTransactions),
      baselineTransactions: typeof signal.baselineTransactions === "number" &&
          Number.isFinite(signal.baselineTransactions)
        ? signal.baselineTransactions
        : 0,
      baselinePeriods: integer(signal.baselinePeriods),
      paymentScope: signal.paymentScope as QuietSalesSignal["paymentScope"],
      coverageVerified: true,
    };
    const parsed = projection.signal as QuietSalesSignal;
    if (
      signal.coverageVerified !== true ||
      !["all", "cash", "card"].includes(parsed.paymentScope) ||
      parsed.baselineTransactions <= 0 || parsed.baselinePeriods < 4 ||
      parsed.actualTransactions >= parsed.baselineTransactions ||
      Date.parse(parsed.periodStart) >= Date.parse(parsed.periodEnd) ||
      Date.parse(parsed.periodEnd) > Date.parse(projection.observedAt)
    ) throw new Error("email_alert_quiet_signal_unverified");
  } else if (projection.category === "device-offline") {
    const signal = object(row.signal);
    keys(signal, [
      "component",
      "firstObservedAt",
      "lastObservedAt",
      "observationCount",
      "state",
      "providerField",
      "providerFieldValue",
    ]);
    projection.signal = {
      component: text(signal.component, 100),
      firstObservedAt: timestamp(signal.firstObservedAt),
      lastObservedAt: timestamp(signal.lastObservedAt),
      observationCount: integer(signal.observationCount),
      state: "offline",
      providerField: signal
        .providerField as OfflineDeviceSignal["providerField"],
      providerFieldValue: false,
    };
    const parsed = projection.signal as OfflineDeviceSignal;
    if (
      signal.state !== "offline" || signal.providerFieldValue !== false ||
      parsed.providerField !== "MachineMQTTStatus" ||
      parsed.component !== "Nayax MQTT connection" ||
      parsed.observationCount < 4 ||
      Date.parse(parsed.lastObservedAt) - Date.parse(parsed.firstObservedAt) <
        15 * 60_000 ||
      Date.parse(parsed.lastObservedAt) > Date.parse(projection.observedAt) ||
      Date.parse(projection.observedAt) - Date.parse(parsed.lastObservedAt) >
        6 * 60_000
    ) throw new Error("email_alert_offline_signal_unverified");
  } else if (row.signal !== null) {
    throw new Error("email_alert_unexpected_signal");
  }
  if (
    !["daily", "weekly"].includes(projection.category) && machines.length !== 1
  ) throw new Error("email_alert_event_scope_invalid");
  if (
    projection.category === "new-refund" &&
    (cases.length !== 1 || !cases[0].isNew || cases[0].needsDecision)
  ) throw new Error("email_alert_intake_not_fyi");
  return projection;
}

const esc = (value: unknown) =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  ).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const dollars = (value: number | null) =>
  value === null
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
      .format(value / 100);
const when = (value: string, zone: string) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: zone,
  }).format(new Date(value));
const link = (url: string) => {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("email_alert_link_invalid");
  }
  return parsed.toString();
};
const reasons: Record<string, string> = {
  charged_no_product: "Charged/paid but no product",
  product_problem: "The product came out incorrectly",
  charged_more_than_once: "Charged/paid more than once",
  wrong_amount: "Wrong amount",
  partial_items: "Received fewer items than purchased",
  expected_cash_change: "Expected change from a cash payment",
  other: "Something else",
};
export type MachineEmailLinks = {
  preferencesUrl: string;
  reportUrl: string;
  caseUrl: (caseId: string) => string;
  machineUrl: (machineId: string) => string;
};
export type MachineEmailMessage = {
  subject: string;
  text: string;
  html: string;
  itemCount: number;
};

export function buildMachineEmail(
  { projection, links }: {
    projection: MachineEmailProjection;
    links: MachineEmailLinks;
  },
): MachineEmailMessage {
  // Accept only a validated projection even for direct/internal callers.
  const p = parseMachineEmailProjection(projection);
  const machine = p.machines[0];
  const daily = p.category === "daily";
  const digest = daily || p.category === "weekly";
  const period = p.dateFrom === p.dateTo
    ? p.dateFrom
    : `${p.dateFrom} to ${p.dateTo}`;
  const salesScope = p.category === "sales-quiet"
    ? (p.signal as QuietSalesSignal).paymentScope
    : "all";
  const title = digest
    ? `${daily ? "Daily operations brief" : "Weekly performance review"}`
    : p.category === "new-refund"
    ? "A customer reported a problem"
    : p.category === "sales-quiet"
    ? `${
      salesScope === "cash"
        ? "Cash sales"
        : salesScope === "card"
        ? "Card sales"
        : "Sales"
    } are quieter than usual`
    : "Nayax connection disconnected";
  const subject = digest
    ? `Bloomjoy ${daily ? "daily brief" : "weekly review"} · ${period}`
    : `${title} · ${machine.machineLabel}`;
  const plain: string[] = [
    title,
    digest
      ? `${period} · ${p.summary.machineCount} followed machines · USD`
      : `${machine.machineLabel} · ${machine.locationName}`,
    "",
  ];
  const parts: string[] = [];
  const paragraph = (value: string) => {
    plain.push(value, "");
    parts.push(`<p style="margin:0 0 16px;line-height:1.55">${esc(value)}</p>`);
  };
  const heading = (value: string, level = 2) => {
    plain.push(value, "");
    parts.push(
      `<h${level} style="font-size:${
        level === 2 ? 20 : 16
      }px;margin:26px 0 12px;color:#282c35">${esc(value)}</h${level}>`,
    );
  };
  const measures = (values: Array<[string, string]>) => {
    plain.push(...values.map(([name, value]) => `${name}: ${value}`), "");
    parts.push(
      `<table style="width:100%;border-collapse:collapse;margin:0 0 16px"><tbody>${
        values.map(([name, value]) =>
          `<tr><th scope="row" style="text-align:left;padding:8px 8px 8px 0;border-bottom:1px solid #e8dfe2;font-weight:400;color:#555660">${
            esc(name)
          }</th><td style="text-align:right;padding:8px 0;border-bottom:1px solid #e8dfe2;font-weight:700;${
            /^[\d$-]/.test(value)
              ? "white-space:nowrap;min-width:72px"
              : "overflow-wrap:anywhere"
          }">${esc(value)}</td></tr>`
        ).join("")
      }</tbody></table>`,
    );
  };
  const anchor = (label: string, url: string) => {
    const safe = link(url);
    plain.push(`${label}: ${safe}`, "");
    parts.push(
      `<p style="margin:14px 0 18px"><a href="${
        esc(safe)
      }" style="color:#7b2946;font-weight:700;text-decoration:underline">${
        esc(label)
      }</a></p>`,
    );
  };
  const renderCase = (c: MachineEmailCase, m: MachineEmailMachine) => {
    heading(`${c.publicReference} · ${c.statusLabel}`, 3);
    paragraph(
      `${
        c.receivedAt
          ? `Received ${when(c.receivedAt, m.timezone)}`
          : "Request date unavailable"
      }. Reported incident: ${
        c.incidentAt ? when(c.incidentAt, m.timezone) : "not recorded"
      }. ${m.timezone}.`,
    );
    paragraph(
      `Customer selected: ${
        c.issueCategory === null
          ? "not recorded"
          : reasons[c.issueCategory] ?? c.issueCategory
      }.`,
    );
    paragraph(
      c.commentExcerpt
        ? `${
          c.commentKind === "sanitized-narrative"
            ? "Customer comment (details removed)"
            : "Reported operational symptom"
        }: ${c.commentExcerpt}`
        : "No shareable customer comment available.",
    );
    paragraph(c.nextAction);
    if (c.needsDecision && c.amountCents !== null) {
      paragraph(
        `Prepared amount: ${
          c.currencyCode === "USD"
            ? dollars(c.amountCents)
            : `${c.currencyCode ?? "Currency not recorded"} ${
              (c.amountCents / 100).toFixed(2)
            }`
        }.`,
      );
    }
    anchor(
      c.canOpenCase
        ? `${c.needsDecision ? "Review" : "Open"} ${c.publicReference}`
        : m.reportingAllowed
        ? "View machine report"
        : "Manage this alert",
      c.canOpenCase
        ? links.caseUrl(c.caseId)
        : m.reportingAllowed
        ? links.machineUrl(m.machineId)
        : links.preferencesUrl,
    );
  };
  if (digest) {
    const s = p.summary;
    paragraph(
      `Sales available for ${s.salesMachineCount} of ${s.machineCount} machines. Missing sales are unavailable, not zero.`,
    );
    measures([[
      s.salesMachineCount === s.machineCount
        ? "Sales before refunds"
        : "Known sales subtotal before refunds",
      dollars(s.grossSalesCents),
    ], [
      "Transactions",
      s.transactionCount === null ? "Unavailable" : String(s.transactionCount),
    ], [
      "Period refund impact (same sales scope)",
      dollars(s.refundAmountCents),
    ], [
      "Sales after period refunds (same sales scope)",
      dollars(s.netSalesCents),
    ]]);
    paragraph(
      `Followed machines: ${s.newRequestCount} new requests in the period · ${s.openCount} open now${
        s.decisionCount ? ` · ${s.decisionCount} need your decision` : ""
      }. Case status as of ${when(p.observedAt, p.timezone)} (${p.timezone}).`,
    );
    paragraph(
      "Sales exclude sales tax using Hub’s current report calculation. Period refund impact includes request deductions and reversals. A later refund payment is not deducted again. Transactions do not prove successful dispensing.",
    );
    const assigned = p.machines.filter((m) => !m.includedInPerformanceScope)
      .flatMap((m) => m.refundCases);
    if (assigned.length) {
      paragraph(
        `Additional assigned refund work: ${
          assigned.filter((c) => c.isOpen).length
        } open cases · ${
          assigned.filter((c) => c.needsDecision).length
        } need your decision. These machines are separate from the followed-machine performance totals above.`,
      );
    }
    const sorted = [...p.machines].sort((a, b) =>
      Number(b.includedInPerformanceScope) -
        Number(a.includedInPerformanceScope) ||
      Number(b.refundCases.some((c) => c.needsDecision)) -
        Number(a.refundCases.some((c) => c.needsDecision)) ||
      Number(b.refundCases.length > 0) - Number(a.refundCases.length > 0) ||
      a.machineLabel.localeCompare(b.machineLabel)
    );
    let assignedHeading = false;
    for (const m of sorted) {
      if (!m.includedInPerformanceScope && !assignedHeading) {
        heading("Assigned refund work");
        paragraph(
          "Other assigned machines with open cases. Their sales and customer-work counts are not included in the followed-machine totals.",
        );
        assignedHeading = true;
      }
      heading(`${m.machineLabel} · ${m.locationName}`);
      if (m.includedInPerformanceScope) {
        paragraph(
          `${
            m.dateFrom === m.dateTo
              ? m.dateFrom
              : `${m.dateFrom} to ${m.dateTo}`
          } · ${m.timezone}.`,
        );
        if (m.reportingAllowed) {
          measures([
            ["Sales before refunds", dollars(m.grossSalesCents)],
            [
              "Transactions",
              m.transactionCount === null
                ? "Unavailable"
                : String(m.transactionCount),
            ],
            ["Period refund impact", dollars(m.refundAmountCents)],
            ["Sales after period refunds", dollars(m.netSalesCents)],
          ]);
        } else {paragraph(
            "Reporting values are outside your access for this machine.",
          );}
        if (m.reportingAllowed) paragraph(m.coverageNote);
        if (
          !daily && m.salesComplete && m.grossSalesCents !== null &&
          m.previousGrossSalesCents !== null && m.previousGrossSalesCents > 0
        ) {
          paragraph(
            `${
              ((m.grossSalesCents / m.previousGrossSalesCents - 1) * 100)
                .toFixed(1)
            }% versus the previous week’s reported sales (${
              dollars(m.previousGrossSalesCents)
            }), using the same machine and sales basis. Late imports may change this comparison.`,
          );
        }
      }
      const recent = m.refundCases.filter((c) => c.isNew);
      const earlier = m.refundCases.filter((c) => !c.isNew);
      paragraph(
        `${recent.length} new requests · ${
          m.refundCases.filter((c) => c.isOpen).length
        } open at report time.`,
      );
      if (recent.length) {
        heading("Received in this reporting period", 3);
        recent.forEach((c) => renderCase(c, m));
      } else paragraph("No new refund requests in this reporting period.");
      if (earlier.length) {
        heading("Earlier requests still open", 3);
        earlier.forEach((c) => renderCase(c, m));
      }
    }
    if (p.machines.some((m) => m.reportingAllowed)) {
      anchor("Open reports", links.reportUrl);
    }
  } else if (p.category === "new-refund") {
    paragraph(
      "This is an operational heads-up for a machine you follow. The customer’s description is a reported symptom, not a confirmed diagnosis. No refund decision is requested from you in this email.",
    );
    renderCase(machine.refundCases[0], machine);
  } else if (p.category === "sales-quiet") {
    const signal = p.signal as QuietSalesSignal;
    paragraph(`${machine.machineLabel} · ${machine.locationName}`);
    paragraph(
      `${
        signal.paymentScope === "all"
          ? "Recorded"
          : `${signal.paymentScope === "cash" ? "Cash" : "Card"}`
      } activity was lower for a completed reporting period.`,
    );
    measures([
      ["Observed transactions", String(signal.actualTransactions)],
      ["Usual median transactions", String(signal.baselineTransactions)],
      ["Comparable completed periods", String(signal.baselinePeriods)],
      [
        "Difference",
        `${
          Math.round(
            (1 - signal.actualTransactions / signal.baselineTransactions) * 100,
          )
        }% below usual`,
      ],
    ]);
    paragraph(
      `${when(signal.periodStart, signal.timezone)} to ${
        when(signal.periodEnd, signal.timezone)
      } (${signal.timezone}). Lower traffic, a venue change or a machine issue may explain the difference. Low sales alone do not establish a fault.`,
    );
    anchor(
      machine.reportingAllowed ? "Check machine activity" : "Manage this alert",
      machine.reportingAllowed
        ? links.machineUrl(machine.machineId)
        : links.preferencesUrl,
    );
  } else {
    const signal = p.signal as OfflineDeviceSignal;
    paragraph(
      `${machine.machineLabel} · ${machine.locationName}. Observation times: ${machine.timezone}.`,
    );
    measures([["Component", signal.component], [
      "First observed disconnected",
      when(signal.firstObservedAt, machine.timezone),
    ], [
      "Latest observed disconnected",
      when(signal.lastObservedAt, machine.timezone),
    ], ["Disconnected observations", String(signal.observationCount)]]);
    paragraph(
      "Nayax reports this machine’s MQTT connection disconnected. Check the device’s power and network connection. Payment processing and dispensing status are not established by this signal.",
    );
    anchor(
      machine.reportingAllowed ? "Open machine activity" : "Manage this alert",
      machine.reportingAllowed
        ? links.machineUrl(machine.machineId)
        : links.preferencesUrl,
    );
  }
  paragraph(
    digest
      ? "You receive this update for your subscribed machines."
      : "You receive this update because you follow this alert for the machine.",
  );
  anchor("Manage or turn off email alerts", links.preferencesUrl);
  const html =
    `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${
      esc(subject)
    }</title></head><body style="margin:0;background:#fbf7f8;color:#282c35;font-family:Arial,Helvetica,sans-serif"><main lang="en" dir="ltr" style="max-width:640px;margin:0 auto;padding:24px;background:#fffdfd;overflow-wrap:anywhere"><p style="margin:0 0 26px;font-weight:700;color:#7b2946;letter-spacing:1px">bloomjoy HUB</p><h1 style="font-size:26px;line-height:1.2;margin:0 0 12px">${
      esc(title)
    }</h1><p style="color:#555660;margin:0 0 24px">${
      esc(
        digest
          ? `${period} · USD · machine-local reporting dates`
          : `${machine.machineLabel} · ${machine.locationName}`,
      )
    }</p>${parts.join("")}</main></body></html>`;
  return {
    subject,
    text: plain.join("\n"),
    html,
    itemCount: p.machines.reduce((n, m) => n + m.refundCases.length, 0),
  };
}
