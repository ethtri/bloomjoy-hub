import {
  NayaxLookupRequestError,
  NayaxLookupMalformedResponseError,
  NayaxLookupResponseLimitError,
  NayaxLookupTimeoutError,
  readBoundedNayaxJsonResponse,
} from "./nayax-lookup.ts";
import { classifyNayaxLookupFailure } from "./nayax-lookup-persistence.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("advertised Nayax responses over the byte cap are rejected before parsing", async () => {
  const response = new Response('{"records":[]}', {
    headers: { "content-length": "4096" },
  });
  let thrown: unknown = null;
  try {
    await readBoundedNayaxJsonResponse(response, 128);
  } catch (error) {
    thrown = error;
  }
  assert(
    thrown instanceof NayaxLookupResponseLimitError,
    "oversized advertised response must use the response-limit class",
  );
});

Deno.test("streamed Nayax responses are cancelled when actual bytes exceed the cap", async () => {
  const response = new Response(new TextEncoder().encode("x".repeat(256)));
  response.headers.delete("content-length");
  let thrown: unknown = null;
  try {
    await readBoundedNayaxJsonResponse(response, 64);
  } catch (error) {
    thrown = error;
  }
  assert(
    thrown instanceof NayaxLookupResponseLimitError,
    "oversized streamed response must use the response-limit class",
  );
});

Deno.test("malformed bounded JSON is classified without retaining provider payload", async () => {
  let thrown: unknown = null;
  try {
    await readBoundedNayaxJsonResponse(new Response("not-json"), 64);
  } catch (error) {
    thrown = error;
  }
  assert(
    thrown instanceof NayaxLookupMalformedResponseError,
    "malformed response must use the sanitized response class",
  );
  const classification = classifyNayaxLookupFailure(thrown);
  assert(
    classification.failureClass === "malformed_response" &&
      classification.safeRetryEligible,
    "malformed read-only response must be a named retry-safe failure",
  );
});

Deno.test("timeout and response-limit failures have distinct retry policy", () => {
  const timeout = classifyNayaxLookupFailure(new NayaxLookupTimeoutError());
  const responseLimit = classifyNayaxLookupFailure(
    new NayaxLookupResponseLimitError(),
  );
  assert(
    timeout.failureClass === "timeout" && timeout.safeRetryEligible,
    "bounded timeout should permit a read-only retry",
  );
  assert(
    responseLimit.failureClass === "response_limit" &&
      !responseLimit.safeRetryEligible,
    "response-limit failures must stop for review",
  );
});

Deno.test("provider request failures only allow safe retry for transient responses", () => {
  const conflict = classifyNayaxLookupFailure(
    new NayaxLookupRequestError("conflict", 409),
  );
  const unavailable = classifyNayaxLookupFailure(
    new NayaxLookupRequestError("unavailable", 503),
  );
  assert(
    conflict.failureClass === "provider_error" && !conflict.safeRetryEligible,
    "provider conflicts must stop for review",
  );
  assert(
    unavailable.failureClass === "provider_error" &&
      unavailable.safeRetryEligible,
    "transient provider failures may allow a read-only retry",
  );
});
