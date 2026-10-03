import type {
  MachineEmailLinks,
  MachineEmailMachine,
  MachineEmailMessage,
  MachineEmailProjection,
} from "./machine-email-alert.ts";

// The parent parser validates this optional aggregate. Older saved projections
// have no aggregate; their case decision amount is never a requested-dollar fallback.
type DigestAggregate = {
  accountId: string;
  accountName: string;
  newRequestCount: number;
  requestAmountsAllowed: boolean;
  requestedAmountCents: number | null;
  requestedAmountKnownCount: number;
  requestedAmountUnknownCount: number;
  previousNewRequestCount: number;
  previousRequestedAmountCents: number | null;
  previousRequestedAmountKnownCount: number;
  previousRequestedAmountUnknownCount: number;
};
type DigestMachine = MachineEmailMachine & { digest?: DigestAggregate };
type Totals = {
  machineCount: number;
  salesCount: number;
  salesCents: number | null;
  requestCount: number;
  requestedCents: number | null;
  unknownAmountCount: number;
  amountsRestricted: boolean;
};
const palette = {
  page: "#fbf7f8",
  paper: "#fffdfd",
  ink: "#282c35",
  muted: "#62616c",
  rose: "#923c58",
  blush: "#f8eff2",
  line: "#eadfe3",
};
const font = "Inter,'Segoe UI',Arial,Helvetica,sans-serif";
const escape = (value: string | number) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const money = (cents: number | null) =>
  cents === null ? "Unavailable" : new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
const count = (value: number, noun: string) =>
  `${value} ${noun}${value === 1 ? "" : "s"}`;
