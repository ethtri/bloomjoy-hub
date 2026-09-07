import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  validateCardPreExecutionRequest,
  validateRefundEvidenceSelectionRequest,
  validateRefundCustomerMessageRequest,
} from "./refund-evidence-selection.ts";

Deno.test("Nayax evidence selection stays in review without customer communication", () => {
  assertEquals(
    validateRefundEvidenceSelectionRequest({
      hasNayaxCandidate: true,
      requestedStatus: "needs_review",
      requestedDecision: null,
      requestedMessageType: null,
    }),
    null,
  );
});

Deno.test("one manager confirmation may persist exact selection approval without communication", () => {
  assertEquals(
    validateRefundEvidenceSelectionRequest({
      hasNayaxCandidate: true,
      requestedStatus: "card_refund_pending",
      requestedDecision: "approved",
      requestedMessageType: null,
    }),
    null,
  );
  assertEquals(
    validateCardPreExecutionRequest({
      isCardCase: true,
      hasNayaxCandidate: true,
      requestedStatus: "card_refund_pending",
      requestedDecision: "approved",
      requestedMessageType: null,
    }),
    null,
  );
});

for (const unsafeRequest of [
  { requestedStatus: "card_refund_pending", requestedDecision: null, requestedMessageType: null },
  { requestedStatus: "needs_review", requestedDecision: "approved", requestedMessageType: null },
  { requestedStatus: "needs_review", requestedDecision: null, requestedMessageType: "approved" },
  { requestedStatus: "completed", requestedDecision: "approved", requestedMessageType: "completed" },
]) {
  Deno.test(`Nayax evidence selection rejects unsafe side effects: ${JSON.stringify(unsafeRequest)}`, () => {
    assertEquals(
      validateRefundEvidenceSelectionRequest({
        hasNayaxCandidate: true,
        ...unsafeRequest,
      }),
      "Saving transaction evidence cannot approve or complete a refund, change it to ready to refund, or contact the customer.",
    );
  });
}

Deno.test("card review cannot create a pre-execution approval without selecting evidence", () => {
  assertEquals(
    validateCardPreExecutionRequest({
      isCardCase: true,
      hasNayaxCandidate: false,
      requestedStatus: "card_refund_pending",
      requestedDecision: "approved",
      requestedMessageType: "approved",
    }),
    "Card transaction review cannot approve a refund or send an approval email. Issue the provider refund first.",
  );
});

Deno.test("confirmed provider completion remains a separate supported transition", () => {
  assertEquals(
    validateCardPreExecutionRequest({
      isCardCase: true,
      hasNayaxCandidate: false,
      requestedStatus: "completed",
      requestedDecision: "approved",
      requestedMessageType: "completed",
    }),
    null,
  );
});

Deno.test("cash approval workflow is unaffected", () => {
  assertEquals(
    validateCardPreExecutionRequest({
      isCardCase: false,
      hasNayaxCandidate: false,
      requestedStatus: "cash_zelle_pending",
      requestedDecision: "approved",
      requestedMessageType: "approved",
    }),
    null,
  );
});

Deno.test("card approval email is rejected before provider success", () => {
  assertEquals(
    validateRefundCustomerMessageRequest({
      paymentMethod: "card",
      caseStatus: "needs_review",
      messageType: "approved",
    }),
    "Card refunds do not send a separate approval email. Notify the customer only after the provider refund succeeds.",
  );
});

Deno.test("completion email is rejected while a case is still open", () => {
  assertEquals(
    validateRefundCustomerMessageRequest({
      paymentMethod: "card",
      caseStatus: "needs_review",
      messageType: "completed",
    }),
    "A refund completion email can be sent only after the case is complete.",
  );
});

Deno.test("completion email is allowed after verified case completion", () => {
  assertEquals(
    validateRefundCustomerMessageRequest({
      paymentMethod: "card",
      caseStatus: "completed",
      messageType: "completed",
    }),
    null,
  );
});
