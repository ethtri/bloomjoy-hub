import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  downloadNayaxScheduledReport,
  normalizeNayaxScheduledReport,
  parseNayaxReportCsv,
  reportMoneyCents,
  reportTimestamp,
  requireNayaxReportDownloadUrl,
} from "./nayax-scheduled-report.ts";
import { ingestNayaxReportMail } from "./nayax-report-mail.ts";
import type { GmailMessage } from "./refund-gmail.ts";
const fixture = await Deno.readFile(
  new URL("./fixtures/nayax-scheduled-first-delivery.csv", import.meta.url),
);
const signed =
  "https://my.nayax.com/core/reports/download?file=synthetic_reference_123456789";
const b64 = (v: string) =>
  btoa(v).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const message = (): GmailMessage => ({
  id: "abcdef1234",
  internalDate: "1788469759000",
  payload: {
    headers: [
      { name: "From", value: "notifier@nayax.com" },
      { name: "To", value: "info@bloomjoysweets.com" },
      { name: "Subject", value: "Nayax Transactions Report" },
      {
        name: "Authentication-Results",
        value: "mx.google.com; dmarc=pass (p=REJECT) header.from=nayax.com",
      },
    ],
    mimeType: "text/html",
    body: { data: b64(`<a href="${signed}">Report</a>`) },
  },
});
Deno.test("actual seven-row shape keeps parent/child coverage, day-first UTC and local clocks, and unknown refund status", async () => {
  const r = await normalizeNayaxScheduledReport(fixture);
  assertEquals(r.rowCount, 7);
  assertEquals(r.actorCounts, { "2001508696": 2, "2003563806": 5 });
  assertEquals(r.observations.length, 1);
  const o = r.observations[0];
  assertEquals(o.originalTransactionId, "7000000001");
  assertEquals(o.paidAmountCents, -3210);
  assertEquals(o.providerStatus, null);
  assertEquals(o.providerStatusName, null);
  assertEquals(o.machineAuthorizedAt, "2026-09-03T12:12:08");
  assertEquals(o.authorizedAt, "2026-09-03T16:12:08Z");
  assertEquals(r.terminalEvidenceProven, false);
  assertEquals(r.reportingPeriod, null);
  assertEquals(r.settlementTimePrecision, "unknown");
});
Deno.test("header order is independent; quoted commas work; unknown/missing/duplicate headers and malformed CSV reject", () => {
  const text = new TextDecoder().decode(fixture);
  const rows = parseNayaxReportCsv(text);
  assertEquals(rows.length, 7);
  const header = Object.keys(rows[0]).reverse();
  const csv = [header, ...rows.map((r) => header.map((h) => r[h]))].map((r) =>
    r.map((v) => `"${v.replaceAll('"', '""')}"`).join(",")
  ).join("\r\n");
  assertEquals(
    parseNayaxReportCsv(csv),
    rows.map((r) => Object.fromEntries(header.map((h) => [h, r[h]]))),
  );
  assertThrows(() =>
    parseNayaxReportCsv(text.replace("transaction_id", "unknown_header"))
  );
  assertThrows(() =>
    parseNayaxReportCsv(
      text.replace("original_transaction_id", "transaction_id"),
    )
  );
  assertThrows(() => parseNayaxReportCsv(text + '\n"unterminated'));
});
Deno.test("money conversion rejects rounding, invalid dates and timezone guessing", () => {
  assertEquals(reportMoneyCents("-32.1000"), -3210);
  assertEquals(reportMoneyCents("8.80"), 880);
  assertThrows(() => reportMoneyCents("0.0010"));
  assertThrows(() => reportMoneyCents("1e4"));
  assertThrows(() => reportTimestamp("31/02/2026 10:00:00", true));
  assertThrows(() => reportTimestamp("09/03/2026 24:00:00", true));
  assertEquals(
    reportTimestamp("03/09/2026 12:07:30", false),
    "2026-09-03T12:07:30",
  );
});
Deno.test("duplicate rows deduplicate, conflicting same identities and unknown actors fail closed", async () => {
  const text = new TextDecoder().decode(fixture);
  const lines = text.trim().split(/\r?\n/);
  const refund = lines.find((l) => l.includes("7000000001"))!;
  assertEquals(
    (await normalizeNayaxScheduledReport(
      new TextEncoder().encode(text + "\n" + refund),
    )).observations.length,
    1,
  );
  await assertRejects(() =>
    normalizeNayaxScheduledReport(
      new TextEncoder().encode(
        text + "\n" + refund.replace("-32.1000", "-20.0000"),
      ),
    )
  );
  await assertRejects(() =>
    normalizeNayaxScheduledReport(
      new TextEncoder().encode(text.replaceAll("2003563806", "9999999999")),
    )
  );
});
Deno.test("only observed HTTPS download target is allowed, redirects cannot carry credentials, HTML cannot masquerade as CSV", async () => {
  for (
    const url of [
      "http://my.nayax.com/core/reports/download?file=abc",
      "https://my.nayax.com.evil.test/core/reports/download?file=abc",
      signed + "&url=https://evil.test",
      signed + "#other",
      signed.replace("/core/reports/", "/other/"),
    ]
  ) assertThrows(() => requireNayaxReportDownloadUrl(url));
  let fetched = false;
  const result = await downloadNayaxScheduledReport(
    signed,
    async (_url, options) => {
      fetched = true;
      assertEquals((options as { redirect?: string })?.redirect, "error");
      assertEquals((options as { credentials?: string })?.credentials, "omit");
      return new Response(fixture);
    },
  );
  assert(fetched);
  assertEquals(result, fixture);
  await assertRejects(() =>
    downloadNayaxScheduledReport(
      signed,
      async () =>
        new Response("", {
          status: 302,
          headers: { location: "https://evil.test" },
        }),
    )
  );
  await assertRejects(() =>
    normalizeNayaxScheduledReport(
      new TextEncoder().encode("<html>Sign in</html>"),
    )
  );
});
Deno.test("existing scheduled Gmail path downloads one linked report, stores no token and skips replay before network", async () => {
  const calls: string[] = [];
  let downloads = 0;
  const m = message();
  const result = await ingestNayaxReportMail({
    message: m,
    mailbox: "info@bloomjoysweets.com",
    getAttachment: () => Promise.reject(),
    download: async (url) => {
      assertEquals(url, signed);
      downloads++;
      return fixture;
    },
    rpc: async (name, args) => {
      calls.push(name);
      assert(!JSON.stringify(args).includes("synthetic_reference"));
      if (name === "service_get_nayax_report_message") {
        return { recorded: false };
      }
      assertEquals(
        (args.p_report as { observations: unknown[] }).observations.length,
        1,
      );
      return { recorded: true, duplicate: false };
    },
  });
  assertEquals(result, { handled: true, duplicate: false });
  assertEquals(downloads, 1);
  assertEquals(calls, [
    "service_get_nayax_report_message",
    "service_record_nayax_scheduled_report",
  ]);
  assertEquals(
    await ingestNayaxReportMail({
      message: m,
      mailbox: "info@bloomjoysweets.com",
      getAttachment: () => Promise.reject(),
      download: () => Promise.reject(),
      rpc: async () => ({ recorded: true }),
    }),
    { handled: true, duplicate: true },
  );
});
Deno.test("CSV attachments share normalization, sender failures and ambiguous links never fetch or record", async () => {
  const m = message();
  m.payload!.parts = [{
    filename: "Nayax_R0_A2001508696_D20260903_210919.csv",
    mimeType: "text/csv",
    body: { attachmentId: "attachment", size: fixture.length },
  }];
  delete m.payload!.body;
  assertEquals(
    (await ingestNayaxReportMail({
      message: m,
      mailbox: "info@bloomjoysweets.com",
      getAttachment: async () => fixture,
      download: () => Promise.reject(),
      rpc: async (name) => ({
        recorded: name === "service_record_nayax_scheduled_report",
      }),
    })).handled,
    true,
  );
  for (
    const mutate of [(m: GmailMessage) => {
      m.payload!.headers![3].value =
        "attacker.test; dmarc=pass header.from=nayax.com";
    }, (m: GmailMessage) => {
      m.payload!.body!.data = b64(
        `<a href="${signed}">Report</a><a href="${signed}b">Other</a>`,
      );
    }]
  ) {
    const m = message();
    mutate(m);
    await assertRejects(() =>
      ingestNayaxReportMail({
        message: m,
        mailbox: "info@bloomjoysweets.com",
        getAttachment: () => Promise.reject(),
        download: () => Promise.reject(new Error("must not download")),
        rpc: async () => ({ recorded: false }),
      })
    );
  }
});