const safeUrl = (raw: string) => {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("email_alert_link_invalid");
  }
  return escape(url.toString());
};
const periodUrl = (raw: string, from: string, to: string) => {
  const url = new URL(raw);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("view", "sales");
  safeUrl(url.toString());
  return url.toString();
};
const date = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00Z`),
  );
const periodLabel = (from: string, to: string) => {
  if (from === to) {
    return date(from, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  const first = date(from, {
    month: "long",
    day: "numeric",
    ...(from.slice(0, 4) !== to.slice(0, 4) ? { year: "numeric" } : {}),
  });
  const last = from.slice(0, 7) === to.slice(0, 7)
    ? `${Number(to.slice(8, 10))}, ${to.slice(0, 4)}`
    : date(to, { month: "long", day: "numeric", year: "numeric" });
  return `${first}–${last}`;
};

function totals(machines: DigestMachine[]): Totals {
  const sales = machines.filter((m) =>
    m.reportingAllowed && m.grossSalesCents !== null
  );
  const requestCount = machines.reduce(
    (sum, m) =>
      sum + (m.digest?.newRequestCount ??
        m.refundCases.filter((c) => c.isNew).length),
    0,
  );
  const known = machines.filter((m) =>
    m.digest?.requestAmountsAllowed &&
    m.digest.requestedAmountCents !== null
  );
  const unknownAmountCount = machines.reduce(
    (sum, m) =>
      sum + (m.digest?.requestedAmountUnknownCount ??
        m.refundCases.filter((c) => c.isNew).length),
    0,
  );
  const knownAmountCount = machines.reduce(
    (sum, m) => sum + (m.digest?.requestedAmountKnownCount ?? 0),
    0,
  );
  return {
    machineCount: machines.length,
    salesCount: sales.length,
    salesCents: sales.length
      ? sales.reduce((sum, m) => sum + m.grossSalesCents!, 0)
      : null,
    requestCount,
    requestedCents: known.length && (requestCount === 0 || knownAmountCount > 0)
      ? known.reduce((sum, m) => sum + m.digest!.requestedAmountCents!, 0)
      : null,
    unknownAmountCount,
    amountsRestricted: machines.length > 0 &&
      machines.every((m) => m.digest?.requestAmountsAllowed === false),
  };
}
function requestAmount(total: Totals): string {
  if (total.amountsRestricted) return "Not shared";
  return money(total.requestedCents) +
    (total.requestedCents !== null && total.unknownAmountCount > 0
      ? " known"
      : "");
}
function requestCaption(total: Totals): string {
  return count(total.requestCount, "request") +
    (total.requestedCents !== null && total.unknownAmountCount > 0
      ? ` · ${total.unknownAmountCount} amount${
        total.unknownAmountCount === 1 ? "" : "s"
      } unavailable`
      : "");
}
function weeklyInsights(machines: DigestMachine[]): string[] {
  const insights: string[] = [];
  const comparable = machines.filter((m) =>
    m.reportingAllowed && m.grossSalesCents !== null &&
    m.previousGrossSalesCents !== null
  );
  if (comparable.length) {
    const current = comparable.reduce((sum, m) => sum + m.grossSalesCents!, 0);
    const previous = comparable.reduce(
      (sum, m) => sum + m.previousGrossSalesCents!,
      0,
    );
    const difference = current - previous;
    const movement = difference === 0
      ? "unchanged"
      : previous > 0
      ? `${Math.abs(difference / previous * 100).toFixed(1)}% ${
        difference > 0 ? "higher" : "lower"
      }`
      : `${money(Math.abs(difference))} ${difference > 0 ? "higher" : "lower"}`;
    insights.push(
      `Sales ${movement}${
        previous > 0 && difference !== 0
          ? ` (${difference > 0 ? "+" : "−"}${money(Math.abs(difference))})`
          : ""
      } vs the previous week’s reported sales${
        comparable.length < machines.length
          ? ` (${count(comparable.length, "comparable machine")})`
          : ""
      }.`,
    );
  }
  const intake = machines.filter((m) => m.digest !== undefined);
  if (intake.length) {
    const current = intake.reduce(
      (sum, m) => sum + m.digest!.newRequestCount,
      0,
    );
    const previous = intake.reduce(
      (sum, m) => sum + m.digest!.previousNewRequestCount,
      0,
    );
    const difference = current - previous;
    insights.push(
      `${count(current, "new request")}, ${
        difference === 0
          ? "unchanged from"
          : `${Math.abs(difference)} ${difference > 0 ? "more" : "fewer"} than`
      } last week${
        intake.length < machines.length
          ? ` (${count(intake.length, "comparable machine")})`
          : ""
      }.`,
    );
  }
  return insights;
}

/** Compact presentation only. The caller must provide a parsed recipient projection. */
export function buildMachineDigestEmail(
  { projection: p, links }: {
    projection: MachineEmailProjection;
    links: MachineEmailLinks;
  },
): MachineEmailMessage {
  if (p.category !== "daily" && p.category !== "weekly") {
    throw new Error("email_alert_digest_category_invalid");
  }
  const daily = p.category === "daily";
  const machines: DigestMachine[] = p.machines.filter((m) =>
    m.includedInPerformanceScope
  );
  const total = totals(machines);
  const title = `${daily ? "Daily" : "Weekly"} sales & refunds`;
  const period = periodLabel(p.dateFrom, p.dateTo);
  const subject = `Bloomjoy ${daily ? "daily" : "weekly"} · ${period}`;
  const salesValue = money(total.salesCents);
  const salesCaption = total.salesCount === total.machineCount
    ? count(total.machineCount, "machine")
    : `${total.salesCount} of ${total.machineCount} machines reporting`;
  const partialSales = total.salesCount > 0 &&
    total.salesCount < total.machineCount;
  const requested = requestAmount(total);
  const requestDetail = requestCaption(total).replace("request", "new request");
  const requestedMetric = total.requestedCents === null
    ? requested
    : money(total.requestedCents);
  const requestedMetricCaption =
    (total.requestedCents !== null && total.unknownAmountCount > 0
      ? "Known amount · "
      : "") + requestDetail;
  const preheader = `Sales ${salesValue}${partialSales ? " known" : ""}. ` +
    `Refunds requested ${requested}. ${
      count(total.requestCount, "new request")
    }.`;
  const plain = [
    "Bloomjoy Hub",
    title,
    period,
    "",
    `Sales: ${salesValue}${partialSales ? " known" : ""} · ${salesCaption}`,
    `Refunds requested: ${requested} · ${requestDetail}`,
    "",
  ];
  const insights = daily ? [] : weeklyInsights(machines);
  if (insights.length) plain.push("This week", ...insights, "");
  const groups = new Map<
    string,
    { name: string | null; machines: DigestMachine[] }
  >();
  for (const machine of machines) {
    const key = machine.digest?.accountId ?? "ungrouped";
    const group = groups.get(key) ?? {
      name: machine.digest?.accountName ?? null,
      machines: [],
    };
    group.machines.push(machine);
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((a, b) =>
    a.name === null
      ? (b.name === null ? 0 : 1)
      : b.name === null
      ? -1
      : a.name.localeCompare(b.name)
  );
  const numberCell = (value: string, caption = "", bold = false) =>
    `<td class="number" style="padding:13px 10px;text-align:right;vertical-align:top;color:${palette.ink};font-size:15px;line-height:1.45;font-variant-numeric:tabular-nums;font-weight:${
      bold ? 700 : 600
    };overflow-wrap:anywhere">${escape(value)}${
      caption
        ? `<div class="caption" style="margin-top:3px;font-size:12px;font-weight:400;color:${palette.muted};line-height:1.5">${
          escape(caption)
        }</div>`
        : ""
    }</td>`;
  const rows: string[] = [];
  for (const group of ordered) {
    const groupTotal = totals(group.machines);
    const groupSales = money(groupTotal.salesCents);
    const groupPartial = groupTotal.salesCount < groupTotal.machineCount &&
      groupTotal.salesCount > 0;
    if (group.name !== null || ordered.length > 1) {
      const name = group.name ?? "Company unavailable";
      plain.push(
        `${name} · Sales ${groupSales}${groupPartial ? " known" : ""} · ` +
          `Refunds requested ${requestAmount(groupTotal)} (${
            requestCaption(groupTotal)
          })`,
      );
      rows.push(
        `<tr style="background:${palette.blush}"><th scope="row" style="padding:14px 10px;text-align:left;vertical-align:top;font-size:15px;font-weight:700;line-height:1.4;overflow-wrap:anywhere">${
          escape(name)
        }</th>${
          numberCell(groupSales, groupPartial ? "Known sales" : "", true)
        }${
          numberCell(
            requestAmount(groupTotal),
            requestCaption(groupTotal),
            true,
          )
        }</tr>`,
      );
    }
    for (
      const machine of [...group.machines].sort((a, b) =>
        a.machineLabel.localeCompare(b.machineLabel)
      )
    ) {
      const machineTotal = totals([machine]);
      const label = escape(machine.machineLabel);
      const name = machine.reportingAllowed
        ? `<a href="${
          safeUrl(
            periodUrl(
              links.machineUrl(machine.machineId),
              machine.dateFrom,
              machine.dateTo,
            ),
          )
        }" style="color:${palette.ink};text-decoration:underline;text-decoration-color:${palette.line};text-underline-offset:3px">${label}</a>`
        : label;
      const location = machine.locationName !== machine.machineLabel
        ? machine.locationName
        : "";
      const differentPeriod = machine.dateFrom !== p.dateFrom ||
        machine.dateTo !== p.dateTo;
      const localPeriod = differentPeriod
        ? machine.dateFrom === machine.dateTo
          ? date(machine.dateFrom, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
          : periodLabel(machine.dateFrom, machine.dateTo)
        : "";
      rows.push(
        `<tr style="border-bottom:1px solid ${palette.line}"><th scope="row" style="padding:13px 10px;text-align:left;vertical-align:top;font-size:15px;font-weight:500;line-height:1.45;overflow-wrap:anywhere">${name}${
          location
            ? `<div class="caption" style="margin-top:3px;color:${palette.muted};font-size:12px;font-weight:400;line-height:1.5">${
              escape(location)
            }</div>`
            : ""
        }${
          localPeriod
            ? `<div class="caption" style="margin-top:3px;color:${palette.muted};font-size:12px;font-weight:400;line-height:1.5">${
              escape(localPeriod)
            }</div>`
            : ""
        }</th>${
          numberCell(
            machine.reportingAllowed
              ? money(machine.grossSalesCents)
              : "Not shared",
          )
        }${
          numberCell(requestAmount(machineTotal), requestCaption(machineTotal))
        }</tr>`,
      );
      plain.push(
        `${machine.machineLabel}${location ? ` · ${location}` : ""}${
          localPeriod ? ` · ${localPeriod}` : ""
        }: ` +
          `Sales ${
            machine.reportingAllowed
              ? money(machine.grossSalesCents)
              : "Not shared"
          }; ` +
          `refunds requested ${requestAmount(machineTotal)} (${
            requestCaption(machineTotal)
          }).`,
      );
    }
    plain.push("");
  }
  const hasReporting = machines.some((m) => m.reportingAllowed);
  const reportDestination = hasReporting
    ? periodUrl(links.reportUrl, p.dateFrom, p.dateTo)
    : null;
  const reportUrl = reportDestination ? safeUrl(reportDestination) : null;
  const preferencesUrl = safeUrl(links.preferencesUrl);
  const basis =
    "USD · Machine-local dates · Sales before refunds, excluding tax. " +
    "Requested amounts are not completed payments. Late imports may update sales.";
  plain.push(basis, "");
  if (hasReporting) plain.push(`Open reporting: ${reportDestination}`, "");
  plain.push(`Email preferences: ${links.preferencesUrl}`);
  const metric = (label: string, value: string, caption: string, extra = "") =>
    `<td class="metric" width="50%" style="width:50%;vertical-align:top;padding:0 ${
      extra ? "0 0 16px" : "16px 0 0"
    };${extra}"><p class="metric-label" style="margin:0 0 8px;color:${palette.muted};font-size:14px;line-height:1.4;font-weight:600">${
      escape(label)
    }</p><p class="metric-value${
      /^[A-Za-z]/.test(value) ? " metric-status" : ""
    }" style="margin:0;color:${palette.ink};font-size:${
      /^[A-Za-z]/.test(value) ? 22 : 30
    }px;line-height:1.2;font-weight:700;letter-spacing:-0.6px;overflow-wrap:anywhere">${
      escape(value)
    }</p><p style="margin:8px 0 0;color:${palette.muted};font-size:13px;line-height:1.5">${
      escape(caption)
    }</p></td>`;
  const html =
    `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${
      escape(subject)
    }</title><style>@media only screen and (max-width:480px){.outer{padding:0!important}.content{padding:24px 16px!important}.metric-value{font-size:25px!important;letter-spacing:-.5px!important}.metric{padding-right:10px!important}.data-table .number{font-size:14px!important;padding:12px 6px!important}.data-table th{padding:12px 6px!important;font-size:14px!important}.data-table .caption{font-size:12px!important}.data-table .name-col{width:37%!important}.data-table .sales-col{width:30%!important}.data-table .requests-col{width:33%!important}.report-action{display:block!important;text-align:center!important}.email-title{font-size:25px!important}.metric-status{font-size:20px!important}}@media only screen and (max-width:360px){.metric-label{min-height:40px}}</style></head><body style="margin:0;padding:0;background:${palette.page};color:${palette.ink};font-family:${font};-webkit-text-size-adjust:100%"><div lang="en" dir="ltr" style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0">${
      escape(preheader)
    }</div><table role="presentation" lang="en" dir="ltr" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:${palette.page}"><tr><td class="outer" align="center" style="padding:28px 12px"><table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;border-collapse:collapse;background:${palette.paper}"><tr><td class="content" style="padding:32px"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px"><tr><td style="padding-right:10px"><img src="https://app.bloomjoyusa.com/bloomjoy-icon.png" width="36" height="36" alt="" style="display:block;border:0;width:36px;height:36px"></td><td style="font-size:17px;font-weight:700;letter-spacing:-.2px;color:${palette.rose}">Bloomjoy Hub</td></tr></table><h1 class="email-title" style="margin:0 0 8px;font-size:28px;line-height:1.25;letter-spacing:-.6px;font-weight:700">${
      escape(title)
    }</h1><p style="margin:0 0 30px;color:${palette.muted};font-size:15px;line-height:1.5">${
      escape(period)
    }</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:30px"><tr>${
      metric(partialSales ? "Known sales" : "Sales", salesValue, salesCaption)
    }${
      metric(
        "Refunds requested",
        requestedMetric,
        requestedMetricCaption,
        `border-left:1px solid ${palette.line}`,
      )
    }</tr></table>${
      insights.length
        ? `<div style="margin:0 0 25px;padding:16px 0;border-top:1px solid ${palette.line};border-bottom:1px solid ${palette.line}"><h2 style="margin:0 0 8px;font-size:15px;line-height:1.4">This week</h2>${
          insights.map((insight) =>
            `<p style="margin:5px 0;color:${palette.ink};font-size:14px;line-height:1.6">${
              escape(insight)
            }</p>`
          ).join("")
        }</div>`
        : ""
    }<table class="data-table" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;border-collapse:collapse"><colgroup><col class="name-col" style="width:44%"><col class="sales-col" style="width:25%"><col class="requests-col" style="width:31%"></colgroup><thead><tr><th scope="col" style="text-align:left;padding:0 10px 12px;font-size:13px;color:${palette.muted};font-weight:600">Machine</th><th scope="col" style="text-align:right;padding:0 10px 12px;font-size:13px;color:${palette.muted};font-weight:600">Sales</th><th scope="col" style="text-align:right;padding:0 10px 12px;font-size:13px;color:${palette.muted};font-weight:600">New refunds</th></tr></thead><tbody>${
      rows.join("")
    }</tbody></table>${
      reportUrl
        ? `<div style="margin:28px 0;text-align:center"><a class="report-action" href="${reportUrl}" style="display:inline-block;padding:13px 24px;background:${palette.rose};color:#fffdfd;border-radius:7px;font-size:15px;line-height:20px;font-weight:600;text-decoration:none">Open reporting</a></div>`
        : ""
    }<div style="margin-top:26px;padding-top:18px;border-top:1px solid ${palette.line}"><p style="margin:0 0 14px;font-size:12px;line-height:1.7;color:${palette.muted}">${
      escape(basis)
    }</p><a href="${preferencesUrl}" style="color:${palette.muted};font-size:13px;line-height:1.6;text-decoration:underline">Email preferences</a></div></td></tr></table></td></tr></table></body></html>`;
  return {
    subject,
    html,
    text: plain.join("\n"),
    itemCount: total.requestCount,
  };
}
