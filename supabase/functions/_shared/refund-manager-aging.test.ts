import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRefundManagerAgingNotice,
  REFUND_MANAGER_AGING_TEMPLATE_VERSION,
  refundBusinessDaysElapsed,
  runRefundManagerAgingWhenEnabled,
} from "./refund-manager-aging.ts";

Deno.test("disabled manager aging gate invokes no fetch, claim, reservation, or send dependency", async () => {
  const calls = {
    fetch: 0,
    claim: 0,
    reservation: 0,
    send: 0,
  };
  const result = await runRefundManagerAgingWhenEnabled({
    enabled: false,
    run: async () => {
      calls.fetch += 1;
      calls.claim += 1;
      calls.reservation += 1;
      calls.send += 1;
      return true;
    },
  });

  assertEquals(result, { executed: false, value: null });
  assertEquals(calls, { fetch: 0, claim: 0, reservation: 0, send: 0 });
});

Deno.test("manager aging counts local business-day anniversaries", () => {
  const startedAt = new Date("2026-08-03T17:00:00.000Z"); // Monday 10:00 PDT
  assertEquals(
    refundBusinessDaysElapsed({
      startedAt,
      observedAt: new Date("2026-08-05T16:59:59.000Z"),
      timeZone: "America/Los_Angeles",
    }),
    1,
  );
  assertEquals(
    refundBusinessDaysElapsed({
      startedAt,
      observedAt: new Date("2026-08-05T17:00:00.000Z"),
      timeZone: "America/Los_Angeles",
    }),
    2,
  );
});

Deno.test("manager aging skips weekends and preserves local time across DST", () => {
  assertEquals(
    refundBusinessDaysElapsed({
      startedAt: new Date("2026-08-07T17:00:00.000Z"), // Friday 10:00 PDT
      observedAt: new Date("2026-08-11T17:00:00.000Z"), // Tuesday 10:00 PDT
      timeZone: "America/Los_Angeles",
    }),
    2,
  );
  assertEquals(
    refundBusinessDaysElapsed({
      startedAt: new Date("2026-10-30T17:00:00.000Z"), // Friday 10:00 PDT
      observedAt: new Date("2026-11-03T18:00:00.000Z"), // Tuesday 10:00 PST
      timeZone: "America/Los_Angeles",
    }),
    2,
  );
});

Deno.test("manager aging fails closed for invalid dates and timezones", () => {
  assertEquals(
    refundBusinessDaysElapsed({
      startedAt: new Date("invalid"),
      observedAt: new Date(),
      timeZone: "America/Los_Angeles",
    }),
    0,
  );
  assertEquals(
    refundBusinessDaysElapsed({
      startedAt: new Date("2026-08-03T17:00:00.000Z"),
      observedAt: new Date("2026-08-05T17:00:00.000Z"),
      timeZone: "Not/A_Timezone",
    }),
    0,
  );
});

Deno.test("manager notice is deterministic, sanitized, and portal-action bounded", () => {
  const notice = buildRefundManagerAgingNotice({
    milestone: "escalation",
    publicReference: "RF-SYNTHETIC",
    machineLabel: "Lobby machine",
    locationName: "Sample venue",
    businessDayAge: 5,
    status: "correlated",
  });
  assertEquals(notice.templateVersion, REFUND_MANAGER_AGING_TEMPLATE_VERSION);
  assertStringIncludes(notice.subject, "RF-SYNTHETIC");
  assertStringIncludes(notice.summaryText, "Case age: 5 business days");
  assert(/only the current mapped Machine Manager/i.test(notice.summaryText));
  assertStringIncludes(notice.summaryText, "navigation only");
  assert(
    !/card\s*(number|digits)|complaint|provider\s*(id|payload)/i.test(
      notice.summaryText,
    ),
  );
});
