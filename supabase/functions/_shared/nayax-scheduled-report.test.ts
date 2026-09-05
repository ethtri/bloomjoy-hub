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
import {
  ingestNayaxReportMail,
  nayaxReportFailureCode,
} from "./nayax-report-mail.ts";
import {
  type GmailMessage,
  nayaxScheduledReportThreadQuery,
  RefundGmailError,
} from "./refund-gmail.ts";
const fixture = await Deno.readFile(
  new URL("./fixtures/nayax-scheduled-first-delivery.csv", import.meta.url),
);
Deno.test("scheduled discovery needs no manual label and remains bounded to the exact vendor query", () => {
  const query = nayaxScheduledReportThreadQuery(
    new Date("2026-09-01T00:00:00Z"),
  );
  assertEquals(query.has("labelIds"), false);
  assertEquals(query.get("maxResults"), "25");
  assertEquals(
    query.get("q"),
    'from:notifier@nayax.com subject:"Nayax Transactions Report" newer_than:7d after:1788220800',
  );
});
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

Deno.test("only the first receiver authentication result counts, never a later sender-supplied pass", async () => {
  const m = message();
  m.payload!.headers!.push({
    name: "Authentication-Results",
    value: "attacker.test; dmarc=pass header.from=nayax.com",
  });
  const deps = {
    mailbox: "info@bloomjoysweets.com",
    getAttachment: () => Promise.reject(),
    download: () => Promise.reject(),
    rpc: async () => ({ recorded: true }),
  };
  assertEquals(
    (await ingestNayaxReportMail({ ...deps, message: m })).duplicate,
    true,
  );
  m.payload!.headers![3].value =
    "mx.google.com; dmarc=fail header.from=nayax.com";
  m.payload!.headers![4].value =
    "mx.google.com; dmarc=pass header.from=nayax.com";
  await assertRejects(() => ingestNayaxReportMail({ ...deps, message: m }));
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
Deno.test("blank paid value is accepted only for rows without refund signals", async () => {
  const text = new TextDecoder().decode(fixture);
  const rows = parseNayaxReportCsv(text);
  const sale = rows.find((row) => !row.original_transaction_id)!;
  const headers = Object.keys(sale);
  const csv = (row: Record<string, string>) =>
    [headers, headers.map((header) => row[header])].map((values) =>
      values.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")
    ).join("\r\n");
  const nonRefund = {
    ...sale,
    payed_value: "",
    seValue: "0.0000",
    tran_status_id: "1",
    tran_status_name: "Synthetic status",
  };
  const normalized = await normalizeNayaxScheduledReport(
    new TextEncoder().encode(csv(nonRefund)),
  );
  assertEquals(normalized.rowCount, 1);
  assertEquals(normalized.observations, []);

  for (
    const refundSignal of <Record<string, string>[]> [
      { original_transaction_id: "7000000001" },
      { auValue: "-8.8000" },
      { seValue: "-8.8000" },
      { tran_status_id: "62" },
      { tran_status_id: "63" },
    ]
  ) {
    await assertRejects(() =>
      normalizeNayaxScheduledReport(
        new TextEncoder().encode(csv({ ...nonRefund, ...refundSignal })),
      )
    );
  }
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

Deno.test("report diagnostics retain only fixed stage/code for download, parser and database failures", async () => {
  const privateText = `${signed} customer@example.test bearer-secret-123`;
  const cases = [
    {
      stage: "deduplicate",
      failRpc: "service_get_nayax_report_message",
      error: new Error(privateText),
      code: "unknown",
    },
    { stage: "download", error: new Error(privateText), code: "unknown" },
    {
      stage: "download",
      error: new Error("nayax_report_download_unavailable"),
      code: "nayax_report_download_unavailable",
    },
    {
      stage: "download",
      error: new RefundGmailError("gmail_rate_limited", privateText),
      code: "gmail_rate_limited",
    },
    {
      stage: "download",
      error: new RefundGmailError(privateText, "gmail_rate_limited"),
      code: "unknown",
    },
    {
      stage: "normalize",
      invalidFile: true,
      code: "nayax_report_contract_invalid",
    },
    {
      stage: "record",
      failRpc: "service_record_nayax_scheduled_report",
      error: { message: privateText, code: "P0001" },
      code: "unknown",
    },
  ];
  for (const test of cases) {
    let recordCalls = 0;
    const error = await assertRejects(() =>
      ingestNayaxReportMail({
        message: message(),
        mailbox: "info@bloomjoysweets.com",
        getAttachment: async () => {
          throw new Error(privateText);
        },
        download: async () => {
          if (test.stage === "download") throw test.error;
          return test.invalidFile
            ? new TextEncoder().encode(privateText)
            : fixture;
        },
        rpc: async (name) => {
          if (name === "service_record_nayax_scheduled_report") recordCalls++;
          if (name === test.failRpc) throw test.error;
          return { recorded: false };
        },
      })
    );
    assert(error instanceof Error);
    const safeCode = nayaxReportFailureCode(error);
    assertEquals(safeCode, `nayax_report:${test.stage}:${test.code}`);
    for (
      const value of [
        safeCode,
        error.message,
        error.stack ?? "",
        JSON.stringify(error),
      ]
    ) {
      assert(!value.includes(privateText));
      assert(!value.includes("synthetic_reference"));
      assert(!value.includes("customer@example.test"));
      assert(!value.includes("bearer-secret-123"));
    }
    assertEquals(recordCalls, test.stage === "record" ? 1 : 0);
  }
  assertEquals(
    nayaxReportFailureCode(new Error(privateText)),
    "nayax_report:unknown",
  );
  assertEquals(
    nayaxReportFailureCode({ message: "nayax_report:download:unknown" }),
    "nayax_report:unknown",
  );
});
Deno.test("report diagnostic codes identify validation stages without loosening sender or receipt guards", async () => {
  for (
    const stage of ["authenticate", "receipt_time", "select_file"] as const
  ) {
    const m = message();
    if (stage === "authenticate") {
      m.payload!.headers![3].value =
        "attacker.test; dmarc=pass header.from=nayax.com";
    }
    if (stage === "receipt_time") delete m.internalDate;
    if (stage === "select_file") delete m.payload!.body;
    let downloadCalls = 0, recordCalls = 0;
    const error = await assertRejects(() =>
      ingestNayaxReportMail({
        message: m,
        mailbox: "info@bloomjoysweets.com",
        getAttachment: async () => fixture,
        download: async () => {
          downloadCalls++;
          return fixture;
        },
        rpc: async (name) => {
          if (name === "service_record_nayax_scheduled_report") recordCalls++;
          return { recorded: false };
        },
      })
    );
    assert(nayaxReportFailureCode(error).startsWith(`nayax_report:${stage}:`));
    assertEquals([downloadCalls, recordCalls], [0, 0]);
  }
});
Deno.test("a failed report leaves the next report eligible and an existing message immutable on replay", async () => {
  const codes: string[] = [];
  const stored = new Map<string, string>();
  let downloads = 0;
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const id = String(args.p_message_id);
    if (name === "service_get_nayax_report_message") {
      return { recorded: stored.has(id) };
    }
    stored.set(id, String(args.p_received_at));
    return { recorded: true, duplicate: false };
  };
  for (const id of ["bad1", "aabb22"]) {
    try {
      await ingestNayaxReportMail({
        message: { ...message(), id },
        mailbox: "info@bloomjoysweets.com",
        rpc,
        getAttachment: async () => fixture,
        download: async () => {
          downloads++;
          if (id === "bad1") throw new Error("private signed URL");
          return fixture;
        },
      });
    } catch (error) {
      codes.push(nayaxReportFailureCode(error));
    }
  }
  assertEquals(codes, ["nayax_report:download:unknown"]);
  assertEquals(stored.size, 1);
  const originalReceivedAt = stored.get("aabb22");
  assertEquals(
    await ingestNayaxReportMail({
      message: { ...message(), id: "aabb22", internalDate: "0" },
      mailbox: "info@bloomjoysweets.com",
      rpc,
      getAttachment: async () => {
        throw new Error("must not fetch replay");
      },
      download: async () => {
        throw new Error("must not download replay");
      },
    }),
    { handled: true, duplicate: true },
  );
  assertEquals(downloads, 2);
  assertEquals(stored.get("aabb22"), originalReceivedAt);
});

Deno.test("actual Gmail run error selection preserves delivery priorities above a safe report failure", async () => {
  const source = await Deno.readTextFile(
    new URL("../refund-gmail-sync/index.ts", import.meta.url),
  );
  const expression = source.match(
    /const errorCode = (fatalError\?\.code[\s\S]*?);\s*await rpc\("service_finish_refund_gmail_sync"/,
  )!;
  assert(
    expression,
    "test executes the actual scheduler error selection expression",
  );
  const select = new Function(
    "fatalError",
    "succeeded",
    "counters",
    "firstContact",
    "firstReportFailureCode",
    `return ${expression[1]};`,
  );
  const safe = "nayax_report:download:unknown";
  const base = {
    outboundReconciliationOutstanding: 0,
    firstContactReconciliationOutstanding: 0,
    outboundReconciliationFailed: 0,
    firstContactFailed: 0,
  };
  assertEquals(select(null, true, base, {}, safe), null);
  assertEquals(
    select(null, false, base, {}, null),
    "gmail_message_processing_failed",
  );
  assertEquals(select(null, false, base, {}, safe), safe);
  assertEquals(
    select({ code: "authorization_revoked" }, false, base, {}, safe),
    "authorization_revoked",
  );
  for (
    const [field, expected] of [
      [
        "outboundReconciliationOutstanding",
        "gmail_outbound_delivery_reconciliation_required",
      ],
      [
        "firstContactReconciliationOutstanding",
        "gmail_first_contact_reconciliation_required",
      ],
      ["outboundReconciliationFailed", "gmail_outbound_reconciliation_failed"],
      ["firstContactFailed", "gmail_first_contact_processing_failed"],
    ]
  ) {
    assertEquals(
      select(null, false, { ...base, [field]: 1 }, {}, safe),
      expected,
    );
  }
  assertEquals(
    select(null, false, { ...base, firstContactFailed: 1 }, {
      errorCode: "existing_specific_delivery_failure",
    }, safe),
    "existing_specific_delivery_failure",
  );
});
