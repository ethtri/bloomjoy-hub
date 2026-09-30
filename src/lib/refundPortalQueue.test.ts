/// <reference lib="deno.ns" />

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { filterRefundPortalQueue, parseRefundPortalQueueProjection, type RefundPortalQueueItem } from "./refundPortalQueue.ts";

const fixture = () => ({
  schemaVersion: "refund_portal_queue_v1",
  observedAt: "2026-09-30T04:45:00.000Z",
  counts: {
    allOpen: 1,
    decisions: 1,
    waitingOnCustomer: 0,
    completed: 0,
    internalTest: 0,
  },
  items: [{
    caseId: "aa455000-0000-4000-8000-000000000001",
    publicReference: "RF-QUEUE-0001",
    amountCents: 500,
    currencyCode: "USD",
    machineLabel: "Queue machine",
    locationName: "Queue location",
    createdAt: "2026-09-29T04:45:00.000Z",
    view: "decisions",
    isOpen: true,
    decisionReady: true,
    nextWorkActor: "manager",
    nextWorkActionCode: "approve_or_deny_request",
    nextWorkActionLabel: "Review the purchase and decide the request.",
    payloadRedacted: true,
  }],
  refundOperationsAccess: true,
  payloadRedacted: true,
});

Deno.test("portal queue projection accepts the small redacted contract", () => {
  const parsed = parseRefundPortalQueueProjection(fixture());
  assertEquals(parsed.counts.decisions, 1);
  assertEquals(parsed.items[0].nextWorkActor, "manager");
});

Deno.test("portal queue projection rejects duplicate case rows", () => {
  const value = fixture();
  value.items.push({ ...value.items[0] });
  assertThrows(() => parseRefundPortalQueueProjection(value), Error,
    "Unsupported refund queue summary.");
});

Deno.test("portal queue projection rejects unredacted or malformed work", () => {
  const value = fixture() as ReturnType<typeof fixture> & {
    payloadRedacted: boolean;
  };
  value.payloadRedacted = false;
  assertThrows(() => parseRefundPortalQueueProjection(value), Error,
    "Unsupported refund queue summary.");
});

Deno.test("portal queue projection rejects counts that contradict visible rows", () => {
  const value = fixture();
  value.counts.allOpen = 0;
  assertThrows(() => parseRefundPortalQueueProjection(value));
});

Deno.test("portal queue projection rejects contradictory open and decision flags", () => {
  const value = fixture();
  value.items[0].isOpen = false;
  assertThrows(() => parseRefundPortalQueueProjection(value));
});

Deno.test("portal queue filters keep history and internal archives separate", () => {
  const decision = fixture().items[0] as RefundPortalQueueItem;
  const closed: RefundPortalQueueItem = { ...decision, caseId: 'closed', publicReference: 'RF-CLOSED',
    view: 'completed', isOpen: false, decisionReady: false };
  const internal: RefundPortalQueueItem = { ...closed, caseId: 'internal', view: 'internal_test' };
  const items = [decision, closed, internal];
  assertEquals(filterRefundPortalQueue(items, 'completed', '').map((item) => item.caseId), ['closed']);
  assertEquals(filterRefundPortalQueue(items, 'all_open', '').map((item) => item.caseId), [decision.caseId]);
  assertEquals(filterRefundPortalQueue(items, 'internal_test', '').map((item) => item.caseId), ['internal']);
  assertEquals(filterRefundPortalQueue(items, 'decisions', 'RF-CLOSED').map((item) => item.caseId), ['closed']);
});
