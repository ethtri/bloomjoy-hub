import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyRefundRequestTimeBoundary,
  incidentTimeIsMateriallyFuture,
} from "./refund-request-time-boundary.mjs";

const classify = (overrides: Record<string, unknown> = {}) =>
  classifyRefundRequestTimeBoundary({
    customerRequestReceivedAt: "2026-09-05T17:00:00Z",
    customerRequestReceivedSource: "hosted_refund_intake",
    transactionOccurredAt: "2026-09-05T16:59:59Z",
    transactionOccurrenceSource: "authorization_gmt",
    transactionTimeResolution: "exact",
    ...overrides,
  });

Deno.test("request boundary distinguishes before, equal, and provably later occurrence", () => {
  assertEquals(classify().state, "before_or_at_request");
  assertEquals(classify({ transactionOccurredAt: "2026-09-05T17:00:00Z" }).state, "before_or_at_request");
  const after = classify({ transactionOccurredAt: "2026-09-05T17:00:01Z" });
  assertEquals(after.state, "after_request");
  assertEquals(after.transactionAfterRequest, true);
});

Deno.test("record arrival is not an input and delayed delivery keeps an earlier occurrence eligible", () => {
  const delayed = classify({
    transactionOccurredAt: "2026-09-05T16:45:00Z",
    providerRecordArrivedAt: "2026-09-06T17:00:00Z",
  });
  assertEquals(delayed.state, "before_or_at_request");
});

Deno.test("unknown request or occurrence semantics remain reviewable", () => {
  assertEquals(classify({ customerRequestReceivedAt: null, customerRequestReceivedSource: null }).state, "request_time_unknown");
  assertEquals(classify({
    transactionOccurrenceSource: "unverified_location_clock",
  }).state, "occurrence_time_uncertain");
  assertEquals(classify({
    transactionTimeResolution: "ambiguous",
    transactionOccurrenceSource: "verified_machine_clock",
  }).state, "occurrence_time_uncertain");
});

Deno.test("future incident validation uses only one minute of input precision", () => {
  assertEquals(incidentTimeIsMateriallyFuture({
    incidentAt: "2026-09-05T17:01:00Z",
    customerRequestReceivedAt: "2026-09-05T17:00:00Z",
  }), false);
  assertEquals(incidentTimeIsMateriallyFuture({
    incidentAt: "2026-09-05T17:01:01Z",
    customerRequestReceivedAt: "2026-09-05T17:00:00Z",
  }), true);
});
