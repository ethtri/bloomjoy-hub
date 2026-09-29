import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyNayaxLookupBeginError } from "./nayax-lookup-begin-error.ts";

Deno.test("classifies a guarded lookup precondition without suggesting a retry", () => {
  assertEquals(classifyNayaxLookupBeginError({ code: "P4622" }), {
    status: 409,
    body: {
      errorCode: "lookup_precondition_conflict",
      error:
        "No transaction check was started. Follow the case's current next step before checking again.",
    },
  });
});

Deno.test("keeps current-case access failures distinct", () => {
  assertEquals(classifyNayaxLookupBeginError({ code: "42501" }), {
    status: 403,
    body: {
      errorCode: "lookup_access_required",
      error:
        "Current refund case access is required before checking transactions.",
    },
  });
});

Deno.test("does not relabel unexpected database failures", () => {
  assertEquals(classifyNayaxLookupBeginError({ code: "P4620" }), null);
  assertEquals(classifyNayaxLookupBeginError({ code: "P4623" }), null);
  assertEquals(classifyNayaxLookupBeginError(new Error("unexpected")), null);
});
